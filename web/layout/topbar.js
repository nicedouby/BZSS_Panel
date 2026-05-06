// -*- coding: utf-8 -*-

/**
 * Topbar
 *
 * 顶部全局状态栏。
 * 所有页面都显示。
 */
export function renderTopbar({ root, status }) {
  root.innerHTML = `
    <div class="brand">${escapeHtml(status.serverName ?? "BZSS Panel")}</div>
    ${chip("JS", status.jsStarted ? "Running" : "Stopped", status.jsStarted ? "good" : "bad")}
    ${chip("Python", status.pythonLogParser ?? "unknown", status.pythonLogParser === "running" ? "good" : "warn")}
    ${chip("UDP", status.udpReceiver ?? "unknown", status.udpReceiver === "listening" ? "good" : "warn")}
    ${chip("RCON", status.rcon ?? "unknown", status.rcon === "connected" ? "good" : "warn")}
    ${chip("Players", String(status.playerCount ?? 0), "")}
    ${chip("Layer", status.currentLayer ?? "Unknown", "")}
    ${chip("Match", status.matchState ?? "Unknown", "")}
    ${chip("Errors", String(status.recentErrors ?? 0), Number(status.recentErrors ?? 0) > 0 ? "bad" : "")}
  `;
}

function chip(label, value, cls) {
  return `<div class="status-chip ${cls}">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]));
}
