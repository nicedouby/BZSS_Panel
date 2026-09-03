#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


DEFAULT_CONFIG: Dict[str, Any] = {
    "server_id": "BZSS_Main",
    "log_file": "./SquadGame.log",
    "output_dir": "./LogPost",
    "transport_only": False,
    "poll_interval_ms": 200,

    "tail": {
        "from_end": True,
        "reopen_on_truncate": True,
        "read_chunk_bytes": 1048576,
        "max_recovery_bytes": 0,
        "max_line_bytes": 1048576,
    },

    "udp": {
        "enabled": True,
        "host": "127.0.0.1",
        "port": 7788,
        "max_payload_bytes": 60000,
    },

    "unknown": {
        "write_unknown": False,
    },

    "storage": {
        "write_v2_events": True,
        "write_legacy_events": False,
        "write_v2_raw_archive": True,
        "write_legacy_raw_archive": False,
    },

    "preserve": {
        "enabled": True,
        "write_file": True,
        "file_name": "Preserved.jsonl",
        "contains": [
            "LogNet: Join succeeded:",
            "LogNet: PostLogin: NewPlayer:",
            "LogSquad: PostLogin: NewPlayer:",
            "LogNet: UNetConnection::Close:",
        ],
    },

    "raw": {
        "max_raw_chars": 48000,
    },

    "raw_input_log": {
        "enabled": True,
        "output_dir": "./ReceivedLogs",
        "file_name": "Received.log",
        "format": "raw",
    },

    "raw_log_output": {
        "enabled": False,
        "source": "Squad.log",
        "mode": "business_lossless",
        "max_per_second": 20,
    },

    "blacklist_contains": [
        "GetDefaultPawnClassForController_Implementation()",
        "IsSpawnpointAllowed()",
        "FindPlayerStart_Implementation()",
        "SpawnDefaultPawnFor_Implementation()",
        "TraceAndMessageClient()",
        "BeginInactiveState()",
        "EndInactiveState()",
        "ServerFireProjectileWithId_Implementation()",
        "SQVehicle::OnTakeDamage",
        "SQVehicle::TakeDamage",
        "VehicleMovementComponent",
    ],
}


def deep_merge(base: Dict[str, Any], override: Dict[str, Any]) -> Dict[str, Any]:
    result = dict(base)

    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value

    return result


def load_config(config_path: str = "config.json") -> Dict[str, Any]:
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"LogPost config not found: {path.resolve()}")

    with path.open("r", encoding="utf-8") as f:
        user_config = json.load(f)

    config = deep_merge(DEFAULT_CONFIG, user_config)
    config["log_file"] = resolve_squad_server_path(config.get("log_file", ""), path)
    return config


def resolve_squad_server_path(value: Any, config_path: Path) -> str:
    """Resolve SquadGame-relative paths from either the panel root or a child folder."""
    text = str(value or "").strip()
    if not text:
        return ""

    configured = Path(text)
    if configured.is_absolute():
        return str(configured)

    parts = [part.lower() for part in configured.parts if part not in {".", ""}]
    if not parts or parts[0] != "squadgame":
        return str(configured)

    for directory in (config_path.resolve().parent, *config_path.resolve().parent.parents):
        if (directory / "SquadGame").is_dir():
            return str((directory / configured).resolve())

    return str(configured)
