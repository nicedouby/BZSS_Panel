// -*- coding: utf-8 -*-

/** A small, plugin-agnostic, serial interaction session registry. */
export function createChatInteractionService({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  function get(playerKey = "") { return sessions.get(String(playerKey || "")) ?? null; }
  function has(playerKey = "") { return sessions.has(String(playerKey || "")); }

  function create(input = {}) {
    const playerKey = String(input.playerKey || "").trim();
    if (!playerKey || has(playerKey)) return null;
    const startedAt = now();
    const timeoutMs = Math.max(1_000, Number(input.timeoutMs) || 30_000);
    const session = {
      sessionId: input.sessionId ?? `${input.workflowId || "workflow"}:${startedAt}:${Math.random().toString(36).slice(2)}`,
      serverId: String(input.serverId || ""), playerKey, workflowId: String(input.workflowId || ""),
      stageId: String(input.stageId || ""), context: { ...(input.context ?? {}) },
      startedAt, expiresAt: startedAt + timeoutMs, nextReminderAt: startedAt + Math.max(1_000, Number(input.reminderMs) || 10_000),
      reminderMs: Math.max(1_000, Number(input.reminderMs) || 10_000), maxReminders: Math.max(0, Number(input.maxReminders) || 0),
      reminderCount: 0, invalidInputCount: 0, lastMessageAt: startedAt,
    };
    sessions.set(playerKey, session);
    return clone(session);
  }

  function advance(playerKey, patch = {}) {
    const session = get(playerKey); if (!session) return null;
    const timestamp = now();
    const timeoutMs = Math.max(1_000, Number(patch.timeoutMs) || Math.max(1_000, session.expiresAt - timestamp));
    Object.assign(session, patch, { context: { ...session.context, ...(patch.context ?? {}) }, expiresAt: timestamp + timeoutMs,
      nextReminderAt: timestamp + Math.max(1_000, Number(patch.reminderMs) || session.reminderMs), reminderCount: 0, invalidInputCount: 0, lastMessageAt: timestamp });
    delete session.timeoutMs;
    return clone(session);
  }

  function invalid(playerKey) { const s = get(playerKey); if (!s) return null; s.invalidInputCount += 1; s.lastMessageAt = now(); return clone(s); }
  function cancel(playerKey) { const s = get(playerKey); if (!s) return null; sessions.delete(String(playerKey)); return clone(s); }
  function clear({ workflowId = "", serverId = "" } = {}) { const removed=[]; for (const s of [...sessions.values()]) if ((!workflowId || s.workflowId===workflowId)&&(!serverId||s.serverId===serverId)) removed.push(cancel(s.playerKey)); return removed; }
  function sweep() { const timestamp=now(); const expired=[]; const reminders=[]; for (const s of [...sessions.values()]) { if (timestamp>=s.expiresAt) { expired.push(cancel(s.playerKey)); continue; } if (timestamp>=s.nextReminderAt && s.reminderCount<s.maxReminders) { s.reminderCount+=1; s.nextReminderAt=timestamp+s.reminderMs; reminders.push(clone(s)); } } return { expired, reminders }; }
  function snapshot() { return [...sessions.values()].map(clone); }
  return { get, has, create, advance, invalid, cancel, clear, sweep, snapshot };
}

function clone(value) { return { ...value, context: { ...(value?.context ?? {}) } }; }
