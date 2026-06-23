# BZSS Panel 公共接口客户接入指南

本文档用于说明如何接入 `BZSS Panel` 的只读公共接口，包括鉴权方式、WS 连接方式，以及玩家信息接口的使用示例。

## 1. 接口概览

公共接口默认前缀：

- HTTP: `/api/public/v1`
- WebSocket: `/ws/public/v1`

常用能力：

- 获取服务器摘要
- 获取当前对局玩家列表
- 获取特定玩家详情
- 获取小队、战术视图等只读数据

## 2. Token 鉴权

公共接口默认需要 `Bearer Token`。

Token 需要由服务端管理员预先配置在：

```json
modules.publicInterface.tokens
```

每个 token 会绑定可访问的 scope，例如：

- `server:read`
- `players:read`
- `squads:read`
- `match:read`
- `tactical:read`
- `ws:read`

### HTTP 调用方式

```http
Authorization: Bearer <token>
```

### WebSocket 调用方式

WebSocket 通过连接地址携带 token：

```text
ws://127.0.0.1:12864/ws/public/v1?token=<token>
```

如果服务端开启了匿名访问，也可以不带 token，但通常不建议对外开放匿名模式。

## 3. 玩家接口

### 获取当前对局全部玩家

发送消息：

```json
{ "type": "players:list" }
```

返回内容包含每个玩家的关键信息，例如：

- `name`
- `playerID`
- `playerIdLabel`
- `steam64ID`
- `eosID`
- `ip`
- `latency`
- `isLeader`
- `role`
- `teamID`
- `squadID`
- `ftIndex`
- `ftPosition`
- `health`
- `currentWeapon`
- `ammoValues`
- `position`
- `rotation`

### 获取特定玩家信息

发送消息：

```json
{ "type": "players:detail", "query": { "playerID": "# 1" } }
```

支持的查询字段：

- `playerID`
- `steam64ID`
- `eosID`
- `name`

如果按名称查询时命中多个玩家，接口会返回所有匹配项，不会只保留第一条。

## 4. 最小示例

### 使用 Node 调试脚本

```bash
node tools/test_public_interface_ws.js --token <token>
```

也可以把 token 放到环境变量中：

```bash
set PUBLIC_INTERFACE_TOKEN=<token>
node tools/test_public_interface_ws.js
```

Linux / macOS:

```bash
export PUBLIC_INTERFACE_TOKEN=<token>
node tools/test_public_interface_ws.js
```

### 读取单个玩家

```bash
node tools/test_public_interface_ws.js --token <token> --name "Alpha"
node tools/test_public_interface_ws.js --token <token> --player-id "1"
node tools/test_public_interface_ws.js --token <token> --steam-id "7656119..."
node tools/test_public_interface_ws.js --token <token> --eos-id "eos-..."
```

## 5. 返回示例

玩家数据返回后，常见结构如下：

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
      "playerIdLabel": "# 1",
      "name": "Alpha",
      "position": { "x": 1, "y": 2, "z": 3 },
      "rotation": { "x": 0, "y": 90, "z": 0 }
    }
  ]
}
```

## 6. 客户侧建议

- 不要把 token 写死在前端仓库里。
- 建议在服务端、网关或后端中转层读取 token。
- 如果 token 泄露，请立即在服务端配置中更换。
- 如果只需要特定数据，请按最小 scope 配置 token。

