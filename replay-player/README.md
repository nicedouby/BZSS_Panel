# BZSS Replay Player

独立回放服务：不连接 BZSS Panel、不读取 Panel 内存状态，只读取回放根目录中的 `session.json` 和 `segments/*.rps`。

```powershell
cd replay-player
npm start -- --root "D:\BZSS_Replays" --host 127.0.0.1 --port 13000
```

打开 `http://127.0.0.1:13000`。可选配置文件是 `config/replay-player.json`；命令行参数优先。

HTTP API：`GET /api/replays`、`GET /api/replays/:id/state?at=120000`。

WebSocket：浏览器发出 `play`、`pause`、`seek`、`rate`，服务器以 333ms 节奏推送 `frame`。服务端只按需解码目标时间点，读取时最多保留当前及相邻两个 segment，不会把整局 `.rps` 装入内存。
