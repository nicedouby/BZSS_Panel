# plugins

当前阶段不需要任何插件，所以本目录为空。

架构规则：

1. 插件依赖 modules。
2. 插件主要订阅 Module Event。
3. 插件不要直接调用 RCON。
4. 跳边必须通过 `modules.teamBalance`。
5. 插件可以注册自己的 Web 页面，但必须通过 `core.webRegistry.registerPage()`。
