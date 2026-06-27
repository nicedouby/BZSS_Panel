# RCON + Console Patch

这份补丁只做两件事：

1. 按 MicePanel_better 的设计实现 RCON。
2. 增强 Web 控制台：频道筛选、RCON 输入框、增量日志。

不新增 Web 页面，不改变 WebRegistry，不改变左侧栏结构。

## 新增文件

```text
core/id-parser.js
core/rcon.js
core/squad-rcon.js
```

## 替换文件

```text
core/rcon-manager.js
core/web-server.js
modules/console/index.js
modules/player-state/index.js
modules/squad-state/index.js
web/pages/console.js
web/assets/styles.css
```

## RCON 设计来源

来自旧项目 MicePanel_better：

```text
core/rcon.js
core/squad_rcon.js
services/squad_info.js
```

迁移原则：

- 低层 RCON 协议仍然独立在 `core/rcon.js`
- Squad 命令和 RCON 推送事件解析放在 `core/squad-rcon.js`
- BZSS 的 `core/rcon-manager.js` 负责连接生命周期、命令队列、限流、轮询和 Core Event 转发

## 控制台频道

ConsoleModule 使用环形缓冲区：

- 不让日志无限增长
- 支持 channel 筛选
- 支持 afterSeq 增量读取
- 支持 q 搜索
- 前端 DOM 保留上限，避免页面越跑越卡

默认频道：

```text
all
system
events
rcon
python
error
```

## 手动 RCON

Web 控制台 POST：

```text
POST /api/console/rcon
```

Body:

```json
{
  "command": "ListPlayers"
}
```

返回 RCON 执行结果，同时把输入和输出写入 `rcon` 频道。

## RCON 快照

RconManager 定时执行：

```text
ListPlayers
ListSquads
```

并发布 Core Event：

```text
RCON_LIST_PLAYERS_UPDATED
RCON_LIST_SQUADS_UPDATED
```

由：

```text
modules/player-state
modules/squad-state
```

吸收状态。

## 配置

参考：

```text
config.rcon.example.json
```

把里面的 `rcon` 和 `modules.console.maxLines` 合并到主 `config.json`。
