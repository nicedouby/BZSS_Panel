# BZSS Panel Web 架构说明

当前仓库的 Web 分成两层：

- `web-client/`：主前端。后续所有新页面、组件、状态管理和查询逻辑都只放这里。
- `web/`：旧 Web Shell / 兼容层。只保留历史入口、兼容逻辑和旧说明，不再新增业务页面。

仓库其余层级保持不变：

```text
core/
modules/
plugins/
contracts/
```

## 1. 后端三层

### core

Core 是系统基础层：

- config-manager
- logger
- event-bus
- udp-event-receiver
- python-log-parser-manager
- rcon-manager
- web-server
- web-registry
- web-status
- module-manager
- plugin-manager

Core 不写具体玩法规则。

### modules

Module 是业务能力层：

- match-state
- console
- player-database
- player-state
- squad-state
- kill-manage
- playtime
- audit

Module 订阅 Core Event，发出 Module Event，并向插件和 Web 提供 API。

### plugins

Plugin 是具体玩法 / 规则扩展。

当前以模块化扩展为主，插件应依赖 `modules`，不要直接操作 RCON。

## 2. Web 分层

Web 的职责边界要明确，不能混用。

### 主前端

位置：

```text
web-client/src/app/router.ts
web-client/src/pages/
web-client/src/components/
web-client/src/stores/
web-client/src/composables/
web-client/src/utils/
```

职责：

- 路由注册
- 页面组合
- UI 状态管理
- API 调用
- 页面级交互

`web-client` 是当前主 UI。

### 旧 Web Shell / legacy

位置：

```text
web/index.html
web/app.js
web/layout/
web/pages/
```

职责：

- 兼容历史入口
- 保留旧 shell 的最小能力
- 只作为 legacy 和兼容层

约束：

- 不要再往 `web/pages/*.js` 新增业务页面
- 新页面统一放到 `web-client/src/pages/`
- 如果旧入口还在用，只能标记 legacy、跳转或保留兼容，不要继续扩展

### Web Registry / Web Status

位置：

```text
core/web-registry.js
core/web-status.js
```

职责：

- `web-registry.js` 维护页面注册和页面列表
- `web-status.js` 聚合顶栏需要的运行状态
- `GET /api/web/pages`
- `GET /api/web/status`

## 3. 页面分类与路由元数据

`web-client/src/app/router.ts` 是当前页面分类和布局策略的入口。

推荐的路由元数据：

```ts
{
  titleKey?: string;
  title?: string;
  fullBleed?: boolean;
  category?: "core" | "plugin" | "debug" | "system";
  refreshPolicy?: "realtime" | "polling" | "manual";
}
```

分类建议：

| 路由 | category | refreshPolicy | 备注 |
| --- | --- | --- | --- |
| `/match-status` | `core` | `realtime` | 对局主状态页 |
| `/console` | `core` | `realtime` | 控制台 |
| `/chat-monitor` | `core` | `realtime` | 聊天监控 |
| `/player-database` | `core` | `manual` | 查询型页面 |
| `/combat-clean` | `core` | `polling` | 战斗管理（处理后） |
| `/kill-manage` | `core` | `polling` | 击杀管理 |
| `/admin-warns` | `core` | `polling` | 警告记录 |
| `/squad-management` | `core` | `polling` | 小队管理 |
| `/plugins/infantry-combat-enhancer` | `plugin` | `polling` | 插件页 |
| `/plugins/group-report` | `plugin` | `polling` | 插件页 |
| `/plugins/server-info-statistics` | `plugin` | `polling` | 插件页 |
| `/plugin-subscriptions` | `system` | `polling` | 系统页 |
| `/system/status` | `system` | `polling` | 系统页 |
| `/debug/*` | `debug` | `manual` | 调试页 |

说明：

- `fullBleed` 只控制布局，不代表页面类别。
- 页面类别和刷新策略应该由路由元数据表达，而不是散落在页面内部。
- 新页面优先遵循这一套元数据，再决定顶部导航、刷新逻辑和布局宽度。

## 4. UI 原则

- 页面不能无限增长。
- `body` 禁止滚动，只有内容区内部滚动。
- 列表区域和详情区域都应独立滚动。
- 详情优先使用 Drawer。
- 高风险操作优先使用 Modal 确认。
- 页面不要各自发明一套样式体系，优先复用公共组件：
  - `AppPage`
  - `AppPageHeader`
  - `AppPageToolbar`
  - `AppCard`
  - `AppTable`
  - `AppSplitLayout`
  - `AppConfirmDialog`
  - `AppDangerButton`
  - `AppStatusBadge`

## 5. 事件流

```text
Python LogParser
  -> UDP
core.udpEventReceiver
  -> Core Event
modules
  -> Module Event
plugins / web
```

## 6. Python 自动启动

配置示例：

```json
"pythonLogParser": {
  "enabled": true,
  "workingDirectory": "./BZSS_LogParser",
  "scriptPath": "./main.py",
  "configPath": "./config.json",
  "autoStart": true
}
```

如果 Python 目录不同，只改 `workingDirectory`。
