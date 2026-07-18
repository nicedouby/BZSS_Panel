# BZSS Panel

BZSS Panel now uses the Vue client in `web-client/` as the primary frontend shell, while the backend code lives under `app/`.

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

Build a clean portable release directory:

```bash
npm run release:portable
```

## Notes

- Production static hosting serves `web-client/dist`. After pulling frontend source changes, run `npm run client:build` before restarting the backend; `dist` is intentionally not committed.
- `config.web.useVueClient` should stay enabled for the Vue client.
- The legacy shell now lives at `app/web/` and should not receive new features.
- `npm run release:portable` creates `release/portable/`, with runtime data at the root and backend source/dependencies grouped under `app/`.
- Auxiliary material is grouped under `support/`, with runtime assets, reference data, tools, docs, vendor archives, and adjacent side projects kept out of the main root.
