// -*- coding: utf-8 -*-

import fs from "node:fs";
import path from "node:path";

/**
 * Resolves paths rooted at the Squad dedicated-server directory without
 * coupling configuration to a particular drive or panel install folder.
 */
export function resolveSquadServerPath(configuredPath, cwd = process.cwd()) {
  const value = String(configuredPath ?? "").trim();
  if (!value || path.isAbsolute(value)) return value;

  const direct = path.resolve(cwd, value);
  const normalized = value.split(path.sep).join("/").replace(/^\.\//, "");
  if (!normalized.toLowerCase().startsWith("squadgame/")) return direct;

  let candidate = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(candidate, "SquadGame"))) {
      return path.resolve(candidate, value);
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }

  return direct;
}
