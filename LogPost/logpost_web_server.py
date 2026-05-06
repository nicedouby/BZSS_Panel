#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Tuple
from urllib.parse import parse_qs, urlparse

from bzss_parser.config import load_config


CONFIG: Dict[str, Any] = {}
LOGPOST_DIR = Path("./LogPost")
MAX_LINES_PER_REQUEST = 2000


def json_response(handler: BaseHTTPRequestHandler, obj: Any, status: int = 200) -> None:
    data = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def text_response(handler: BaseHTTPRequestHandler, text: str, content_type: str = "text/html; charset=utf-8", status: int = 200) -> None:
    data = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(data)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(data)


def safe_date(value: str) -> str:
    value = value.strip()
    if not value:
        return ""

    try:
        datetime.strptime(value, "%Y-%m-%d")
        return value
    except ValueError:
        return ""


def safe_event_file(value: str) -> str:
    value = value.strip()
    if not value:
        return "All.jsonl"

    if not value.endswith(".jsonl"):
        value += ".jsonl"

    if "/" in value or "\\" in value or ".." in value:
        return "All.jsonl"

    return value


def list_dates() -> List[str]:
    if not LOGPOST_DIR.exists():
        return []

    dates = [p.name for p in LOGPOST_DIR.iterdir() if p.is_dir()]
    dates.sort(reverse=True)
    return dates


def list_events(date: str) -> List[str]:
    date = safe_date(date)
    if not date:
        return []

    date_dir = LOGPOST_DIR / date
    if not date_dir.exists():
        return []

    events = [
        p.name
        for p in date_dir.iterdir()
        if p.is_file() and p.name.endswith(".jsonl")
    ]

    events.sort()
    return events


def read_jsonl_tail(path: Path, limit: int) -> List[Dict[str, Any]]:
    if not path.exists():
        return []

    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
    except FileNotFoundError:
        return []

    if limit > 0:
        lines = lines[-limit:]

    rows: List[Dict[str, Any]] = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            obj = {
                "Event": "InvalidJsonLine",
                "Raw": line,
            }

        rows.append(obj)

    return rows


def search_rows(rows: List[Dict[str, Any]], query: str) -> List[Dict[str, Any]]:
    query = query.strip().lower()
    if not query:
        return rows

    out: List[Dict[str, Any]] = []

    for row in rows:
        text = json.dumps(row, ensure_ascii=False).lower()
        if query in text:
            out.append(row)

    return out


def param_values(row: Dict[str, Any]) -> List[Tuple[int, str, str]]:
    result: List[Tuple[int, str, str]] = []

    for key, value in row.items():
        if not key.startswith("Param"):
            continue

        rest = key[5:]
        if "_" not in rest:
            continue

        num_text, name = rest.split("_", 1)
        if not num_text.isdigit():
            continue

        result.append((int(num_text), name, str(value or "")))

    result.sort(key=lambda x: x[0])
    return result


INDEX_HTML = """<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>BZSS LogPost Viewer</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
  color-scheme: dark;
  --bg: #0f1116;
  --panel: #171a21;
  --panel2: #202530;
  --text: #e7eaf0;
  --muted: #9aa4b2;
  --line: #303746;
  --accent: #6aa6ff;
  --red: #ff6b6b;
  --yellow: #ffd166;
  --green: #7bd88f;
  --cyan: #64d2ff;
  --magenta: #d18cff;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
}
header {
  padding: 14px 18px;
  background: #0b0d12;
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
}
h1 {
  font-size: 17px;
  margin: 0;
  font-weight: 650;
}
.small { color: var(--muted); font-size: 12px; }
.toolbar {
  padding: 12px 18px;
  background: var(--panel);
  border-bottom: 1px solid var(--line);
  display: grid;
  grid-template-columns: 160px 260px 1fr 100px 90px;
  gap: 10px;
  align-items: center;
}
select, input, button {
  background: var(--panel2);
  color: var(--text);
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
}
button {
  cursor: pointer;
  background: #233047;
  border-color: #3b4d70;
}
button:hover { background: #2a3a57; }
main { padding: 14px 18px 40px; }
.status { color: var(--muted); margin-bottom: 10px; font-size: 13px; }
.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 10px;
  overflow: hidden;
}
.table th, .table td {
  border-bottom: 1px solid var(--line);
  padding: 8px 9px;
  vertical-align: top;
  font-size: 12px;
}
.table th {
  background: #11151d;
  color: var(--muted);
  text-align: left;
  position: sticky;
  top: 0;
  z-index: 1;
}
.event {
  font-weight: 700;
  white-space: nowrap;
}
.event.On_PlayerDamaged { color: var(--yellow); }
.event.On_PlayerWounded { color: var(--red); }
.event.On_PlayerDied { color: var(--magenta); }
.event.On_PlayerSpawnRequested { color: var(--cyan); }
.event.On_SquadCreated { color: var(--green); }
.params {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.param {
  background: #10141c;
  border: 1px solid #2b3445;
  border-radius: 999px;
  padding: 2px 7px;
  color: #dbe4f0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.param.empty {
  color: #657083;
}
.raw {
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  max-width: 680px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
details summary {
  cursor: pointer;
  color: var(--accent);
  margin-top: 4px;
}
pre {
  white-space: pre-wrap;
  word-break: break-word;
  background: #0b0d12;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
  color: #c9d4e5;
}
@media (max-width: 900px) {
  .toolbar { grid-template-columns: 1fr; }
  .raw { max-width: 280px; }
}
</style>
</head>
<body>
<header>
  <h1>BZSS LogPost Viewer</h1>
  <div class="small">只读查询 LogPost</div>
</header>

<section class="toolbar">
  <select id="dateSelect"></select>
  <select id="eventSelect"></select>
  <input id="queryInput" placeholder="搜索任意字段 / Raw / 玩家名 / SteamID">
  <input id="limitInput" type="number" value="500" min="1" max="2000">
  <button id="refreshBtn">刷新</button>
</section>

<main>
  <div class="status" id="status">加载中...</div>
  <table class="table">
    <thead>
      <tr>
        <th style="width: 72px;">Seq</th>
        <th style="width: 175px;">Time</th>
        <th style="width: 190px;">Event</th>
        <th>Params</th>
        <th>Raw</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
</main>

<script>
const dateSelect = document.getElementById("dateSelect");
const eventSelect = document.getElementById("eventSelect");
const queryInput = document.getElementById("queryInput");
const limitInput = document.getElementById("limitInput");
const refreshBtn = document.getElementById("refreshBtn");
const tbody = document.getElementById("tbody");
const statusEl = document.getElementById("status");

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[c]));
}

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function loadDates() {
  const data = await api("/api/dates");
  dateSelect.innerHTML = "";
  for (const d of data.dates) {
    const opt = document.createElement("option");
    opt.value = d;
    opt.textContent = d;
    dateSelect.appendChild(opt);
  }
  await loadEvents();
}

async function loadEvents() {
  const date = dateSelect.value;
  const data = await api(`/api/events?date=${encodeURIComponent(date)}`);
  eventSelect.innerHTML = "";
  const all = document.createElement("option");
  all.value = "All.jsonl";
  all.textContent = "All.jsonl";
  eventSelect.appendChild(all);
  for (const ev of data.events) {
    if (ev === "All.jsonl") continue;
    const opt = document.createElement("option");
    opt.value = ev;
    opt.textContent = ev;
    eventSelect.appendChild(opt);
  }
  await loadRows();
}

function renderParams(params) {
  if (!params || params.length === 0) return "";
  return `<div class="params">` + params.map(p => {
    const value = p.value || "";
    const cls = value ? "param" : "param empty";
    const text = value ? value : "-";
    return `<span class="${cls}" title="${esc(p.name)}">${esc(text)}</span>`;
  }).join("") + `</div>`;
}

function renderRows(rows) {
  tbody.innerHTML = "";

  for (const row of rows) {
    const tr = document.createElement("tr");
    const raw = row.Raw || "";
    const event = row.Event || "";
    tr.innerHTML = `
      <td>${esc(row.Seq || "")}</td>
      <td>${esc(row.LogTime || row.Time || "")}</td>
      <td><span class="event ${esc(event)}">${esc(event)}</span></td>
      <td>${renderParams(row.Params)}</td>
      <td>
        <div class="raw" title="${esc(raw)}">${esc(raw)}</div>
        <details>
          <summary>JSON</summary>
          <pre>${esc(JSON.stringify(row, null, 2))}</pre>
        </details>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

async function loadRows() {
  const date = dateSelect.value;
  const event = eventSelect.value || "All.jsonl";
  const q = queryInput.value || "";
  const limit = limitInput.value || "500";

  statusEl.textContent = "读取中...";

  const data = await api(
    `/api/rows?date=${encodeURIComponent(date)}&event=${encodeURIComponent(event)}&q=${encodeURIComponent(q)}&limit=${encodeURIComponent(limit)}`
  );

  renderRows(data.rows);
  statusEl.textContent = `日期 ${data.date} / 文件 ${data.event} / 显示 ${data.rows.length} 条`;
}

dateSelect.addEventListener("change", loadEvents);
eventSelect.addEventListener("change", loadRows);
refreshBtn.addEventListener("click", loadRows);
queryInput.addEventListener("keydown", e => {
  if (e.key === "Enter") loadRows();
});

loadDates().catch(err => {
  statusEl.textContent = "加载失败：" + err.message;
});
</script>
</body>
</html>
"""


class LogPostWebHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        if path == "/":
            return text_response(self, INDEX_HTML)

        if path == "/api/dates":
            return json_response(self, {"dates": list_dates()})

        if path == "/api/events":
            date = safe_date(qs.get("date", [""])[0])
            return json_response(self, {
                "date": date,
                "events": list_events(date),
            })

        if path == "/api/rows":
            date = safe_date(qs.get("date", [""])[0])
            event_file = safe_event_file(qs.get("event", ["All.jsonl"])[0])
            query = qs.get("q", [""])[0]

            try:
                limit = int(qs.get("limit", ["500"])[0])
            except ValueError:
                limit = 500

            limit = max(1, min(limit, MAX_LINES_PER_REQUEST))

            if not date:
                return json_response(self, {"error": "Invalid date"}, status=400)

            file_path = LOGPOST_DIR / date / event_file
            rows = read_jsonl_tail(file_path, limit)
            rows = search_rows(rows, query)

            shaped = []
            for row in rows:
                item = dict(row)
                item["Params"] = [
                    {"index": i, "name": name, "value": value}
                    for i, name, value in param_values(row)
                ]
                shaped.append(item)

            return json_response(self, {
                "date": date,
                "event": event_file,
                "rows": shaped,
            })

        return text_response(self, "Not Found", "text/plain; charset=utf-8", status=404)


def main() -> None:
    global CONFIG, LOGPOST_DIR, MAX_LINES_PER_REQUEST

    config_path = "config.json"
    if len(sys.argv) >= 2:
        config_path = sys.argv[1]

    CONFIG = load_config(config_path)
    web_config = CONFIG.get("logpost_web", {})

    host = str(web_config.get("host", "127.0.0.1"))
    port = int(web_config.get("port", 7790))
    LOGPOST_DIR = Path(str(web_config.get("output_dir", CONFIG.get("output_dir", "./LogPost"))))
    MAX_LINES_PER_REQUEST = int(web_config.get("max_lines_per_request", 2000))

    server = ThreadingHTTPServer((host, port), LogPostWebHandler)
    print(f"[INFO] LogPost Web Viewer: http://{host}:{port}")
    print(f"[INFO] LogPost Dir: {LOGPOST_DIR}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[INFO] Web viewer stopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
