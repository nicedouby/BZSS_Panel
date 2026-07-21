# BZSS Panel

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
