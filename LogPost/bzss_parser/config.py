#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


DEFAULT_CONFIG: Dict[str, Any] = {
    "server_id": "BZSS_Main",
    "log_file": "./Squad.log",
    "output_dir": "./LogPost",
    "transport_only": False,
    "poll_interval_ms": 200,

    "tail": {
        "from_end": True,
        "reopen_on_truncate": True,
        "read_chunk_bytes": 1048576,
        "max_recovery_bytes": 8388608,
        "max_line_bytes": 1048576,
    },

    "udp": {
        "enabled": True,
        "host": "127.0.0.1",
        "port": 7788,
        "max_payload_bytes": 16384,
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
        "max_raw_chars": 4096,
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
        print("[WARN] config.json not found. Using default config.")
        return DEFAULT_CONFIG

    with path.open("r", encoding="utf-8") as f:
        user_config = json.load(f)

    return deep_merge(DEFAULT_CONFIG, user_config)
