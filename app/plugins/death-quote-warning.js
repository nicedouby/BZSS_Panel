// -*- coding: utf-8 -*-

const PLUGIN_ID = "plugin.death-quote-warning";
const COMBAT_MODULE_ID = "module.combatState";
const COMBAT_EVENT_NAME = "combatEvent";
const CONFIG_KEY = "plugins.death-quote-warning";
const MAX_HISTORY = 200;
const HANDLED_TTL_MS = 60_000;

const DEFAULT_CONFIG = {
  enabled: false,
  quotes: [],
};

export function createPlugin({ core = {}, modules = {}, config = null, logger = console } = {}) {
  let runtimeConfig = readConfig(config);
  const handledEvents = new Map();
  const unsubscribers = [];
  const state = {
    killEvents: 0,
    triggered: 0,
    skipped: 0,
    failed: 0,
    lastSentAt: "",
    lastError: "",
    history: [],
  };

  function text(value) { return String(value ?? "").normalize("NFKC").trim(); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function isSubscribed() {
    return core?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false
      && modules?.pluginSubscriptions?.isSubscribed?.(PLUGIN_ID) !== false;
  }
  function readConfig(store) {
    const raw = store?.get?.(CONFIG_KEY, {});
    const source = raw && typeof raw === "object" ? raw : {};
    const quotes = Array.isArray(source.quotes)
      ? source.quotes.map((quote, index) => ({
        id: text(quote?.id) || `quote-${index + 1}`,
        text: text(quote?.text).slice(0, 180),
        enabled: quote?.enabled !== false,
        weight: clamp(Number(quote?.weight ?? quote?.probability ?? 1) || 0, 0, 100000),
      })).filter((quote) => quote.text)
      : [];
    return {
      enabled: source.enabled === true,
      quotes,
    };
  }
  function pushHistory(item) {
    state.history.unshift({ id: `death-quote-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, at: new Date().toISOString(), ...item });
    if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
  }
  function eventId(event, record) {
    return text(record?.id ?? record?.sourceEventId ?? event?.eventId) || [
      text(record?.serverId ?? event?.serverId), text(record?.time ?? event?.time),
      text(record?.type), text(record?.victimSteam64ID), text(record?.victimEOSID), text(record?.victimName),
    ].join("|");
  }
  function claim(id) {
    const now = Date.now();
    for (const [key, at] of handledEvents) if (now - at > HANDLED_TTL_MS) handledEvents.delete(key);
    if (!id || handledEvents.has(id)) return false;
    handledEvents.set(id, now);
    return true;
  }
  function resolveVictim(serverId, record) {
    const players = modules?.playerState;
    return players?.getPlayerBySteamID?.(serverId, record?.victimSteam64ID)
      ?? players?.getPlayerByEOSID?.(serverId, record?.victimEOSID)
      ?? players?.getPlayerByControllerID?.(serverId, record?.victimControllerID)
      ?? players?.getPlayerByName?.(serverId, record?.victimName)
      ?? null;
  }
  async function handleCombatEvent(event = {}) {
    runtimeConfig = readConfig(config);
    const record = event?.record ?? event?.payload?.record ?? event?.payload ?? event ?? {};
    const type = text(record?.type).toLowerCase();
    // 只处理 Kill / death；Wound、Damage 和回放事件绝不发送。
    if (type !== "death" && type !== "kill") return { success: false, skipped: true, reason: "not_kill" };
    state.killEvents += 1;
    if (!runtimeConfig.enabled || !isSubscribed()) return skip("disabled", record);
    if (event?.isReplay || record?.isReplay || event?.canTriggerActions === false || record?.canTriggerActions === false) return skip("replay", record);
    const id = eventId(event, record);
    if (!claim(id)) return skip("duplicate", record);
    const candidates = runtimeConfig.quotes.filter((quote) => quote.enabled && quote.text && quote.weight > 0);
    if (!candidates.length) return skip("no_selectable_quote", record);
    const victim = resolveVictim(text(record?.serverId ?? event?.serverId ?? core?.webStatus?.serverId), record);
    if (!victim) return skip("victim_missing", record);
    const quote = selectWeightedQuote(candidates);
    const playerId = text(victim.playerID ?? victim.playerId);
    try {
      const result = await modules?.adminWarn?.sendAdminWarn?.({
        targetName: text(victim.name ?? record?.victimName),
        targetPlayerId: playerId || undefined,
        targetSteamId: text(victim.steamID ?? victim.steamId ?? record?.victimSteam64ID) || undefined,
        targetEosId: text(victim.eosID ?? victim.eosId ?? record?.victimEOSID) || undefined,
        requireTargetPlayerId: false,
        message: quote.text,
        sourceModule: PLUGIN_ID,
        reason: "death_quote_kill",
        relatedEventId: id,
        system: true,
      });
      if (!result?.success) throw new Error(text(result?.errorMessage ?? result?.error ?? "AdminWarn failed"));
      state.triggered += 1; state.lastSentAt = new Date().toISOString(); state.lastError = "";
      pushHistory({ success: true, victim: text(victim.name ?? record?.victimName), quote: quote.text, eventType: type });
      return result;
    } catch (error) {
      state.failed += 1; state.lastError = error instanceof Error ? error.message : String(error);
      pushHistory({ success: false, victim: text(victim?.name ?? record?.victimName), quote: quote.text, eventType: type, error: state.lastError });
      logger?.warn?.(`[DeathQuoteWarning] send failed: ${state.lastError}`);
      return { success: false, error: state.lastError };
    }
  }
  function selectWeightedQuote(candidates) {
    const totalWeight = candidates.reduce((sum, quote) => sum + quote.weight, 0);
    let cursor = Math.random() * totalWeight;
    for (const quote of candidates) {
      cursor -= quote.weight;
      if (cursor < 0) return quote;
    }
    return candidates[candidates.length - 1];
  }
  function skip(reason, record) {
    state.skipped += 1;
    pushHistory({ success: false, skipped: true, reason, victim: text(record?.victimName), eventType: text(record?.type) });
    return { success: false, skipped: true, reason };
  }
  const api = {
    getState() { return { ...state, config: { ...runtimeConfig, quotes: [...runtimeConfig.quotes] }, subscribed: isSubscribed(), history: [...state.history] }; },
    async updateConfig(next = {}) {
      const previous = config?.get?.(CONFIG_KEY, {});
      const normalized = readConfig({ get: () => next });
      config?.set?.(CONFIG_KEY, normalized);
      try { await config?.save?.(); runtimeConfig = normalized; return api.getState(); }
      catch (error) { config?.set?.(CONFIG_KEY, previous); throw error; }
    },
    clearHistory() { state.history = []; state.lastError = ""; return api.getState(); },
  };
  return {
    manifest: { id: PLUGIN_ID, name: "死亡名言警告", kind: "plugin", version: "1.1.0", description: "仅在 Kill/death 时按每条名言权重随机向死亡玩家发送名言。" },
    apiName: "deathQuoteWarning",
    api,
    async start() {
      runtimeConfig = readConfig(config);
      unsubscribers.push(core?.eventBus?.onModuleEvent?.(COMBAT_MODULE_ID, COMBAT_EVENT_NAME, (event) => { void handleCombatEvent(event); }));
      logger?.info?.("[DeathQuoteWarning] started");
    },
    async stop() { for (const unsubscribe of unsubscribers.splice(0)) unsubscribe?.(); handledEvents.clear(); },
  };
}
