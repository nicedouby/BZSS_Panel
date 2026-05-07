// -*- coding: utf-8 -*-

export function renderTopbar({ root, status, auth, onLogout }) {
  const user = auth?.user ?? null;
  const roleText = user?.isSuperAdmin ? "SuperAdmin | has everything" : (user?.role ?? "Guest");
  const tpsChip = buildTpsChip(status);

  root.innerHTML = `
    <div class="brand">${escapeHtml(status.serverName ?? "BZSS Panel")}</div>
    ${chip("JS", status.jsStarted ? "Running" : "Stopped", status.jsStarted ? "good" : "bad")}
    ${chip("Python", status.pythonLogParser ?? "unknown", status.pythonLogParser === "running" ? "good" : "warn")}
    ${chip("UDP", status.udpReceiver ?? "unknown", status.udpReceiver === "listening" ? "good" : "warn")}
    ${chip("RCON", status.rcon ?? "unknown", status.rcon === "connected" ? "good" : "warn")}
    ${tpsChip}
    ${chip("Players", String(status.playerCount ?? 0), "")}
    ${chip("Layer", status.currentLayer ?? "Unknown", "")}
    ${chip("Match", status.matchState ?? "Unknown", "")}
    ${chip("Errors", String(status.recentErrors ?? 0), Number(status.recentErrors ?? 0) > 0 ? "bad" : "")}
    <div class="topbar-spacer"></div>
    <div class="auth-badge">
      <strong>${escapeHtml(user?.username ?? "Guest")}</strong>
      <span>${escapeHtml(roleText)}</span>
    </div>
    ${user ? `<button id="topbar-logout" class="topbar-logout" type="button">Sign out</button>` : ""}
  `;

  const logoutButton = root.querySelector("#topbar-logout");
  if (logoutButton && typeof onLogout === "function") {
    logoutButton.addEventListener("click", () => {
      onLogout().catch(() => {});
    });
  }
}

function chip(label, value, cls) {
  return `<div class="status-chip ${cls}">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function buildTpsChip(status) {
  const tps = Number(status?.tps);
  const text = Number.isFinite(tps) ? tps.toFixed(2) : "--";
  return chip("TPS", text, tpsChipClass(status?.tpsStatus));
}

function tpsChipClass(tpsStatus) {
  if (tpsStatus === "good") return "good";
  if (tpsStatus === "warning") return "warn";
  if (tpsStatus === "critical") return "bad";
  if (tpsStatus === "stale" || tpsStatus === "unknown") return "muted";
  return "";
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
