import type { InfantryCombatWarningDecision } from "../types/infantry-combat-enhancer";

export const SKIP_REASON_LABELS: Record<string, string> = {
  non_light_weapon_hidden: "非轻武器，按设置隐藏",
  kill_display_disabled: "击杀提示已关闭",
  attacker_missing_target: "缺少攻击者目标",
  victim_missing_target: "缺少受害者目标",
  same_player: "同一玩家，已抑制",
  admin_warn_unavailable: "警告模块不可用",
  below_min_attacker_damage: "低于攻击者伤害阈值",
  attacker_damage_disabled: "攻击者伤害提示已关闭",
};

export function warningDecisionText(decision: InfantryCombatWarningDecision | null | undefined): string {
  if (!decision) return "-";
  if (decision.success) return "已发送";
  if (decision.skipped) {
    const reason = String(decision.skipReason || "unknown");
    return `跳过：${SKIP_REASON_LABELS[reason] ?? reason}`;
  }
  return `失败：${decision.errorMessage || "未知错误"}`;
}

export function warningDecisionTone(decision: InfantryCombatWarningDecision | null | undefined): "empty" | "ok" | "muted" | "danger" {
  if (!decision) return "empty";
  if (decision.success) return "ok";
  if (decision.skipped) return "muted";
  return "danger";
}

export function warningDecisionStatus(decision: InfantryCombatWarningDecision | null | undefined): "sent" | "skipped" | "failed" | "empty" {
  if (!decision) return "empty";
  if (decision.success) return "sent";
  if (decision.skipped) return "skipped";
  return "failed";
}
