# BZSS Combat Receiver

交给战绩系统客户使用的独立 WebSocket 接收端。无需安装 npm 依赖，只需要 Node.js 22+（推荐 Node.js 24 LTS）。

## 使用

1. 用文本编辑器打开 `config.json`。
2. 修改 `websocketUrl`、`token`、`clientId`；保存。
3. 双击 `start-client.bat`。
4. 浏览器打开 `http://127.0.0.1:39080` 查看连接和接收状态。

收到的数据会保存到 `data/`：

- `combat-events.ndjson`：每行一个伤害、击倒、击杀、复苏或 TK 事件。
- `match-finished.ndjson`：每行一个对局结束事件。
- `delivered-packets.json`：已确认 Packet ID，用于重连或程序重启后的去重。

客户端只有在事件成功落盘后才会向 Panel ACK；服务端重发的相同 Packet ID 会被去重后再次 ACK，因此不会重复写入战绩数据。
