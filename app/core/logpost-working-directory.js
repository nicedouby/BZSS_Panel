// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";

const LEGACY_PINNED_LOGPOST_PATH = /\/bzss_panel\/logpost\/?$/i;

export function resolveLogPostWorkingDirectory(configuredValue, cwd = process.cwd()) {
  const localDirectory = path.resolve(cwd, "LogPost");
  const configuredText = String(configuredValue ?? "./LogPost").trim() || "./LogPost";
  const configuredDirectory = path.resolve(cwd, configuredText);
  const normalizedConfigured = configuredText.replaceAll("\\", "/");

  // Older tracked configs pinned LogPost to E:\\BZSS_SQ_Server\\BZSS_Panel\\LogPost.
  // When the panel is run from a migrated/copy checkout, that silently starts
  // stale parser code. Prefer the LogPost next to the running panel whenever
  // that legacy pin is detected and the local parser is present.
  if (
    LEGACY_PINNED_LOGPOST_PATH.test(normalizedConfigured)
    && path.normalize(configuredDirectory).toLowerCase() !== path.normalize(localDirectory).toLowerCase()
    && fs.existsSync(path.join(localDirectory, "main.py"))
  ) {
    return localDirectory;
  }

  return configuredDirectory;
}
