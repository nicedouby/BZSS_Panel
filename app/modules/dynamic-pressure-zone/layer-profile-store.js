// -*- coding: utf-8 -*-

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function createLayerProfileStore({ dataDir = "data/dynamic-pressure-zone", logger = null } = {}) {
  const layersDir = path.resolve(dataDir, "layers");

  async function init() {
    await mkdir(layersDir, { recursive: true });
  }

  async function get(layer) {
    const key = normalizeLayerKey(layer);
    if (!key) return null;
    try {
      const content = await readFile(path.join(layersDir, `${key}.json`), "utf8");
      return JSON.parse(content);
    } catch (error) {
      if (error?.code !== "ENOENT") logger?.warn?.(`[DynamicPressureZone] profile read failed: ${error.message}`);
      return null;
    }
  }

  async function save(profile) {
    const normalized = normalizeProfile(profile);
    const filePath = path.join(layersDir, `${normalizeLayerKey(normalized.layer)}.json`);
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(layersDir, { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
    return { profile: normalized, filePath };
  }

  return { init, get, save, layersDir };
}

export function normalizeProfile(profile = {}) {
  const layer = String(profile.layer ?? "").trim();
  if (!layer) throw new Error("Layer profile requires a non-empty layer name.");
  return {
    ...profile,
    layer,
    mapKey: String(profile.mapKey ?? "").trim(),
    mode: String(profile.mode ?? "").trim().toUpperCase(),
    mains: normalizeMains(profile.mains),
    objectives: normalizeObjectives(profile.objectives),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeMains(value) {
  const entries = Array.isArray(value)
    ? value.map((main) => [String(main?.teamId ?? main?.teamID ?? ""), main])
    : Object.entries(value ?? {});
  return Object.fromEntries(entries.map(([teamId, main]) => [teamId, {
    x: finite(main?.x ?? main?.position?.x),
    y: finite(main?.y ?? main?.position?.y),
  }]).filter(([teamId, main]) => (teamId === "1" || teamId === "2") && main.x != null && main.y != null));
}

function normalizeObjectives(value) {
  return (Array.isArray(value) ? value : []).map((objective, index) => ({
    id: String(objective?.id ?? objective?.name ?? `p${index + 1}`).trim() || `p${index + 1}`,
    name: String(objective?.name ?? objective?.id ?? `P${index + 1}`).trim() || `P${index + 1}`,
    x: finite(objective?.x ?? objective?.position?.x),
    y: finite(objective?.y ?? objective?.position?.y),
  })).filter((objective) => objective.x != null && objective.y != null);
}

function normalizeLayerKey(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
