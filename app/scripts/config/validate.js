#!/usr/bin/env node
// -*- coding: utf-8 -*-
import { CONFIG_NAMESPACE_OWNERSHIP, ConfigManager } from "../../core/config-manager.js";

const config = new ConfigManager(process.env.BZSS_CONFIG_PATH || "./config/panel");
await config.load();
for (const namespace of Object.keys(config.get())) {
  if (!CONFIG_NAMESPACE_OWNERSHIP[namespace]) {
    throw new Error(`Config ownership missing: ${namespace}`);
  }
}
const exposed = config.get("settingsEditor.exposed", []);
for (const definition of exposed) {
  if (!definition?.path || config.get(definition.path) === undefined) {
    throw new Error(`Stale settingsEditor path: ${definition?.path ?? "<missing>"}`);
  }
}
console.log(`Config validation passed (${Object.keys(config.get()).length} namespaces, ${exposed.length} exposed settings).`);
