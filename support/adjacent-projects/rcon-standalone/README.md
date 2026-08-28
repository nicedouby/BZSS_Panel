# RCON Standalone

独立的 24 小时常驻 RCON Web 控制台。

## 启动

```bash
cd rcon-standalone
npm start
```

也可以直接双击 `run.bat`，它会读取本目录下的 `config.json`。

## 登录

用户名默认是 `DoubyBear`。启动前必须设置 `BZSS_RCON_STANDALONE_PASSWORD`；未设置时登录会被拒绝。

## 环境变量

- `RCON_HOST`
- `RCON_PORT`
- `RCON_PASSWORD`
- `RCON_HTTP_PORT`
- `BZSS_RCON_STANDALONE_PASSWORD`

优先级是：环境变量 > `rcon-standalone/config.json` > 内置默认值。
如果都不设置，默认监听 `0.0.0.0:3008`，RCON 配置为空时会拒绝执行命令。
