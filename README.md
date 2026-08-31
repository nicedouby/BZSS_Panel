# BZSS Panel

## 配置

运行配置位于 `config/panel/`，按命名空间拆分；该目录中的文件同时作为部署模板。LogPost 和 Steam 辅助程序继续使用其原始配置文件。业务代码仍使用 `config.get("rcon.port")` 等统一路径。运行时敏感项可通过环境变量覆盖。

旧部署可先执行 `npm run config:migrate`，确认新目录后再将旧 `config.json` 重命名为 `config.json.legacy`。LogPost 继续读取原始 `LogPost/config.json`。可通过 `npm run config:validate` 检查命名空间归属与后台设置路径。

BZSS Panel now uses the Vue client in `web-client/` as the primary frontend shell, while the backend code lives under `app/`.

## 玩家账号绑定与快照

- 玩家在 QQ 群内发送 `/绑定Steam <17位 Steam64>`，AstrBot 调用 `POST /api/astrbot/bind` 完成绑定。
- Panel 将 QQ 号、QQ 昵称和绑定时间写入现有 `players` 表，全程不需要游戏内聊天交互。
- 当前对局玩家单元会显示“已绑定”标签；玩家数据库保留 QQ 与绑定时间。
- QQ 群内可通过 `/查询我的信息` 查询已绑定玩家；`/api/astrbot/me` 与 `/api/astrbot/me/snapshot` 分别提供玩家信息和 PNG 快照。

## Development

Start the backend on Windows with the configured CPU affinity:

```bat
run.bat
```

The launcher uses zero-based Windows logical CPU indices:

- Node WebCore: CPU 26 and CPU 27 (`0x0C000000`)
- Python LogPost parser: CPU 24 and CPU 25 (`0x03000000`)

The Python affinity is applied by `PythonLogParserManager` after the child process starts. It can be overridden with `pythonLogParser.processorAffinityCpus` in `config.json`.

Start the backend without the Windows affinity launcher:

```bash
npm start
```

Run the Vue client in dev mode:

```bash
npm run client:dev
```

Build the Vue client for production static hosting:

```bash
npm run client:build
```

Build a clean portable release directory:

```bash
npm run release:portable
```

## Notes

- Production static hosting serves `web-client/dist`. After pulling frontend source changes, run `npm run client:build` before restarting the backend; `dist` is intentionally not committed.
- `config.web.useVueClient` should stay enabled for the Vue client.
- The legacy shell now lives at `app/web/` and should not receive new features.
- `npm run release:portable` creates `release/portable/`, with runtime data at the root and backend source/dependencies grouped under `app/`.
- The portable `run.bat` uses the same Node affinity mask as the repository root launcher.
