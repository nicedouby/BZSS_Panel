// -*- coding: utf-8 -*-

/**
 * Core: RawLogDerivedEvents
 *
 * 监听 On_RawLogLine，把部分原生日志转换为更高层的 Core Event：
 * - LogNet: Join succeeded: <name>  -> PLAYER_CONNECTED
 * - LogNet: UNetConnection::Close: ... -> PLAYER_DISCONNECTED
 */

const RAW_LOG_EVENT_NAME = "On_RawLogLine";

export class RawLogDerivedEvents {
  constructor({ eventBus, logger, playerIdentityResolver } = {}) {
    this.eventBus = eventBus;
    this.logger = logger;
    this.playerIdentityResolver = typeof playerIdentityResolver === "function" ? playerIdentityResolver : null;

    this._unsubscribe = null;
  }

  start() {
    if (!this.eventBus || typeof this.eventBus.onCoreEvent !== "function") {
      throw new Error("RawLogDerivedEvents requires eventBus.onCoreEvent");
    }

    if (this._unsubscribe) return;

    this._unsubscribe = this.eventBus.onCoreEvent(RAW_LOG_EVENT_NAME, (event) => {
      this.handleRawLogEvent(event);
    });

    this.logger?.info?.("[RawLogDerivedEvents] started.");
  }

  stop() {
    if (this._unsubscribe) {
      try { this._unsubscribe(); } catch {}
      this._unsubscribe = null;
    }

    this.logger?.info?.("[RawLogDerivedEvents] stopped.");
  }

  handleRawLogEvent(event = {}) {
    const raw = String(event?.rawLog ?? event?.rawEvent?.Raw ?? "");
    if (!raw) return;

    const joinName = parseJoinSucceededName(raw);
    if (joinName) {
      const derived = this.buildDerivedEvent({
        sourceEvent: event,
        eventName: "PLAYER_CONNECTED",
        payload: {
          name: joinName,
          playerName: joinName,
        },
        paramMap: {
          PlayerName: joinName,
        },
      });

      this.emitDerived(derived);
      return;
    }

    const postLogin = parsePostLogin(raw);
    if (postLogin) {
      const resolvedName = this.resolvePlayerName({
        serverId: String(event?.serverId ?? ""),
        eosId: postLogin.eosId,
        steam64Id: postLogin.steam64Id,
        controllerId: postLogin.playerControllerId,
      });

      const payload = {
        ...(resolvedName ? { name: resolvedName, playerName: resolvedName } : {}),
        ip: postLogin.ip,
        playerControllerId: postLogin.playerControllerId,
        eosId: postLogin.eosId,
        steam64Id: postLogin.steam64Id,
      };

      const paramMap = {
        ...(resolvedName ? { PlayerName: resolvedName } : {}),
        ...(postLogin.ip ? { PlayerIP: postLogin.ip } : {}),
        ...(postLogin.eosId ? { PlayerEOSID: postLogin.eosId } : {}),
        ...(postLogin.steam64Id ? { PlayerSteam64ID: postLogin.steam64Id } : {}),
        ...(postLogin.playerControllerId ? { PlayerControllerID: postLogin.playerControllerId } : {}),
      };

      const derived = this.buildDerivedEvent({
        sourceEvent: event,
        eventName: "PLAYER_POST_LOGIN",
        payload,
        paramMap,
      });

      this.emitDerived(derived);
      return;
    }

    const disconnect = parseNetConnectionClose(raw);
    if (!disconnect) return;

    const resolvedName = this.resolvePlayerName({
      serverId: String(event?.serverId ?? ""),
      eosId: disconnect.eosId,
      steam64Id: disconnect.steam64Id,
      controllerId: disconnect.playerControllerId,
    });

    const payload = {
      ...(resolvedName ? { name: resolvedName, playerName: resolvedName } : {}),
      ip: cleanIp(disconnect.remoteAddr),
      remoteAddr: disconnect.remoteAddr,
      connectionName: disconnect.connectionName,
      driverName: disconnect.driverName,
      isServer: disconnect.isServer,
      playerControllerId: disconnect.playerControllerId,
      owner: disconnect.owner,
      uniqueId: disconnect.uniqueId,
      eosId: disconnect.eosId,
      steam64Id: disconnect.steam64Id,
      channels: disconnect.channels,
      connectionCloseTime: disconnect.closeTime,
    };

    const paramMap = {
      ...(resolvedName ? { PlayerName: resolvedName } : {}),
      ...(payload.ip ? { PlayerIP: payload.ip } : {}),
      ...(disconnect.eosId ? { PlayerEOSID: disconnect.eosId } : {}),
      ...(disconnect.steam64Id ? { PlayerSteam64ID: disconnect.steam64Id } : {}),
      ...(disconnect.playerControllerId ? { PlayerControllerID: disconnect.playerControllerId } : {}),
    };

    const derived = this.buildDerivedEvent({
      sourceEvent: event,
      eventName: "PLAYER_DISCONNECTED",
      payload,
      paramMap,
    });

    this.emitDerived(derived);
  }

  resolvePlayerName({ serverId, eosId, steam64Id, controllerId }) {
    if (!this.playerIdentityResolver) return "";

    if (steam64Id) {
      const resolved = this.playerIdentityResolver({ serverId, keyType: "steam64ID", keyValue: steam64Id });
      const name = String(resolved?.name ?? "").trim();
      if (name) return name;
    }

    if (eosId) {
      const resolved = this.playerIdentityResolver({ serverId, keyType: "eosID", keyValue: eosId });
      const name = String(resolved?.name ?? "").trim();
      if (name) return name;
    }

    if (controllerId) {
      const resolved = this.playerIdentityResolver({ serverId, keyType: "controllerID", keyValue: controllerId });
      const name = String(resolved?.name ?? "").trim();
      if (name) return name;
    }

    return "";
  }

  buildDerivedEvent({ sourceEvent, eventName, payload, paramMap }) {
    const sourceEventId = String(sourceEvent?.eventId ?? "").trim();
    const derivedSuffix = eventName.toLowerCase();

    return {
      eventId: sourceEventId ? `${sourceEventId}:derived:${derivedSuffix}` : `derived:${derivedSuffix}:${Date.now()}`,
      eventName,
      layer: "core",
      source: "core.rawLogDerivedEvents",

      serverId: String(sourceEvent?.serverId ?? "").trim(),
      sessionId: String(sourceEvent?.sessionId ?? "").trim(),
      seq: String(sourceEvent?.seq ?? "").trim(),

      time: String(sourceEvent?.time ?? new Date().toISOString()),
      logTime: String(sourceEvent?.logTime ?? ""),

      rawEvent: sourceEvent?.rawEvent ?? null,
      rawLog: String(sourceEvent?.rawLog ?? sourceEvent?.rawEvent?.Raw ?? ""),

      payload: payload ?? {},
      paramMap: {
        ...(sourceEvent?.paramMap ?? {}),
        ...(paramMap ?? {}),
      },
      params: Array.isArray(sourceEvent?.params) ? sourceEvent.params : [],

      derivedFrom: {
        eventId: sourceEventId,
        eventName: String(sourceEvent?.eventName ?? ""),
      },
    };
  }

  emitDerived(event) {
    try {
      this.eventBus.emitCoreEvent(event.eventName, event);
    } catch (error) {
      this.logger?.error?.(`[RawLogDerivedEvents] emit failed: ${error.stack ?? error}`);
    }
  }
}

function parseJoinSucceededName(raw) {
  const text = String(raw ?? "");
  const match = text.match(/\bLogNet:\s*Join succeeded:\s*(.+?)\s*(?:\|\s*\[raw_log_line\]\s*)?$/i);
  if (!match) return "";

  const candidate = String(match[1] ?? "").replace(/\s*\|\s*.*$/, "").trim();
  return candidate;
}

function parseNetConnectionClose(raw) {
  const text = String(raw ?? "");
  if (!/\bLogNet:\s*UNetConnection::Close:/i.test(text)) return null;

  const remoteAddr = matchGroup(text, /RemoteAddr:\s*([^,]+),/i);
  const connectionName = matchGroup(text, /Name:\s*([^,]+),/i);
  const driverName = matchGroup(text, /Driver:\s*Name:([^\s,]+)\s*/i);
  const isServerRaw = matchGroup(text, /IsServer:\s*(YES|NO)/i);
  const isServer = isServerRaw ? isServerRaw.toUpperCase() === "YES" : null;
  const playerControllerId = matchGroup(text, /\bPC:\s*([^,]+),/i);
  const owner = matchGroup(text, /\bOwner:\s*([^,]+),/i);
  const uniqueId = matchGroup(text, /\bUniqueId:\s*([^,]+),/i);
  const channelsRaw = matchGroup(text, /\bChannels:\s*(\d+)/i);
  const channels = channelsRaw ? Number.parseInt(channelsRaw, 10) : null;
  const closeTime = matchGroup(text, /\bTime:\s*([^,]+)\s*$/i);

  const parsedUnique = parseUniqueId(uniqueId);

  return {
    remoteAddr,
    connectionName,
    driverName,
    isServer,
    playerControllerId,
    owner,
    uniqueId,
    eosId: parsedUnique.eosId,
    steam64Id: parsedUnique.steam64Id,
    channels,
    closeTime,
  };
}

function matchGroup(text, regex) {
  const match = String(text ?? "").match(regex);
  return match ? String(match[1] ?? "").trim() : "";
}

function parsePostLogin(raw) {
  const text = String(raw ?? "");
  if (!/\bLog(?:Net|Squad):\s*PostLogin:\s*NewPlayer:/i.test(text)) return null;

  const playerControllerId = matchGroup(text, /NewPlayer:\s*([^(\s]+)/i);
  const ip = matchGroup(text, /\(IP:\s*([^|]+)\|/i);
  const uniqueId = matchGroup(text, /Online IDs:\s*([^)]+)/i);

  const parsedUnique = parseUniqueId(uniqueId);

  return {
    playerControllerId,
    ip: cleanIp(ip),
    eosId: parsedUnique.eosId,
    steam64Id: parsedUnique.steam64Id,
  };
}

function cleanIp(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/^\[(.*)\]$/, "$1").split(":")[0];
}

function parseUniqueId(uniqueIdText) {
  const text = String(uniqueIdText ?? "").trim();

  const redpoint = text.match(/RedpointEOS:\s*([0-9a-f]{16,})/i);
  if (redpoint) {
    return { eosId: String(redpoint[1]).toLowerCase(), steam64Id: "" };
  }

  const eos = text.match(/\bEOS:\s*([0-9a-f]{16,})/i);
  const steam = text.match(/\bSteam:\s*([0-9]{16,})/i);

  return {
    eosId: eos ? String(eos[1]).toLowerCase() : "",
    steam64Id: steam ? String(steam[1]) : "",
  };
}
