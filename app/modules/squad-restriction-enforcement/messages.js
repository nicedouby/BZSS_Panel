// -*- coding: utf-8 -*-

const VEHICLE_TYPE_IDS = new Set([
  "matv",
  "ifv",
  "apc",
  "tank",
  "atgm_matv",
  "artillery_vehicle",
  "helicopter",
  "attack_helicopter",
]);

export const SQUAD_RESTRICTION_MESSAGE_COPY = Object.freeze({
  warningPrefix: Object.freeze({
    first: "[小队规则警告] 你的小队已经违规，",
    final: "[小队规则最后警告] 你的小队仍然违规，",
  }),
  violation: Object.freeze({
    infantryLockForbidden: "小队性质为战斗步兵，禁止锁队，请立即整改。",
    vehicleSoloLockForbidden: "战斗载具队禁止单人锁队或单载，请打开队锁，或将小队人数增加至至少 2 人。",
    playerLimitExceeded: "当前{label}已经超员，请将小队人数控制在最多 {limit} 人，或打开队锁。",
    genericViolation: "当前小队违反锁队规则，请立即整改。",
  }),
  disbandReasonPrefix: "小队规则自动处罚：两次警告后仍未整改。违规原因：",
});

export function buildSquadRestrictionWarning({
  stage = 1,
  violationCodes = [],
  squadTypeId = "",
  squadTypeLabel = "",
  restrictionReasons = [],
  ruleSnapshot = null,
} = {}) {
  const prefix = Number(stage) === 1
    ? SQUAD_RESTRICTION_MESSAGE_COPY.warningPrefix.first
    : SQUAD_RESTRICTION_MESSAGE_COPY.warningPrefix.final;
  return `${prefix}${buildViolationMessage({
    violationCodes,
    squadTypeId,
    squadTypeLabel,
    restrictionReasons,
    ruleSnapshot,
  })}`;
}

export function buildSquadRestrictionDisbandReason({ restrictionReasons = [], fallbackReason = "" } = {}) {
  const reason = firstText(restrictionReasons) || cleanSentence(fallbackReason) || "持续违反锁队规则";
  return `${SQUAD_RESTRICTION_MESSAGE_COPY.disbandReasonPrefix}${reason}`;
}

export function buildViolationMessage({
  violationCodes = [],
  squadTypeId = "",
  squadTypeLabel = "",
  restrictionReasons = [],
  ruleSnapshot = null,
} = {}) {
  const codes = new Set((Array.isArray(violationCodes) ? violationCodes : [])
    .map((value) => String(value ?? "").trim())
    .filter(Boolean));
  const typeId = String(squadTypeId ?? "").trim();
  const typeLabel = String(squadTypeLabel ?? "").trim();

  if (codes.has("lock_forbidden")) {
    if (typeId === "infantry") {
      return SQUAD_RESTRICTION_MESSAGE_COPY.violation.infantryLockForbidden;
    }
    const label = typeLabel || "该类型小队";
    return `当前小队为${label}，${label}禁止锁队，请立即整改。`;
  }

  if (codes.has("solo_lock_forbidden")) {
    return SQUAD_RESTRICTION_MESSAGE_COPY.violation.vehicleSoloLockForbidden;
  }

  if (codes.has("locked_player_limit_exceeded")) {
    const limit = positiveInteger(ruleSnapshot?.maxPlayersWhenLocked);
    const label = squadLimitLabel(typeId, typeLabel);
    if (limit) {
      return SQUAD_RESTRICTION_MESSAGE_COPY.violation.playerLimitExceeded
        .replace("{label}", label)
        .replace("{limit}", String(limit));
    }
    return `当前${label}已经超员，请控制小队规模或打开队锁。`;
  }

  const fallback = firstText(restrictionReasons);
  if (fallback) return `${cleanSentence(fallback)}，请立即整改。`;
  return SQUAD_RESTRICTION_MESSAGE_COPY.violation.genericViolation;
}

function firstText(values) {
  if (!Array.isArray(values)) return "";
  return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
}

function cleanSentence(value) {
  return String(value ?? "").trim().replace(/[。！？!?；;，,：:]+$/u, "");
}

function squadLimitLabel(typeId, typeLabel) {
  if (typeId === "logistics") return "后勤小队";
  if (typeId === "mortar") return "迫击炮小队";
  if (VEHICLE_TYPE_IDS.has(typeId)) return "载具小队";
  return typeLabel || "小队";
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}
