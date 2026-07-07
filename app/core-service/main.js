#!/usr/bin/env node
// -*- coding: utf-8 -*-

import { startCoreRuntime } from "../shared/bootstrap.js";

async function main() {
  const app = await startCoreRuntime({
    role: "core-service",
    enableCoreControl: true,
    enableReserveExchange: true,
  });

  app.logger.info("BZSS Core Service started.", {
    scope: "app",
    source: "app.core-service",
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

