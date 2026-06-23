# BZSS Panel

BZSS Panel now uses the Vue client in `web-client/` as the primary frontend shell.

## Development

Start the backend:

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

## Notes

- Production static hosting serves `web-client/dist`.
- `config.web.useVueClient` should stay enabled for the Vue client.
- The legacy `web/` directory is kept only as migration reference and should not receive new features.

## Docs

- [Public Interface 使用指南](docs/public-interface-guide.md)
