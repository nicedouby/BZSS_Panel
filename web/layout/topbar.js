// -*- coding: utf-8 -*-

export function renderTopbar({ root, status, auth, onLogout }) {
  const user = auth?.user ?? null;
  const roleText = user?.isSuperAdmin ? "SuperAdmin | has everything" : (user?.role ?? "Guest");
  const currentMap = formatCurrentMap(status);
  const nextMap = displayText(status.nextLayer, "Unknown");
  const players = formatPlayers(status);
  const queue = String(Number(status.queueCount ?? status.playerQueue ?? 0));
  const playtime = formatPlaytime(status.playtime);

  root.innerHTML = `
    <div class="brand">${escapeHtml(status.serverName ?? "BZSS Panel")}</div>
    ${chip("Current", currentMap, "")}
    ${chip("Next", nextMap, "")}
    ${chip("Players", players, "")}
    ${chip("Queue", queue, Number(queue) > 0 ? "warn" : "")}
    ${chip("Time", playtime, "")}
    <div class="topbar-spacer"></div>
    ${user ? `
      <div class="auth-dropdown">
        <button id="topbar-auth-btn" class="auth-badge-btn" type="button">
          <strong>${escapeHtml(user?.username ?? "Guest")}</strong>
          <span>${escapeHtml(roleText)}</span>
        </button>
        <div id="topbar-auth-menu" class="auth-dropdown-menu" hidden>
          <button id="topbar-logout" class="auth-dropdown-item" type="button">Sign out</button>
        </div>
      </div>
    ` : ""}
  `;

  if (user && typeof onLogout === "function") {
    const authBtn = root.querySelector("#topbar-auth-btn");
    const authMenu = root.querySelector("#topbar-auth-menu");
    const logoutBtn = root.querySelector("#topbar-logout");

    if (authBtn && authMenu) {
      authBtn.addEventListener("click", () => {
        const isHidden = authMenu.hasAttribute("hidden");
        if (isHidden) {
          authMenu.removeAttribute("hidden");
          document.addEventListener("click", closeMenuOnClickOutside);
        } else {
          authMenu.setAttribute("hidden", "");
          document.removeEventListener("click", closeMenuOnClickOutside);
        }
      });

      const closeMenuOnClickOutside = (e) => {
        if (!authBtn.contains(e.target) && !authMenu.contains(e.target)) {
          authMenu.setAttribute("hidden", "");
          document.removeEventListener("click", closeMenuOnClickOutside);
        }
      };
    }

    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => {
        onLogout().catch(() => {});
      });
    }
  }
}

function chip(label, value, cls) {
  return `<div class="status-chip ${cls}">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function formatCurrentMap(status) {
  return displayText(status?.layer || status?.currentLayer || status?.map, "Unknown");
}

function formatPlayers(status) {
  const current = Number(status?.playerCount ?? 0);
  const max = Number(status?.maxPlayers);
  const currentText = Number.isFinite(current) ? String(current) : "0";
  return Number.isFinite(max) && max > 0 ? `${currentText}/${max}` : currentText;
}

function formatPlaytime(value) {
  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "--";

  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}:${pad2(minutes)}:${pad2(seconds)}`;
  }
  return `${minutes}:${pad2(seconds)}`;
}

function displayText(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function pad2(value) {
  return String(value).padStart(2, "0");
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
