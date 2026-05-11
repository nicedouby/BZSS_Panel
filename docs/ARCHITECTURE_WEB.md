# BZSS Panel Web + 架构说明

本版本采用：

```text
core/
modules/
plugins/
web/
contracts/
```

## 1. 后端三层

### core

Core 是系统根基：

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

Module 是看不见的业务能力层：

- match-state
- console
- player-database
- player-state
- squad-state
- kill-manage
- team-balance
- playtime
- audit

Module 订阅 Core Event，发布 Module Event，提供 API 给插件和 Web。

### plugins

Plugin 是具体玩法/规则扩展。

当前为空。

插件应依赖 modules，不直接操作 RCON。

## 2. Web 分层

Web 内容分成四个概念，不能混淆：

### Web Shell

位于：

```text
web/index.html
web/app.js
web/layout/
```

职责：

- 顶部状态栏
- 左侧栏
- 内容滚动容器
- 弹窗 Modal
- 右侧抽屉 Drawer

### Web Registry

位于：

```text
core/web-registry.js
```

职责：

- 注册 Web 页面
- 区分 required / optional
- 向前端提供页面列表

API：

```text
GET /api/web/pages
```

### Web Status

位于：

```text
core/web-status.js
```

职责：

- 聚合顶部状态栏数据
- 任何页面都显示

API：

```text
GET /api/web/status
```

### Web Pages

位于：

```text
web/pages/
```

职责：

- 只负责显示页面和调用 API
- 不做 RCON
- 不做业务判断

## 3. 页面分类

不可禁用：

- 对局状态
- 控制台
- 玩家数据库

可禁用：

- 建队管理（已移除建队顺序页面）
- 击杀管理
- TeamBalance
- 暖服功能（保留运行态逻辑，不再提供独立模块）
- 积分系统（已移除独立模块）

## 4. UI 原则

- 页面不能无限延长
- body 禁止滚动
- 只有内容区内部滚动
- 表格区域内部滚动
- 详情使用 Drawer
- 危险操作使用 Modal

## 5. 事件流

```text
Python LogParser
  ↓ UDP
core.udpEventReceiver
  ↓ Core Event
modules
  ↓ Module Event
plugins / web
```

## 6. Python 自动启动

配置：

```json
"pythonLogParser": {
  "enabled": true,
  "workingDirectory": "./BZSS_LogParser",
  "scriptPath": "./main.py",
  "configPath": "./config.json",
  "autoStart": true
}
```

如果 Python 目录不同，修改 workingDirectory。
