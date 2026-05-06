# Codex 开发准则

## 必须遵守的目录结构

不要创建 `src/`。

顶层固定：

```text
core/
modules/
plugins/
web/
contracts/
docs/
```

## Core 规则

Core 只提供基础能力。

Core 不写具体玩法规则。

Core 可以包含：

- WebServer
- WebRegistry
- WebStatus
- EventBus
- RconManager
- PythonLogParserManager

## Module 规则

Module 是看不见的业务能力层。

Module 可以：

- 订阅 Core Event
- 发布 Module Event
- 维护状态
- 给插件和 Web 提供 API

Module 不能依赖 Plugin。

## Plugin 规则

Plugin 只实现具体玩法/规则。

Plugin 不能直接发 RCON。

Plugin 不能直接维护全局玩家状态。

Plugin 应通过 Module API 做事。

## 高风险动作

跳边必须通过：

```js
modules.teamBalance.requestSwitchTeam(...)
```

解散小队必须通过：

```js
modules.squadManage.disbandSquad(...)
```

警告玩家必须通过：

```js
modules.warning.warnPlayer(...)
```

所有 RCON 最终必须经过：

```js
core.rconManager.dispatchCommand(...)
```

## Web 规则

Web 分成：

- Web Shell
- Web Registry
- Web Status
- Web Pages

页面不得直接执行高风险动作。

页面只调用后端 API。

详情用 Drawer，危险操作用 Modal。

## 契约

新增 Core / Module / Plugin / Web 页面时，必须参考：

```text
contracts/
```
