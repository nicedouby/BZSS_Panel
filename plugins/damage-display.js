// -*- coding: utf-8 -*-

const DEFAULT_CONFIG = {
  enabled: true,
  victimDisplayEnabled: true,
  attackerDisplayEnabled: true,
  attackerPolicy: {
    requireTags: ["weapon.small_arm"],
    denyTags: ["relation.self"],
    allowEventTypes: ["damage", "wound", "kill"],
    allowFriendlyFire: true,
    allowSelfDamage: false,
    minDamage: 1,
  },
  victimPolicy: {
    allowEventTypes: ["damage", "wound", "kill"],
    showUnknownAttacker: true,
    showWorldDamage: true,
  },
  templates: {
    attackerDamage: "命中 {victimName}，造成 {damage} 点伤害",
    attackerWound: "击倒 {victimName}",
    attackerKill: "击杀 {victimName}",
    victimDamage: "你受到 {attackerName} 的 {damage} 点伤害",
    victimWound: "你被 {attackerName} 击倒",
    victimKill: "你被 {attackerName} 击杀",
  },
  roundDamage: true,
};

export function createPlugin({ core, modules }) {
  const unsubscribers = [];
  const config = mergeConfig(DEFAULT_CONFIG, core.config?.get?.("plugins.damageDisplay", {}) ?? {});

  function isSubscribed() {
    return modules?.pluginSubscriptions?.isSubscribed?.("plugin.damageDisplay") !== false
      && core.pluginSubscriptions?.isSubscribed?.("plugin.damageDisplay") !== false;
  }

  function isDisplayableCombatRecord(record) {
    return record?.type === "damage" || record?.type === "wound" || record?.type === "kill";
  }

  function hasTag(record, tag) {
    return Array.isArray(record?.tags) && record.tags.includes(tag);
  }

  function resolveDamage(record) {
    const damage = Number(record?.damage ?? 0);
    if (!Number.isFinite(damage)) return undefined;
    return config.roundDamage ? Math.round(damage) : Number(damage.toFixed(2));
  }

  function resolveAttackerDisplayName(record) {
    if (record?.attackerName) return record.attackerName;
    if (hasTag(record, "attacker.world")) {
      if (hasTag(record, "damage.fall")) return "摔落";
      if (hasTag(record, "damage.bleed")) return "流血";
      return "环境";
    }
    if (hasTag(record, "damage.bleed")) return "流血";
    if (hasTag(record, "damage.fall")) return "摔落";
    return "未知来源";
  }

  function renderTemplate(template, values) {
    return String(template ?? "").replace(/\{(\w+)\}/g, (_, key) => String(values?.[key] ?? ""));
  }

  function renderVictimMessage(record, attackerName, damage) {
    switch (record?.type) {
      case "damage":
        return renderTemplate(config.templates.victimDamage, {
          attackerName,
          victimName: record?.victimName || "你",
          damage: damage ?? 0,
          weapon: record?.weaponName || "未知武器",
        });
      case "wound":
        return renderTemplate(config.templates.victimWound, {
          attackerName,
          victimName: record?.victimName || "你",
          weapon: record?.weaponName || "未知武器",
        });
      case "kill":
        return renderTemplate(config.templates.victimKill, {
          attackerName,
          victimName: record?.victimName || "你",
          weapon: record?.weaponName || "未知武器",
        });
      default:
        return "";
    }
  }

  function renderAttackerMessage(record, damage) {
    switch (record?.type) {
      case "damage":
        return renderTemplate(config.templates.attackerDamage, {
          attackerName: record?.attackerName || "你",
          victimName: record?.victimName || "未知目标",
          damage: damage ?? 0,
          weapon: record?.weaponName || "未知武器",
        });
      case "wound":
        return renderTemplate(config.templates.attackerWound, {
          attackerName: record?.attackerName || "你",
          victimName: record?.victimName || "未知目标",
          weapon: record?.weaponName || "未知武器",
        });
      case "kill":
        return renderTemplate(config.templates.attackerKill, {
          attackerName: record?.attackerName || "你",
          victimName: record?.victimName || "未知目标",
          weapon: record?.weaponName || "未知武器",
        });
      default:
        return "";
    }
  }

  function shouldDisplayToAttacker(record) {
    if (!record?.attackerName) return false;
    if (!record?.victimName) return false;
    if (!config.attackerPolicy.allowEventTypes.includes(record.type)) return false;
    if (!config.attackerPolicy.allowFriendlyFire && hasTag(record, "relation.friendly")) return false;
    if (!config.attackerPolicy.allowSelfDamage && hasTag(record, "relation.self")) return false;

    for (const tag of config.attackerPolicy.requireTags) {
      if (!hasTag(record, tag)) return false;
    }
    for (const tag of config.attackerPolicy.denyTags) {
      if (hasTag(record, tag)) return false;
    }

    if (record.type === "damage") {
      const damage = Number(record.damage ?? 0);
      if (!Number.isFinite(damage) || damage < Number(config.attackerPolicy.minDamage ?? 0)) {
        return false;
      }
    }
    return true;
  }

  async function writeBack(recordId, side, patch) {
    modules.combatClean?.updateWarningState?.(recordId, {
      [side]: {
        ...patch,
        updatedAt: Date.now(),
      },
    });
  }

  async function displayToVictim(record) {
    if (!record?.victimName) return;
    if (!config.victimPolicy.allowEventTypes.includes(record.type)) {
      await writeBack(record.id, "victim", {
        warned: false,
        skipped: true,
        success: false,
        reason: "event_type_denied",
        message: "",
      });
      return;
    }

    const attackerName = resolveAttackerDisplayName(record);
    if (!config.victimPolicy.showUnknownAttacker && attackerName === "未知来源") {
      await writeBack(record.id, "victim", {
        warned: false,
        skipped: true,
        success: false,
        reason: "unknown_attacker_hidden",
        message: "",
      });
      return;
    }
    if (!config.victimPolicy.showWorldDamage && hasTag(record, "attacker.world")) {
      await writeBack(record.id, "victim", {
        warned: false,
        skipped: true,
        success: false,
        reason: "world_damage_hidden",
        message: "",
      });
      return;
    }

    const damage = resolveDamage(record);
    const message = renderVictimMessage(record, attackerName, damage);
    const result = await modules.adminWarn.warnPlayer({
      targetName: record.victimName,
      targetEosId: record.victimEosId,
      targetSteamId: record.victimSteamId,
      message,
      sourceModule: "damage_display",
      reason: `victim_${record.type}`,
      relatedEventId: record.id,
      rawPayload: record,
    });

    await writeBack(record.id, "victim", {
      warned: !result.skipped,
      skipped: Boolean(result.skipped),
      success: Boolean(result.success),
      reason: result.skipReason || `victim_${record.type}`,
      message,
    });
  }

  async function displayToAttacker(record) {
    if (!record?.attackerName) return;
    const damage = resolveDamage(record);
    const message = renderAttackerMessage(record, damage);
    const result = await modules.adminWarn.warnPlayer({
      targetName: record.attackerName,
      targetEosId: record.attackerEosId,
      targetSteamId: record.attackerSteamId,
      message,
      sourceModule: "damage_display",
      reason: `attacker_${record.type}`,
      relatedEventId: record.id,
      rawPayload: record,
    });

    await writeBack(record.id, "attacker", {
      warned: !result.skipped,
      skipped: Boolean(result.skipped),
      success: Boolean(result.success),
      reason: result.skipReason || `attacker_${record.type}`,
      message,
    });
  }

  async function onCombatRecord(event) {
    if (!config.enabled || !isSubscribed()) return;
    const record = event?.record ?? event;
    if (!isDisplayableCombatRecord(record)) return;

    if (config.victimDisplayEnabled) {
      await displayToVictim(record);
    }

    if (!config.attackerDisplayEnabled) {
      await writeBack(record.id, "attacker", {
        warned: false,
        skipped: true,
        success: false,
        reason: "attacker_display_disabled",
        message: "",
      });
      return;
    }

    if (!shouldDisplayToAttacker(record)) {
      await writeBack(record.id, "attacker", {
        warned: false,
        skipped: true,
        success: false,
        reason: "policy_denied",
        message: "",
      });
      return;
    }

    await displayToAttacker(record);
  }

  return {
    manifest: {
      id: "plugin.damageDisplay",
      name: "Damage Display Plugin",
      kind: "plugin",
      version: "0.1.0",
      description: "Subscribes to all processed combat records, decides display policy from tags, and sends victim or attacker hints through module.adminWarn.",
    },

    async start() {
      unsubscribers.push(
        core.eventBus.onModuleEvent("module.combatClean", "combat.record.processed", onCombatRecord),
      );
      core.logger?.info?.("[DamageDisplay] listening to module.combatClean:combat.record.processed");
    },

    async stop() {
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      core.logger?.info?.("[DamageDisplay] stopped");
    },
  };
}

function mergeConfig(base, override) {
  return {
    ...base,
    ...(override ?? {}),
    attackerPolicy: {
      ...base.attackerPolicy,
      ...(override?.attackerPolicy ?? {}),
      requireTags: Array.isArray(override?.attackerPolicy?.requireTags) ? override.attackerPolicy.requireTags.slice() : base.attackerPolicy.requireTags.slice(),
      denyTags: Array.isArray(override?.attackerPolicy?.denyTags) ? override.attackerPolicy.denyTags.slice() : base.attackerPolicy.denyTags.slice(),
      allowEventTypes: Array.isArray(override?.attackerPolicy?.allowEventTypes) ? override.attackerPolicy.allowEventTypes.slice() : base.attackerPolicy.allowEventTypes.slice(),
    },
    victimPolicy: {
      ...base.victimPolicy,
      ...(override?.victimPolicy ?? {}),
      allowEventTypes: Array.isArray(override?.victimPolicy?.allowEventTypes) ? override.victimPolicy.allowEventTypes.slice() : base.victimPolicy.allowEventTypes.slice(),
    },
    templates: {
      ...base.templates,
      ...(override?.templates ?? {}),
    },
  };
}
