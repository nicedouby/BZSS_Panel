# BZSS Combat WS Test Client

用于验证 `/ws/combat` 的 hello、welcome、批量战斗事件、match.finished、ACK、重发、心跳和重连。

```powershell
$env:BZSS_COMBAT_WS_TOKEN="12345"
$env:COMBAT_WS_URL="ws://127.0.0.1:8899/ws/combat"
node tools/combat-ws-test-client/server.mjs
```

浏览器打开 `http://127.0.0.1:39080`。页面可关闭自动 ACK/Pong/重连、设置 ACK 延迟、发送错误 JSON，并导出完整报文记录。
