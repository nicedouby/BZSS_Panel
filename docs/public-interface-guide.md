# Public Interface 使用指南

这份指南说明 `BZSS Panel` 的公开只读接口如何访问，以及 `/api/public/v1/server` 新增的服务器摘要字段该怎么理解。

## 接口总览

公共接口默认前缀是 `/api/public/v1`，当前已开放这些路径：

- `GET /api/public/v1/health`
- `GET /api/public/v1/server`
- `GET /api/public/v1/players`
- `GET /api/public/v1/squads`
- `GET /api/public/v1/match`
- `GET /api/public/v1/tactical`
- `GET /api/public/v1/all`

除 `health` 外，其余接口默认都需要 Bearer Token。

## 鉴权方式

在请求头中加入：

```http
Authorization: Bearer <token>
```

Token 需要在配置里的 `modules.publicInterface.tokens` 中预先配置，并带上对应权限范围，例如：

- `server:read`
- `players:read`
- `squads:read`
- `match:read`
- `tactical:read`
- `ws:read`

## 新增的服务器摘要

`GET /api/public/v1/server` 和 `GET /api/public/v1/all` 里的 `server.summary` 会包含以下字段：

- `serverId`: 服务器 ID
- `serverName`: 服务器名称
- `playerCount`: 当前人数
- `queueCount`: 当前排队人数
- `currentMap`: 当前地图名称
- `currentLayer`: 当前图层名称
- `tps`: 当前 TPS
- `tpsStatus`: TPS 状态，通常为 `good`、`warning`、`critical` 或 `unknown`
- `rconTime`: `ShowServerInfo` 返回的对局/游戏时间
- `updatedAt`: 这一份摘要的更新时间

接口仍然保留原有的平铺字段，方便旧客户端继续使用。

## 示例

### 服务器接口

```bash
curl -H "Authorization: Bearer <token>" \
  http://127.0.0.1:12864/api/public/v1/server
```

返回结构示意：

```json
{
  "ok": true,
  "version": 1,
  "serverId": "BZSS_Main",
  "updatedAt": "2026-06-23T02:41:32.966Z",
  "data": {
    "serverId": "BZSS_Main",
    "serverName": "BZSS Main Server",
    "playerCount": 48,
    "queueCount": 2,
    "currentLayer": "Narva_RAAS_v1",
    "tps": 29,
    "playtime": 1234,
    "summary": {
      "serverId": "BZSS_Main",
      "serverName": "BZSS Main Server",
      "playerCount": 48,
      "queueCount": 2,
      "currentMap": "Narva",
      "currentLayer": "Narva_RAAS_v1",
      "tps": 29,
      "tpsStatus": "good",
      "rconTime": 1234,
      "updatedAt": "2026-06-23T02:41:32.966Z"
    }
  }
}
```

### 聚合接口

```bash
curl -H "Authorization: Bearer <token>" \
  http://127.0.0.1:12864/api/public/v1/all
```

`data.server.summary` 会和 `/server` 保持一致。

## 本地验证

可以使用仓库里的检查脚本快速确认接口是否可用：

```bash
python tools/test_public_interface.py --base-url http://127.0.0.1:12864 --token <token>
```

脚本会打印各接口状态，并额外显示 `server.summary` 的关键字段。

## 建议

- 如果你只需要面板概览，优先读 `server.summary`。
- 如果你需要更细的数据，再结合 `players`、`squads`、`match` 和 `tactical`。
- 如果某个字段为空，通常表示对应 RCON 刷新还没成功或当前模块未提供该数据。

## WS 玩家消息

现有 `GET /ws/public/v1` 保持不变，新增两类请求消息：

### 全量玩家快照

```json
{ "type": "players:list" }
```

返回示例：

```json
{
  "type": "players:list",
  "ok": true,
  "serverId": "BZSS_Main",
  "revision": 1719110000000,
  "updatedAt": "2026-06-23T06:12:00.000Z",
  "matchedCount": 48,
  "players": [
    {
      "name": "Alpha",
      "playerID": "1",
      "playerIdLabel": "# 1",
      "steam64ID": "7656119...",
      "eosID": "eos-...",
      "ip": "10.0.0.1",
      "latency": 35,
      "isLeader": true,
      "role": "Squad Leader",
      "teamID": "1",
      "squadID": "2",
      "ftIndex": 11,
      "ftPosition": 21,
      "health": 92,
      "currentWeapon": "M4",
      "ammoValues": [30, 90],
      "position": { "x": 1, "y": 2, "z": 3 },
      "rotation": { "x": 0, "y": 90, "z": 0 }
    }
  ]
}
```

### 特定玩家查询

```json
{ "type": "players:detail", "query": { "playerID": "# 1" } }
```

可用的查询键：
- `playerID`
- `steam64ID`
- `eosID`
- `name`

当 `name` 命中多个玩家时，返回多个结果，不会截断。

返回示例：

```json
{
  "type": "players:detail",
  "ok": true,
  "serverId": "BZSS_Main",
  "revision": 1719110000000,
  "updatedAt": "2026-06-23T06:12:00.000Z",
  "query": { "playerID": "1" },
  "matchedCount": 1,
  "players": [ { "...": "..." } ]
}
```

如果没有匹配玩家，`matchedCount` 为 `0`，`players` 返回空数组。
