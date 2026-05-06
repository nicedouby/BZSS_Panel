# BZSS Panel JS Starter

这是 BZSS Panel 的最基础 JS 启动程序。

它负责：

1. 接收 Python LogParser 通过 UDP 发来的事件
2. 将事件投递到 JS 内部 EventBus
3. 加载插件
4. 让插件订阅事件

当前不包含：

- 数据库
- WebSocket
- Web API
- 前端
- 权限系统
- TK 判定

这些后续再加。

## 目录结构

```text
BZSS_JS_Starter/
├─ package.json
├─ config.json
├─ run.bat
└─ src/
   ├─ main.js
   ├─ core/
   │  ├─ config-loader.js
   │  ├─ logger.js
   │  ├─ event-bus.js
   │  ├─ udp-receiver.js
   │  └─ plugin-manager.js
   ├─ plugins/
   │  ├─ debug-print-plugin.js
   │  └─ combat-summary-plugin.js
   └─ tools/
      └─ send-test-event.js
```

## 运行

需要 Node.js 18 或更高版本。

```bash
node src/main.js
```

或者：

```bash
npm start
```

Windows 可以直接运行：

```text
run.bat
```

## 测试 UDP 接收

第一个终端启动 receiver：

```bash
node src/main.js
```

第二个终端发送测试事件：

```bash
node src/tools/send-test-event.js
```

如果正常，你会看到类似输出：

```text
[EVENT] On_PlayerDied #1 | Braovo | -300.000000 | - | - | - | -
```

## 与 Python LogParser 对接

Python 端 `config.json` 应该保持：

```json
"udp": {
  "enabled": true,
  "host": "127.0.0.1",
  "port": 7788
}
```

JS 端 `config.json` 保持：

```json
"udp": {
  "host": "127.0.0.1",
  "port": 7788
}
```

## 插件写法

插件导出 `register(context)`：

```js
export async function register(context) {
  const unsubscribe = context.eventBus.on("On_PlayerWounded", (event) => {
    console.log(event);
  });

  return {
    name: "MyPlugin",
    shutdown() {
      unsubscribe();
    }
  };
}
```

插件路径配置在 `config.json`：

```json
"plugins": {
  "enabled": true,
  "paths": [
    "./src/plugins/debug-print-plugin.js"
  ]
}
```
