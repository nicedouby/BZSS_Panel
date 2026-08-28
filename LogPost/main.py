#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import sys
import io

# Force stdout/stderr to use UTF-8 on Windows to prevent UnicodeEncodeError under GBK locale
if sys.platform == "win32":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    else:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="backslashreplace")
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="backslashreplace")

from bzss_parser.app import BzssLogParserApp
from bzss_parser.config import load_config
from bzss_parser.runtime_probe import install_runtime_probe


def main() -> None:
    config_path = "../config/logpost.json"

    if len(sys.argv) >= 2:
        config_path = sys.argv[1]

    config = load_config(config_path)
    app = BzssLogParserApp(config)
    # The probe only wraps existing methods and emits one compact metrics line
    # per second. It does not duplicate or retain raw log content.
    install_runtime_probe(app, config)
    app.run()


if __name__ == "__main__":
    main()
