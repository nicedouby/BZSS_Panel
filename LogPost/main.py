#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import sys

from bzss_parser.app import BzssLogParserApp
from bzss_parser.config import load_config


def main() -> None:
    config_path = "config.json"

    if len(sys.argv) >= 2:
        config_path = sys.argv[1]

    config = load_config(config_path)
    app = BzssLogParserApp(config)
    app.run()


if __name__ == "__main__":
    main()
