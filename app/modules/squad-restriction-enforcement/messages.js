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
    vehicleSoloLockForbidden: "战斗载具队禁止单人锁队或单载，请立即整改。",
    vehiclePlayerLimitExceeded: "当前小队已经超员，请控制小队规模或打开队锁。",
    logisticsPlayerLimitExceeded: "当前后勤小队已经超员，请控制小队规模或打开队锁。",
    mortarPlayerLimitExceeded: "当前迫击炮小队已经超员，请控制小队规模或打开队锁。",
    genericPlayerLimitExceeded: "当前小队已经超员，请控制小队规模或打开队锁。",
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
} = {}) {
  const prefix = Number(stage) === 1
    ? SQUAD_RESTRICTION_MESSAGE_COPY.warningPrefix.first
    : SQUAD_RESTRICTION_MESSAGE_COPY.warningPrefix.final;
  return `${prefix}${buildViolationMessage({
    violationCodes,
    squadTypeId,
    squadTypeLabel,
    restrictionReasons,
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
    if (typeId === "logistics") {
      return SQUAD_RESTRICTION_MESSAGE_COPY.violation.logisticsPlayerLimitExceeded;
    }
    if (typeId === "mortar") {
      return SQUAD_RESTRICTION_MESSAGE_COPY.violation.mortarPlayerLimitExceeded;
    }
    if (VEHICLE_TYPE_IDS.has(typeId)) {
      return SQUAD_RESTRICTION_MESSAGE_COPY.violation.vehiclePlayerLimitExceeded;
    }
    return SQUAD_RESTRICTION_MESSAGE_COPY.violation.genericPlayerLimitExceeded;
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
