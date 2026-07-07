#!/usr/bin/env node
// -*- coding: utf-8 -*-

import { startWebRuntime } from "../shared/bootstrap.js";

async function main() {
  const app = await startWebRuntime();
  app.logger.info("BZSS Web Service started.", {
    scope: "app",
    source: "app.web-service",
  });

  const shutdown = async () => {
    await app.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[FATAL]", error);
  process.exit(1);
});

