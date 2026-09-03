// -*- coding: utf-8 -*-

import path from "node:path";
import { execFile } from "node:child_process";
import { resolveSquadServerPath } from "./squad-server-path.js";

const ALLOWED_DIRECTIVES = new Set([
  "SetTime",
  "SetWeather",
  "Cheer",
  "SetFobResourceRegeneration",
  "SetAutomaticHeal",
  "SetAutomaticHealValue",
  "SpawnVehicle",
  "AdminTrack",
  "RemoveAdminTrack",
  "DragCapturePoint",
  "Kill",
  "RearmSoldier",
]);

/**
 * The single execution boundary for BZSS-Core save-game directives.
 * Both HTTP actions and background schedulers use this service so validation,
 * process execution, timeouts, and diagnostics cannot drift apart.
 */
export class BzssCoreCommandService {
  constructor({ config, logger, executor = execFileAsync } = {}) {
    this.config = config;
    this.logger = logger;
    this.executor = executor;
  }

  async execute(input = {}) {
    const source = String(input?.source ?? "unknown").trim() || "unknown";
    const config = this.config?.get?.("bzssCore", {}) ?? {};
    const scriptPath = String(config.modifyScriptPath ?? config.modifySaveGamePath ?? "").trim();
    const saveGamePath = String(config.remoteSaveGamePath ?? config.saveGamePath ?? "").trim();
    const batchCommands = Array.isArray(input?.batch)
      ? input.batch
        .map((item) => typeof item === "string" ? item : item?.command)
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
        .map((item) => this.normalize({ command: item }))
      : null;

    if (batchCommands?.some((item) => !item.ok)) {
      return { ...batchCommands.find((item) => !item.ok), source };
    }

    const command = batchCommands?.length
      ? { ok: true, directive: "Batch", command: batchCommands.map((item) => item.command) }
      : this.normalize(input);

    if (!scriptPath) {
      return { ok: false, error: "MissingModifyScriptPath", message: "ModifySaveGame.py path is not configured.", source };
    }
    if (!saveGamePath) {
      return { ok: false, error: "MissingRemoteSaveGamePath", message: "Remote save game path is not configured.", source };
    }
    if (!command.ok) return { ...command, source };

    const resolvedScriptPath = path.isAbsolute(scriptPath) ? scriptPath : path.resolve(process.cwd(), scriptPath);
    const resolvedSaveGamePath = resolveSquadServerPath(saveGamePath);
    const startedAt = Date.now();
    try {
      const output = await this.executor("python", [
        resolvedScriptPath,
        resolvedSaveGamePath,
        ...(Array.isArray(command.command) ? command.command : [command.command]),
      ], {
        cwd: path.dirname(resolvedScriptPath),
        timeout: Math.max(1000, Number(this.config?.get?.("bzssCore.timeoutMs", 15000)) || 15000),
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
      const result = {
        ok: true,
        command: Array.isArray(command.command) ? command.command.join("\n") : command.command,
        directive: command.directive,
        source,
        scriptPath: resolvedScriptPath,
        remoteSaveGamePath: resolvedSaveGamePath,
        stdout: output.stdout,
        stderr: output.stderr,
        durationMs: Date.now() - startedAt,
      };
      this.logger?.info?.(`[BZSS Core] ${result.command}`, {
        operation: "bzssCoreCommand.execute",
        data: { source, directive: command.directive, durationMs: result.durationMs },
      });
      return result;
    } catch (error) {
      const result = {
        ok: false,
        error: "BzssCoreExecuteFailed",
        message: error?.message ?? "Failed to execute BZSS-Core command.",
        command: Array.isArray(command.command) ? command.command.join("\n") : command.command,
        directive: command.directive,
        source,
        scriptPath: resolvedScriptPath,
        remoteSaveGamePath: resolvedSaveGamePath,
        stdout: String(error?.stdout ?? ""),
        stderr: String(error?.stderr ?? ""),
        exitCode: error?.code ?? null,
        durationMs: Date.now() - startedAt,
      };
      this.logger?.error?.(`[BZSS Core] command failed: ${result.message}`, {
        operation: "bzssCoreCommand.execute",
        data: { source, directive: command.directive, durationMs: result.durationMs },
      });
      return result;
    }
  }

  normalize(input = {}) {
    const directive = String(input.directive ?? "").trim();
    const parameter = String(input.parameter ?? input.value ?? "").trim();
    const rawCommand = String(input.command ?? "").trim();

    if (input?.raw === true) {
      if (!rawCommand) return invalid("MissingBzssCoreCommand", "Raw command is required.");
      if (/\r|\n/.test(rawCommand)) return invalid("InvalidBzssCoreCommand", "Raw command must be a single line.");
      const match = rawCommand.match(/^([A-Za-z]+):(.*)$/);
      if (match?.[1] === "EnableLocalVOIP") {
        return invalid(
          "UnsupportedBzssCoreDirective",
          "EnableLocalVOIP has been replaced by PATCH /api/bzss-core/variables.",
        );
      }
      if (match?.[1] === "SpawnVehicle") {
        const validation = this.validateSpawnVehicleParameter(match[2]);
        if (!validation.ok) return validation;
      }
      if (match?.[1] === "DragCapturePoint") {
        const validation = this.validateDragCapturePointParameter(match[2]);
        if (!validation.ok) return validation;
      }
      if (match?.[1] === "Kill") {
        const validation = this.validateKillParameter(match[2]);
        if (!validation.ok) return validation;
      }
      if (match?.[1] === "Cheer" && /^#\d+$/.test(String(match[2] ?? "").trim())) {
        return this.normalizeDirective("Kill", String(match[2]).trim().slice(1));
      }
      return { ok: true, directive: "Raw", parameter: rawCommand, command: rawCommand, raw: true };
    }

    if (rawCommand) {
      const match = rawCommand.match(/^([A-Za-z]+):(.*)$/);
      if (!match) return invalid("InvalidBzssCoreCommand", "Command must use Directive:Value format.");
      return this.normalizeDirective(match[1], match[2]);
    }
    return this.normalizeDirective(directive, parameter);
  }

  normalizeDirective(directive, parameter) {
    let normalizedDirective = String(directive ?? "").trim();
    let text = String(parameter ?? "").trim();

    // Historical player-detail builds used Cheer:#<ListPlayersID> as the kill
    // command. Preserve legitimate Cheer values, but never let that legacy kill
    // signature reach ModifySaveGame.py as Cheer again.
    if (normalizedDirective === "Cheer" && /^#\d+$/.test(text)) {
      normalizedDirective = "Kill";
      text = text.slice(1);
    }

    if (!ALLOWED_DIRECTIVES.has(normalizedDirective)) {
      return invalid("UnsupportedBzssCoreDirective", `Supported directives: ${[...ALLOWED_DIRECTIVES].join(", ")}.`);
    }
    if (!text) return invalid("MissingBzssCoreParameter", `${normalizedDirective} requires a parameter.`);
    if (/\r|\n/.test(text)) return invalid("InvalidBzssCoreParameter", "Parameter must be a single line.");
    if (normalizedDirective === "SetAutomaticHeal" && !/^[01]$/.test(text)) {
      return invalid("InvalidAutomaticHealParameter", "SetAutomaticHeal only accepts 1 (enabled) or 0 (disabled).");
    }
    if (normalizedDirective === "SetWeather" && !/^(?:[0-9]|1[0-2]),\d+$/.test(text)) {
      return invalid("InvalidWeatherParameter", "SetWeather requires WeatherIndex 0-12 and a non-negative transition in seconds.");
    }
    if (normalizedDirective === "SpawnVehicle") {
      const validation = this.validateSpawnVehicleParameter(text);
      if (!validation.ok) return validation;
    }
    if (normalizedDirective === "DragCapturePoint") {
      const validation = this.validateDragCapturePointParameter(text);
      if (!validation.ok) return validation;
    }
    if (normalizedDirective === "Kill") {
      const validation = this.validateKillParameter(text);
      if (!validation.ok) return validation;
    }
    if (normalizedDirective === "RearmSoldier") {
      const validation = this.validateRearmSoldierParameter(text);
      if (!validation.ok) return validation;
    }
    return { ok: true, directive: normalizedDirective, parameter: text, command: `${normalizedDirective}:${text}` };
  }

  validateKillParameter(parameter) {
    const text = String(parameter ?? "").trim();
    if (!/^\d+$/.test(text)) {
      return invalid("InvalidKillPlayerId", "Kill requires the numeric player ID returned by ListPlayers.");
    }
    const playerId = Number(text);
    if (!Number.isSafeInteger(playerId) || playerId < 0) {
      return invalid("InvalidKillPlayerId", "Kill player ID must be a non-negative safe integer.");
    }
    return { ok: true };
  }

  validateRearmSoldierParameter(parameter) {
    const parts = String(parameter ?? "").split(",").map((part) => part.trim());
    if (parts.length !== 3) {
      return invalid("InvalidRearmSoldierParameter", "RearmSoldier requires PlayerId, item asset path, and inventory slot.");
    }

    const [playerId, itemPath, slot] = parts;
    if (!/^\\d+$/.test(playerId)) {
      return invalid("InvalidRearmSoldierPlayerId", "RearmSoldier PlayerId must be a non-negative integer.");
    }
    const numericPlayerId = Number(playerId);
    if (!Number.isSafeInteger(numericPlayerId) || numericPlayerId < 0) {
      return invalid("InvalidRearmSoldierPlayerId", "RearmSoldier PlayerId must be a non-negative safe integer.");
    }
    if (!itemPath || /[\\u0000-\\u001f\\u007f]/.test(itemPath) || !itemPath.startsWith("/Game/")) {
      return invalid("InvalidRearmSoldierItemPath", "RearmSoldier item path must be a single-line /Game/ asset path.");
    }
    if (!/^\\d+$/.test(slot)) {
      return invalid("InvalidRearmSoldierSlot", "RearmSoldier inventory slot must be a non-negative integer.");
    }
    const numericSlot = Number(slot);
    if (!Number.isSafeInteger(numericSlot) || numericSlot < 0) {
      return invalid("InvalidRearmSoldierSlot", "RearmSoldier slot must be a non-negative safe integer.");
    }
    return { ok: true };
  }

  validateDragCapturePointParameter(parameter) {
    const text = String(parameter ?? "").trim();
    // Match from the right so capture-point names may contain spaces and even commas.
    const match = text.match(/^(.+),([^,]+),([^,]+)$/);
    if (!match) {
      return invalid("InvalidDragCapturePointParameter", "DragCapturePoint requires point name, X, and Y.");
    }

    const pointIdentity = match[1].trim();
    const xText = match[2].trim();
    const yText = match[3].trim();
    if (!pointIdentity || /[\u0000-\u001f\u007f]/.test(pointIdentity)) {
      return invalid("InvalidDragCapturePointName", "DragCapturePoint point name must be a non-empty single-line name.");
    }

    // DragCapturePoint is name-addressed. Never silently accept a runtime
    // array index because BZSS-Core would move the wrong point or ignore it.
    if (/^\d+$/.test(pointIdentity)) {
      return invalid(
        "InvalidDragCapturePointName",
        "DragCapturePoint requires the complete point name; numeric point indexes are not accepted.",
      );
    }

    if (!xText || !yText || !Number.isFinite(Number(xText)) || !Number.isFinite(Number(yText))) {
      return invalid("InvalidDragCapturePointCoordinates", "DragCapturePoint X and Y must be finite numbers.");
    }
    return { ok: true };
  }

  validateSpawnVehicleParameter(parameter) {
    const parts = String(parameter ?? "").split(",").map((part) => part.trim());
    if (parts.length !== 4) {
      return invalid("InvalidSpawnVehicleParameter", "SpawnVehicle requires vehicle class path, X, Y, and Z.");
    }
    const [assetPath, ...coordinates] = parts;
    if (
      !/^\/Game\/[A-Za-z0-9_./-]+\.[A-Za-z0-9_-]+_C$/.test(assetPath)
      || /[\u0000-\u001f\u007f]/.test(assetPath)
    ) {
      return invalid(
        "InvalidSpawnVehicleAssetPath",
        "SpawnVehicle asset path must use /Game/.../Asset.Asset_C class format.",
      );
    }
    if (coordinates.some((value) => !value || !Number.isFinite(Number(value)))) {
      return invalid("InvalidSpawnVehicleCoordinates", "SpawnVehicle X, Y, and Z must be finite numbers.");
    }
    if (coordinates.some((value) => Math.abs(Number(value)) > 100_000_000)) {
      return invalid("InvalidSpawnVehicleCoordinates", "SpawnVehicle coordinates are outside the supported world range.");
    }
    return { ok: true };
  }
}

function invalid(error, message) {
  return { ok: false, error, message };
}

function execFileAsync(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });
  });
}
