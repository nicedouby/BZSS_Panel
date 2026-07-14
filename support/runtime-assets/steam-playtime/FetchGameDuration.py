import argparse
import json
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import ProxyHandler, Request, build_opener
from pathlib import Path

DEFAULT_APP_ID = 393380
DEFAULT_TIMEOUT = 20
STEAM_URL = "https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/"


def load_config(config_path: Path) -> dict:
    with config_path.open("r", encoding="utf-8") as file:
        return json.load(file)


def _proxy_matches_host(proxy_rules: str, hostname: str) -> bool:
    host = (hostname or "").lower().strip(".")
    for raw_rule in (proxy_rules or "").split(","):
        rule = raw_rule.strip().lower()
        if not rule:
            continue
        if rule == "*":
            return True
        rule = rule.lstrip(".")
        if host == rule or host.endswith("." + rule):
            return True
    return False


def fetch_game_duration(
    api_key: str,
    steam_id: str,
    app_id: int,
    timeout: int,
    proxy_url: str = "",
    no_proxy: str = "",
) -> dict:
    params = {
        "key": api_key,
        "steamid": steam_id.strip(),
        "include_appinfo": "1",
        "include_played_free_games": "1",
        "appids_filter[0]": app_id,
    }

    url = f"{STEAM_URL}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": "BZSS-Panel/SteamPlaytime"})

    try:
        hostname = "api.steampowered.com"
        if proxy_url and not _proxy_matches_host(no_proxy, hostname):
            opener = build_opener(ProxyHandler({"http": proxy_url, "https": proxy_url}))
        else:
            # No explicit proxy: urllib honors HTTP(S)_PROXY/ALL_PROXY from the environment.
            opener = build_opener()
        with opener.open(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace") if error.fp else ""
        detail = body.strip() or error.reason or str(error)
        raise RuntimeError(f"Steam API request failed with HTTP {error.code}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"Steam API request failed: {error.reason}") from error

    games = payload.get("response", {}).get("games", []) or []
    game = next((item for item in games if int(item.get("appid", 0)) == app_id), None)
    playtime_minutes = int((game or {}).get("playtime_forever", 0) or 0)

    return {
        "steamID": steam_id.strip(),
        "appId": app_id,
        "gameName": (game or {}).get("name", "Squad"),
        "found": game is not None,
        "gameMinutes": playtime_minutes,
        "gameSeconds": playtime_minutes * 60,
        "raw": payload,
    }


def main() -> int:
    base_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="Fetch Steam game duration for a single Steam ID.")
    parser.add_argument("steam_id", help="Steam64 ID to query.")
    parser.add_argument("--config", default=str(base_dir / "config.json"), help="Path to config.json")
    parser.add_argument("--app-id", type=int, default=DEFAULT_APP_ID, help="Steam app ID, default is Squad (393380)")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT, help="HTTP timeout in seconds")
    parser.add_argument("--proxy", default="", help="Optional HTTP(S)/SOCKS proxy URL")
    parser.add_argument("--no-proxy", default="", help="Comma-separated hosts that bypass the explicit proxy")
    args = parser.parse_args()

    try:
        config = load_config(Path(args.config))
        api_key = str(((config or {}).get("steam") or {}).get("apiKey") or "").strip()
        if not api_key:
            raise ValueError("Missing steam.apiKey in config.json")

        result = fetch_game_duration(
            api_key,
            args.steam_id,
            args.app_id,
            args.timeout,
            args.proxy,
            args.no_proxy,
        )
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
