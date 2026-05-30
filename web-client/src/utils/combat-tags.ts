const TAG_LABELS: Record<string, string> = {
  "combat.damage": "伤害",
  "combat.wound": "击倒",
  "combat.kill": "击杀",
  "combat.team_damage": "友伤",
  "combat.team_wound": "TK击倒",
  "combat.team_kill": "友军击杀",
  "weapon.small_arm": "轻武器",
  "weapon.rifle": "步枪",
  "weapon.carbine": "卡宾枪",
  "weapon.machine_gun": "机枪",
  "weapon.marksman_rifle": "精确射手步枪",
  "weapon.sniper_rifle": "狙击步枪",
  "weapon.pistol": "手枪",
  "weapon.shotgun": "霰弹枪",
  "weapon.explosive": "爆炸物",
  "weapon.vehicle": "载具",
  "weapon.emplacement": "固定武器",
  "weapon.melee": "近战",
  "damage.direct": "直伤",
  "damage.splash": "溅射",
  "damage.bleed": "流血",
  "damage.fall": "坠落",
  "damage.burn": "燃烧",
  "damage.vehicle_crash": "碰撞",
  "relation.enemy": "敌对",
  "relation.friendly": "友伤",
  "relation.self": "自伤",
  "event:give_up": "放弃",
  "event:friendly_fire": "友伤",
  "event:self_damage": "自伤",
  "tk_down": "TK击倒",
  "friendly_fire": "友伤",
  "self_damage": "自伤",
  "killed_by_bot": "被 Bot 击杀",
};

const HIDDEN_TAGS = new Set([
  "weapon.unknown",
  "damage.unknown_source",
  "attacker.valid",
  "attacker.null",
  "attacker.world",
  "victim.valid",
  "victim.null",
  "relation.unknown",
  "confidence.high",
  "confidence.medium",
  "confidence.low",
]);

export function labelForCombatTag(tag: unknown): string {
  const text = normalizeText(tag);
  if (!text) return "";
  return TAG_LABELS[text] || prettifyTag(text);
}

export function toneForCombatTag(tag: unknown): "neutral" | "ok" | "warn" | "danger" {
  const text = normalizeText(tag);
  if (!text) return "neutral";
  if (text.includes("kill")) return "danger";
  if (text.includes("wound") || text.includes("team_damage") || text.includes("friendly_fire") || text.includes("self_damage")) return "warn";
  if (text.includes("damage")) return "ok";
  if (text.includes("explosive") || text.includes("vehicle")) return "warn";
  return "neutral";
}

export function shouldDisplayCombatTag(tag: unknown): boolean {
  const text = normalizeText(tag);
  if (!text) return false;
  return !HIDDEN_TAGS.has(text);
}

export function formatCombatTags(event: any): Array<{
  key: string;
  label: string;
  tone: "neutral" | "ok" | "warn" | "danger";
}> {
  const items: Array<{ key: string; label: string; tone: "neutral" | "ok" | "warn" | "danger" }> = [];
  const seen = new Set<string>();

  const push = (key: string, label: string, tone: "neutral" | "ok" | "warn" | "danger") => {
    const normalizedKey = normalizeText(key);
    const normalizedLabel = normalizeText(label);
    if (!normalizedKey && !normalizedLabel) return;
    const fingerprint = `${normalizedKey}::${normalizedLabel}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    items.push({
      key: normalizedKey || normalizedLabel,
      label: label || labelForCombatTag(normalizedKey || normalizedLabel),
      tone,
    });
  };

  for (const flag of Array.isArray(event?.eventFlags) ? event.eventFlags : []) {
    const key = normalizeText(flag?.key);
    const label = normalizeText(flag?.label);
    if (!key && !label) continue;
    if (!shouldDisplayCombatTag(key) && !shouldDisplayCombatTag(label)) continue;
    push(`flag:${key || label}`, label || labelForCombatTag(key), toneForCombatTag(key || label));
  }

  for (const label of Array.isArray(event?.eventFlagLabels) ? event.eventFlagLabels : []) {
    const text = normalizeText(label);
    if (!text || !shouldDisplayCombatTag(text)) continue;
    push(`flag-label:${text}`, labelForCombatTag(text), toneForCombatTag(text));
  }

  for (const tag of Array.isArray(event?.tags) ? event.tags : []) {
    const text = normalizeText(tag);
    if (!text || !shouldDisplayCombatTag(text)) continue;
    push(`tag:${text}`, labelForCombatTag(text), toneForCombatTag(text));
  }

  return items;
}

function normalizeText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function prettifyTag(text: string): string {
  return text
    .split(/[:._-]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
