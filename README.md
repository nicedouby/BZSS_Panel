# BZSS Panel

## 配置

运行配置位于 `config/panel/`，按命名空间拆分；该目录中的文件同时作为部署模板。业务代码仍使用 `config.get("rcon.port")` 等统一路径。运行时敏感项必须通过环境变量提供：`BZSS_RCON_PASSWORD`、`BZSS_STEAM_API_KEY`、`BZSS_ASTRBOT_TOKEN`、`BZSS_BOOTSTRAP_ADMIN_PASSWORD`（可选 IPInfo Token：`BZSS_IPINFO_TOKEN`）。

旧部署可先执行 `npm run config:migrate`，确认新目录后再将旧 `config.json` 重命名为 `config.json.legacy`。LogPost 独立配置位于 `config/logpost.json`。可通过 `npm run config:validate` 检查命名空间归属与后台设置路径。

BZSS Panel now uses the Vue client in `web-client/` as the primary frontend shell, while the backend code lives under `app/`.

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
