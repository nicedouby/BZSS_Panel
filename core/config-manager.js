// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";

/**
 * Core: ConfigManager
 *
 * 负责读取配置和按点路径查询配置。
 */
export class ConfigManager {
  constructor(configPath) {
    this.configPath = path.resolve(process.cwd(), configPath);
    this.config = {};
  }

  async load() {
    const text = await fs.readFile(this.configPath, "utf8");
    this.config = JSON.parse(text);
  }

  get(pathText, defaultValue = undefined) {
    if (!pathText) return this.config;

    const parts = pathText.split(".");
    let current = this.config;

    for (const part of parts) {
      if (current == null || typeof current !== "object" || !(part in current)) {
        return defaultValue;
      }
      current = current[part];
    }

    return current;
  }

  set(pathText, value) {
    const normalizedPath = normalizePath(pathText);
    assertPathIsSafe(normalizedPath);

    const parts = normalizedPath.split(".");
    let current = this.config;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const part = parts[index];
      if (current[part] == null || typeof current[part] !== "object" || Array.isArray(current[part])) {
        current[part] = {};
      }
      current = current[part];
    }

    current[parts[parts.length - 1]] = value;
    return value;
  }

  async save({ createBackup = true } = {}) {
    const dir = path.dirname(this.configPath);
    const tempPath = path.join(
      dir,
      `${path.basename(this.configPath)}.${process.pid}.${Date.now()}.tmp`,
    );
    const backupPath = `${this.configPath}.bak`;
    const payload = `${JSON.stringify(this.config, null, 2)}\n`;

    await fs.writeFile(tempPath, payload, "utf8");

    try {
      if (createBackup) {
        try {
          await fs.copyFile(this.configPath, backupPath);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }

      await fs.rename(tempPath, this.configPath);
    } catch (error) {
      if (isRenameTargetConflict(error)) {
        await fs.rm(this.configPath, { force: true });
        await fs.rename(tempPath, this.configPath);
      } else {
        throw error;
      }
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }

    return {
      ok: true,
      configPath: this.configPath,
      backupPath: createBackup ? backupPath : null,
    };
  }

  getExposedSettings() {
    const settingsEditor = this.get("settingsEditor", {}) ?? {};
    const enabled = Boolean(settingsEditor.enabled);
    const definitions = Array.isArray(settingsEditor.exposed) ? settingsEditor.exposed : [];

    return {
      enabled,
      settings: definitions
        .map((definition) => normalizeExposedSettingDefinition(definition))
        .filter((definition) => definition && !isSensitivePath(definition.path))
        .map((definition) => ({
          ...definition,
          value: cloneValue(this.get(definition.path)),
        })),
    };
  }

  async updateExposedSettings(changes) {
    const settingsEditor = this.get("settingsEditor", {}) ?? {};
    if (!settingsEditor.enabled) {
      throw createConfigError(403, "SettingsEditorDisabled", "Settings editor is disabled.");
    }

    const definitions = Array.isArray(settingsEditor.exposed) ? settingsEditor.exposed : [];
    const definitionsByPath = new Map();
    for (const rawDefinition of definitions) {
      const definition = normalizeExposedSettingDefinition(rawDefinition);
      if (!definition || isSensitivePath(definition.path)) continue;
      definitionsByPath.set(definition.path, definition);
    }

    if (!changes || typeof changes !== "object" || Array.isArray(changes)) {
      throw createConfigError(400, "InvalidChanges", "Changes must be an object map.");
    }

    const pending = [];
    let restartRequired = false;

    for (const [pathText, rawValue] of Object.entries(changes)) {
      const normalizedPath = normalizePath(pathText);
      assertPathIsSafe(normalizedPath);

      const definition = definitionsByPath.get(normalizedPath);
      if (!definition) {
        throw createConfigError(403, "SettingNotExposed", `Setting is not exposed: ${normalizedPath}`);
      }

      const value = normalizeSettingValue(definition, rawValue);
      pending.push({ path: normalizedPath, value });
      restartRequired = restartRequired || Boolean(definition.restartRequired);
    }

    if (!pending.length) {
      return {
        ...this.getExposedSettings(),
        restartRequired: false,
      };
    }

    for (const item of pending) {
      this.set(item.path, item.value);
    }

    await this.save();

    return {
      ...this.getExposedSettings(),
      restartRequired,
    };
  }
}

function normalizePath(pathText) {
  const normalized = String(pathText ?? "").trim();
  if (!normalized) {
    throw createConfigError(400, "InvalidPath", "Path must be a non-empty string.");
  }
  return normalized;
}

function assertPathIsSafe(pathText) {
  if (isSensitivePath(pathText)) {
      throw createConfigError(403, "SensitiveSettingBlocked", `Sensitive setting path is blocked: ${pathText}`);
    }
}

function isSensitivePath(pathText) {
  const lowered = String(pathText ?? "").toLowerCase();
  const blocked = ["password", "secret", "token", "auth.users", "rcon.password", "database"];
  return blocked.some((fragment) => lowered.includes(fragment));
}

function normalizeExposedSettingDefinition(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;

  const pathText = String(definition.path ?? "").trim();
  const type = String(definition.type ?? "").trim().toLowerCase();
  const label = String(definition.label ?? pathText).trim() || pathText;
  if (!pathText || !type) return null;
  if (!["boolean", "number", "string", "select"].includes(type)) return null;

  const result = {
    path: pathText,
    label,
    type,
    description: String(definition.description ?? "").trim(),
    restartRequired: Boolean(definition.restartRequired),
  };

  if (type === "number") {
    const min = Number(definition.min);
    const max = Number(definition.max);
    if (Number.isFinite(min)) result.min = min;
    if (Number.isFinite(max)) result.max = max;
  }

  if (type === "select") {
    result.options = normalizeSelectOptions(definition.options);
    if (!result.options.length) return null;
  }

  return result;
}

function normalizeSelectOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (option == null) return null;
      if (typeof option === "object" && !Array.isArray(option)) {
        const value = option.value ?? option.key ?? option.id;
        if (value == null) return null;
        const label = String(option.label ?? value).trim() || String(value);
        return {
          label,
          value: typeof value === "string" || typeof value === "number" || typeof value === "boolean"
            ? value
            : String(value),
        };
      }

      return {
        label: String(option),
        value: option,
      };
    })
    .filter(Boolean);
}

function normalizeSettingValue(definition, value) {
  if (value === undefined) {
    throw createConfigError(400, "InvalidSettingValue", `Missing value for ${definition.path}`);
  }

  switch (definition.type) {
    case "boolean":
      return normalizeBoolean(value, definition.path);
    case "number":
      return normalizeNumber(value, definition);
    case "string":
      return normalizeString(value, definition.path);
    case "select":
      return normalizeSelectValue(value, definition);
    default:
      throw createConfigError(400, "InvalidSettingType", `Unsupported setting type: ${definition.type}`);
  }
}

function normalizeBoolean(value, pathText) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 0) return false;
    if (value === 1) return true;
  }
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true" || lowered === "1") return true;
    if (lowered === "false" || lowered === "0") return false;
  }
  throw createConfigError(400, "InvalidSettingValue", `Invalid boolean value for ${pathText}`);
}

function normalizeNumber(value, definition) {
  const normalized = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(normalized)) {
    throw createConfigError(400, "InvalidSettingValue", `Invalid number value for ${definition.path}`);
  }

  if (Number.isFinite(definition.min) && normalized < definition.min) {
    throw createConfigError(400, "SettingBelowMin", `${definition.path} must be at least ${definition.min}`);
  }

  if (Number.isFinite(definition.max) && normalized > definition.max) {
    throw createConfigError(400, "SettingAboveMax", `${definition.path} must be at most ${definition.max}`);
  }

  return normalized;
}

function normalizeString(value, pathText) {
  if (value == null) {
    throw createConfigError(400, "InvalidSettingValue", `Invalid string value for ${pathText}`);
  }
  return String(value);
}

function normalizeSelectValue(value, definition) {
  const normalized = value == null ? "" : value;
  const matched = definition.options.find((option) => option.value === normalized)
    ?? definition.options.find((option) => String(option.value) === String(normalized));

  if (!matched) {
    throw createConfigError(400, "InvalidSettingValue", `Invalid select value for ${definition.path}`);
  }

  return matched.value;
}

function cloneValue(value) {
  if (value == null || typeof value !== "object") return value;
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value));
  }
}

function createConfigError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function isRenameTargetConflict(error) {
  return ["EEXIST", "EPERM", "EBUSY"].includes(error?.code);
}
