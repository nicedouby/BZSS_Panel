#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import sys
import time
import urllib.error
import urllib.request


DEFAULT_BASE_URL = "http://127.0.0.1:12864"
DEFAULT_TOKEN = "change-me-long-random-token"

ENDPOINTS = [
    "/api/public/v1/health",
    "/api/public/v1/server",
    "/api/public/v1/players",
    "/api/public/v1/squads",
    "/api/public/v1/match",
    "/api/public/v1/tactical",
    "/api/public/v1/all",
]


def request_json(base_url: str, path: str, token: str | None, timeout: float = 5.0):
    url = base_url.rstrip("/") + path
    headers = {
        "Accept": "application/json",
        "User-Agent": "BZSS-PublicInterface-Test/1.0",
    }

    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers, method="GET")

    started = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            elapsed_ms = int((time.perf_counter() - started) * 1000)
            return {
                "ok": True,
                "status": resp.status,
                "elapsed_ms": elapsed_ms,
                "json": json.loads(body) if body else None,
                "raw": body,
            }
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        parsed = None
        try:
            parsed = json.loads(body) if body else None
        except json.JSONDecodeError:
            pass
        return {
            "ok": False,
            "status": exc.code,
            "elapsed_ms": elapsed_ms,
            "json": parsed,
            "raw": body,
        }
    except Exception as exc:
        elapsed_ms = int((time.perf_counter() - started) * 1000)
        return {
            "ok": False,
            "status": 0,
            "elapsed_ms": elapsed_ms,
            "json": None,
            "raw": str(exc),
        }


def print_result(path: str, result: dict, verbose: bool):
    status = result["status"]
    elapsed = result["elapsed_ms"]
    ok = result["ok"] and 200 <= status < 300
    mark = "OK" if ok else "FAIL"

    print(f"[{mark}] {path} status={status} time={elapsed}ms")

    payload = result.get("json")
    if isinstance(payload, dict):
        print(f"  response.ok={payload.get('ok')} version={payload.get('version')} updatedAt={payload.get('updatedAt')}")
        data = payload.get("data")
        if isinstance(data, dict):
            keys = ", ".join(list(data.keys())[:12])
            print(f"  data.keys={keys}")
        elif isinstance(data, list):
            print(f"  data.count={len(data)}")
    elif verbose:
        print(f"  raw={result.get('raw')}")

    if verbose and payload is not None:
        print(json.dumps(payload, ensure_ascii=False, indent=2)[:4000])


def main():
    parser = argparse.ArgumentParser(description="Test BZSS Panel public interface API.")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL, help="Example: http://127.0.0.1:12864")
    parser.add_argument("--token", default=DEFAULT_TOKEN, help="Bearer token from publicInterface.tokens")
    parser.add_argument("--no-token", action="store_true", help="Do not send Authorization header")
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    token = None if args.no_token else args.token

    failures = 0
    for path in ENDPOINTS:
        result = request_json(args.base_url, path, token, args.timeout)
        print_result(path, result, args.verbose)
        if not (result["ok"] and 200 <= result["status"] < 300):
            failures += 1

    print("")
    if failures:
        print(f"Done with {failures} failed endpoint(s).")
        return 1

    print("All public interface endpoints are reachable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
