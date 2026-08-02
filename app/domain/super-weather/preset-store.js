// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { normalizeTimeline, validateTimeline } from "./timeline.js";

export class SuperWeatherPresetStore {
  constructor({ dataDirectory = "./data/bzss-super-weather", logger } = {}) {
    this.dataDirectory = path.resolve(process.cwd(), dataDirectory);
    this.filePath = path.join(this.dataDirectory, "presets.json");
    this.logger = logger;
    this.presets = [];
    this.loaded = false;
  }

  async init() {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      const source = Array.isArray(parsed) ? parsed : parsed?.presets ?? [];
      this.presets = source.map(normalizePreset);
      if (Number(parsed?.version ?? 1) < 2 || JSON.stringify(source) !== JSON.stringify(this.presets)) {
        await this.persist();
        this.logger?.info?.("[SuperWeather] Migrated presets to zero-width transition nodes.");
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      this.presets = [createDefaultPreset()];
      await this.persist();
    }
    this.loaded = true;
    return this.list();
  }

  list() {
    return clone(this.presets);
  }

  get(id) {
    const preset = this.presets.find((item) => item.id === String(id ?? ""));
    return preset ? clone(preset) : null;
  }

  async create(input = {}) {
    const preset = normalizePreset({
      ...input,
      id: uniqueId(input.id || input.name || "weather-preset", this.presets),
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this.assertValid(preset);
    this.presets.push(preset);
    await this.persist();
    return clone(preset);
  }

  async update(id, patch = {}) {
    const index = this.presets.findIndex((item) => item.id === String(id ?? ""));
    if (index < 0) throw storeError("PresetNotFound", "Weather preset was not found.", 404);
    const existing = this.presets[index];
    const next = normalizePreset({
      ...existing,
      ...patch,
      id: existing.id,
      version: Number(existing.version ?? 0) + 1,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    this.assertValid(next);
    this.presets[index] = next;
    await this.persist();
    return clone(next);
  }

  async delete(id) {
    const index = this.presets.findIndex((item) => item.id === String(id ?? ""));
    if (index < 0) throw storeError("PresetNotFound", "Weather preset was not found.", 404);
    const [removed] = this.presets.splice(index, 1);
    await this.persist();
    return clone(removed);
  }

  async duplicate(id, name = "") {
    const source = this.get(id);
    if (!source) throw storeError("PresetNotFound", "Weather preset was not found.", 404);
    return this.create({
      ...source,
      id: "",
      name: String(name ?? "").trim() || `${source.name} Copy`,
      timeline: source.timeline.map((segment) => ({ ...segment, id: `weather-${crypto.randomUUID()}` })),
    });
  }

  assertValid(preset) {
    if (!preset.name) throw storeError("InvalidPresetName", "Preset name is required.", 400);
    if (preset.endBehavior !== "hold_last") throw storeError("InvalidEndBehavior", "Only hold_last is supported.", 400);
    const validation = validateTimeline(preset.timeline);
    if (!validation.ok) throw storeError("InvalidWeatherTimeline", validation.errors.join(" "), 400, validation.errors);
  }

  async persist() {
    await fs.mkdir(this.dataDirectory, { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    const payload = `${JSON.stringify({ version: 2, presets: this.presets }, null, 2)}\n`;
    await fs.writeFile(tempPath, payload, "utf8");
    await fs.rename(tempPath, this.filePath);
  }
}

function normalizePreset(input = {}) {
  return {
    id: String(input.id ?? "").trim(),
    name: String(input.name ?? "").trim(),
    version: Math.max(1, Number(input.version) || 1),
    timeline: normalizeTimeline(input.timeline),
    endBehavior: "hold_last",
    createdAt: String(input.createdAt ?? ""),
    updatedAt: String(input.updatedAt ?? ""),
  };
}

function createDefaultPreset() {
  const now = new Date().toISOString();
  return normalizePreset({
    id: "summer-storm",
    name: "Summer Storm",
    version: 1,
    createdAt: now,
    updatedAt: now,
    timeline: [
      { id: "weather-clear", type: "weather", weatherType: 0, durationSeconds: 2400, transitionToNextSeconds: 120 },
      { id: "weather-rain", type: "weather", weatherType: 5, durationSeconds: 2400, transitionToNextSeconds: 90 },
      { id: "weather-snow", type: "weather", weatherType: 10, durationSeconds: 2400, transitionToNextSeconds: 0 },
    ],
  });
}

function uniqueId(value, presets) {
  const base = String(value ?? "weather-preset").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "weather-preset";
  let candidate = base;
  let suffix = 2;
  while (presets.some((item) => item.id === candidate)) candidate = `${base}-${suffix++}`;
  return candidate;
}

function storeError(code, message, statusCode, details = null) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  error.details = details;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
