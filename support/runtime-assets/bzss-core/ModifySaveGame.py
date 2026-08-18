#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import argparse
import json
import os
import struct
import sys
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path


ARRAY_PROPERTY = "Data"


class SaveGameError(RuntimeError):
    pass


@dataclass(frozen=True)
class FStringValue:
    text: str
    size: int


@dataclass(frozen=True)
class TypeNode:
    name: str
    children: tuple["TypeNode", ...]


@dataclass(frozen=True)
class StringArrayProperty:
    size_offset: int
    value_offset: int
    value_end: int
    values: tuple[str, ...]


def read_i32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise SaveGameError("读取 int32 时超出文件范围")
    return struct.unpack_from("<i", data, offset)[0]


def read_u32(data: bytes, offset: int) -> int:
    if offset < 0 or offset + 4 > len(data):
        raise SaveGameError("读取 uint32 时超出文件范围")
    return struct.unpack_from("<I", data, offset)[0]


def read_fstring(data: bytes, offset: int) -> FStringValue:
    count = read_i32(data, offset)

    if count == 0:
        return FStringValue("", 4)

    if count > 0:
        end = offset + 4 + count
        if end > len(data):
            raise SaveGameError("ANSI FString 超出文件范围")
        raw = data[offset + 4:end]
        if not raw or raw[-1] != 0:
            raise SaveGameError("ANSI FString 缺少结尾零字符")
        return FStringValue(raw[:-1].decode("utf-8"), 4 + count)

    units = -count
    end = offset + 4 + units * 2
    if end > len(data):
        raise SaveGameError("UTF-16 FString 超出文件范围")
    raw = data[offset + 4:end]
    if len(raw) < 2 or raw[-2:] != b"\x00\x00":
        raise SaveGameError("UTF-16 FString 缺少结尾零字符")
    return FStringValue(raw[:-2].decode("utf-16le"), 4 + units * 2)


def write_fstring(text: str) -> bytes:
    try:
        raw = text.encode("ascii")
        return struct.pack("<i", len(raw) + 1) + raw + b"\x00"
    except UnicodeEncodeError:
        raw = text.encode("utf-16le")
        units = len(raw) // 2 + 1
        return struct.pack("<i", -units) + raw + b"\x00\x00"


def write_type_node(name: str, children: list[bytes] | None = None) -> bytes:
    children = children or []
    return write_fstring(name) + struct.pack("<I", len(children)) + b"".join(children)


def read_type_node(data: bytes, offset: int, depth: int = 0) -> tuple[TypeNode, int]:
    if depth > 16:
        raise SaveGameError("属性类型嵌套过深")

    name_value = read_fstring(data, offset)
    cursor = offset + name_value.size
    child_count = read_u32(data, cursor)
    cursor += 4

    if child_count > 16:
        raise SaveGameError(f"异常的属性类型参数数量：{child_count}")

    children: list[TypeNode] = []
    for _ in range(child_count):
        child, cursor = read_type_node(data, cursor, depth + 1)
        children.append(child)

    return TypeNode(name_value.text, tuple(children)), cursor


def find_string_array_property(data: bytes) -> StringArrayProperty | None:
    if not data.startswith(b"GVAS"):
        raise SaveGameError("文件不是 GVAS SaveGame")

    name_bytes = write_fstring(ARRAY_PROPERTY)
    search_at = 0

    while True:
        name_offset = data.find(name_bytes, search_at)
        if name_offset < 0:
            return None

        search_at = name_offset + 1

        try:
            cursor = name_offset + len(name_bytes)
            type_node, cursor = read_type_node(data, cursor)

            if type_node.name != "ArrayProperty":
                continue
            if len(type_node.children) != 1:
                continue
            if type_node.children[0].name != "StrProperty":
                continue

            size_offset = cursor
            property_size = read_i32(data, size_offset)
            if property_size < 4:
                continue
            cursor += 4

            tag_flags = data[cursor]
            cursor += 1

            if tag_flags & 0x02:
                cursor += 16

            value_offset = cursor
            value_end = value_offset + property_size
            if value_end > len(data):
                continue

            count = read_i32(data, value_offset)
            if count < 0 or count > 10_000_000:
                continue

            values: list[str] = []
            element_offset = value_offset + 4
            for _ in range(count):
                value = read_fstring(data, element_offset)
                values.append(value.text)
                element_offset += value.size

            if element_offset != value_end:
                continue

            return StringArrayProperty(
                size_offset=size_offset,
                value_offset=value_offset,
                value_end=value_end,
                values=tuple(values),
            )
        except (SaveGameError, UnicodeError, struct.error, IndexError):
            continue


def terminal_none_offset(data: bytes) -> int:
    marker = write_fstring("None") + struct.pack("<i", 0)
    if not data.endswith(marker):
        raise SaveGameError("无法识别 SaveGame 属性结束标记 None")
    return len(data) - len(marker)


def build_string_array_property(values: list[str]) -> bytes:
    payload = bytearray(struct.pack("<i", len(values)))
    for value in values:
        payload += write_fstring(value)

    inner = write_type_node("StrProperty")
    property_type = write_type_node("ArrayProperty", [inner])

    # tag_flags = 0：不附带 PropertyGuid，按属性名称 Data 匹配。
    return (
        write_fstring(ARRAY_PROPERTY)
        + property_type
        + struct.pack("<i", len(payload))
        + b"\x00"
        + payload
    )


def patch_first_empty_or_append(data: bytes, message: str) -> tuple[bytes, int, bool]:
    prop = find_string_array_property(data)

    if prop is None:
        insert_at = terminal_none_offset(data)
        encoded_property = build_string_array_property([message])
        return data[:insert_at] + encoded_property + data[insert_at:], 0, True

    values = list(prop.values)
    target_index = next(
        (index for index, value in enumerate(values) if value == ""),
        len(values),
    )

    if target_index == len(values):
        values.append(message)
    else:
        values[target_index] = message

    payload = bytearray(struct.pack("<i", len(values)))
    for value in values:
        payload += write_fstring(value)

    patched = (
        data[:prop.size_offset]
        + struct.pack("<i", len(payload))
        + data[prop.size_offset + 4:prop.value_offset]
        + payload
        + data[prop.value_end:]
    )

    return patched, target_index, False



CORE_BOOL_NAMES = ("LocalVOIPEnable", "OutputBZSSObj", "CheckingNoob")


def find_bool_property(data: bytes, name: str) -> tuple[int, int, int, int] | None:
    name_bytes = write_fstring(name)
    search_at = 0
    while True:
        name_offset = data.find(name_bytes, search_at)
        if name_offset < 0:
            return None
        search_at = name_offset + 1
        try:
            type_offset = name_offset + len(name_bytes)
            type_value = read_fstring(data, type_offset)
            if type_value.text != "BoolProperty":
                continue
            size_offset = type_offset + type_value.size
            property_size = read_i32(data, size_offset)
            value_offset = size_offset + 8
            value_end = value_offset + property_size
            if property_size < 0 or value_end > len(data):
                continue
            return name_offset, size_offset, value_offset, value_end
        except (SaveGameError, UnicodeError, struct.error):
            continue


def read_core_bools(save_path: Path) -> dict[str, bool]:
    data = save_path.read_bytes()
    if not data.startswith(b"GVAS"):
        raise SaveGameError("文件不是 GVAS SaveGame")
    variables: dict[str, bool] = {}
    for name in CORE_BOOL_NAMES:
        prop = find_bool_property(data, name)
        if prop is None:
            raise SaveGameError(f"找不到 BoolProperty：{name}")
        _property_start, _size_offset, value_offset, value_end = prop
        property_size = value_end - value_offset
        if property_size == 0:
            variables[name] = False
        elif property_size == 1:
            variables[name] = data[value_offset] != 0
        else:
            raise SaveGameError(f"BoolProperty {name} 的长度异常：{property_size}")
    return variables


def patch_core_bool(data: bytes, name: str, value: bool) -> bytes:
    prop = find_bool_property(data, name)
    if prop is None:
        raise SaveGameError(f"找不到 BoolProperty：{name}")
    property_start, size_offset, value_offset, value_end = prop
    payload = b"\\x01" if value else b""
    patched_property = (
        data[property_start:size_offset]
        + struct.pack("<i", len(payload))
        + data[size_offset + 4:value_offset]
        + payload
    )
    return data[:property_start] + patched_property + data[value_end:]


def write_core_bool(save_path: Path, name: str, value: bool) -> dict[str, bool]:
    if not save_path.is_file():
        raise SaveGameError(f"SaveGame 文件不存在：{save_path}")
    if name not in CORE_BOOL_NAMES:
        raise SaveGameError(f"不支持的 BoolProperty：{name}")
    lock_path = save_path.with_name(save_path.name + ".writer.lock")
    lock_fd = acquire_lock(lock_path)
    try:
        original = save_path.read_bytes()
        patched = patch_core_bool(original, name, value)
        atomic_replace(save_path, patched)
        variables = read_core_bools(save_path)
        if variables[name] is not value:
            raise SaveGameError(f"写入后校验失败：{name}")
        return variables
    finally:
        os.close(lock_fd)
        lock_path.unlink(missing_ok=True)

def acquire_lock(lock_path: Path, timeout_seconds: float = 30.0) -> int:
    deadline = time.monotonic() + max(0.1, timeout_seconds)
    while True:
        try:
            fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"pid={os.getpid()}\ntime={time.time()}\n".encode("ascii"))
            return fd
        except FileExistsError as exc:
            if time.monotonic() >= deadline:
                raise SaveGameError("另一个外部进程持续占用该 SaveGame，等待超时") from exc
            time.sleep(0.05)


def atomic_replace(path: Path, data: bytes) -> None:
    fd, temp_name = tempfile.mkstemp(
        prefix=path.name + ".",
        suffix=".tmp",
        dir=path.parent,
    )
    temp_path = Path(temp_name)

    try:
        with os.fdopen(fd, "wb") as file:
            file.write(data)
            file.flush()
            os.fsync(file.fileno())

        os.replace(temp_path, path)
    except OSError as exc:
        raise SaveGameError(f"替换 SaveGame 失败：{exc}") from exc
    finally:
        temp_path.unlink(missing_ok=True)


def write_messages(save_path: Path, messages: list[str]) -> int:
    if not save_path.is_file():
        raise SaveGameError(f"SaveGame 文件不存在：{save_path}")

    normalized_messages = [str(message).strip() for message in messages if str(message).strip()]
    if not normalized_messages:
        raise SaveGameError("消息不能为空")

    for message in normalized_messages:
        event_name, separator, _event_parameter = message.partition(":")
        if not separator:
            raise SaveGameError("消息格式错误，应为：事件名:事件参数")
        if not event_name:
            raise SaveGameError("事件名不能为空")

    lock_path = save_path.with_name(save_path.name + ".writer.lock")
    lock_fd = acquire_lock(lock_path)

    try:
        original = save_path.read_bytes()
        patched = original
        indexes: list[int] = []
        for message in normalized_messages:
            patched, index, _created = patch_first_empty_or_append(patched, message)
            indexes.append(index)
        atomic_replace(save_path, patched)
    finally:
        os.close(lock_fd)
        lock_path.unlink(missing_ok=True)

    for index, message in zip(indexes, normalized_messages):
        print(f"Data[{index}] = {message}")
    return 0


def write_message(save_path: Path, message: str) -> int:
    return write_messages(save_path, [message])


def main() -> int:
    parser = argparse.ArgumentParser(
        usage='%(prog)s <SaveGame路径> "<事件名:事件参数>"'
    )
    parser.add_argument("save_path", type=Path)
    parser.add_argument("messages", nargs="*")
    parser.add_argument("--read-core-bools", action="store_true")
    parser.add_argument("--set-core-bool", nargs=2, metavar=("NAME", "VALUE"))
    args = parser.parse_args()

    try:
        if args.read_core_bools:
            variables = read_core_bools(args.save_path)
            print(json.dumps({
                "online": True,
                "variables": variables,
                "updatedAt": int(time.time() * 1000),
            }, ensure_ascii=False))
            return 0

        if args.set_core_bool:
            name, raw_value = args.set_core_bool
            if raw_value not in ("0", "1"):
                raise SaveGameError("BoolProperty 值必须是 0 或 1")
            variables = write_core_bool(args.save_path, name, raw_value == "1")
            print(json.dumps({
                "online": True,
                "variables": variables,
                "updatedAt": int(time.time() * 1000),
            }, ensure_ascii=False))
            return 0

        return write_messages(args.save_path, args.messages)
    except SaveGameError as exc:
        print(json.dumps({
            "online": False,
            "variables": {name: None for name in CORE_BOOL_NAMES},
            "error": str(exc),
            "updatedAt": int(time.time() * 1000),
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
