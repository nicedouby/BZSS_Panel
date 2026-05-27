// -*- coding: utf-8 -*-

let authMenuOpen = false;

/**
 * Top status bar.
 *
 * Shows the current server state and provides the right-side user menu.
 */
export function renderTopbar({ root, status, auth, onLogout, onNavigate, onEditLogClock }) {
  const user = auth?.user ?? null;
  const roleText = user?.isSuperAdmin ? "SuperAdmin | has everything" : (user?.role ?? "Guest");
  const currentLayer = formatCurrentLayer(status);
  const nextLayer = displayText(status?.nextLayer ?? status?.webStatus?.nextLayer, "Unknown");
  const mode = formatMode(status);
  const tps = formatTps(status);
  const tpsTone = formatTpsTone(status);
  const players = formatPlayers(status);
  const queue = formatQueue(status);
  const playtime = formatPlaytime(status.playtime);
  const logClockSeconds = Number(status?.logClockSeconds ?? 0);
  const logClock = formatPlaytime(logClockSeconds);
  const logClockTone = status?.logClockHasAnchor ? "good" : "warn";
  const canManagePlugins = Boolean(user?.isSuperAdmin);

  root.innerHTML = `
    <div class="brand">${escapeHtml(status.serverName ?? "BZSS Panel")}</div>
    ${chip("Current Layer", currentLayer, "")}
    ${chip("Next Layer", nextLayer, "")}
    ${chip("Mode", mode, mode !== "Unknown" ? "good" : "muted")}
    ${chip("TPS", tps, tpsTone)}
    ${chip("Players", players, "")}
    ${chip("Queue", queue, Number(queue) > 0 ? "warn" : "")}
    ${chip("Time", playtime, "")}
    ${chipButton("topbar-log-clock", "Log Clock", logClock, logClockTone)}
    <div class="topbar-spacer"></div>
    ${user ? `
      <div class="auth-dropdown ${authMenuOpen ? "is-open" : ""}">
        <button id="topbar-auth-btn" class="auth-badge-btn" type="button">
          <strong>${escapeHtml(user?.username ?? "Guest")}</strong>
          <span>${escapeHtml(roleText)}</span>
        </button>
        <div id="topbar-auth-menu" class="auth-dropdown-menu">
          <button id="topbar-runtime-status" class="auth-dropdown-item" type="button">运行状态</button>
          ${canManagePlugins ? `<button id="topbar-plugin-subscriptions" class="auth-dropdown-item" type="button">Plugin Subscriptions</button>` : ""}
          <button id="topbar-logout" class="auth-dropdown-item" type="button">Logout</button>
        </div>
      </div>
    ` : ""}
  `;

  if (!user) {
    authMenuOpen = false;
    return;
  }

  const authBtn = root.querySelector("#topbar-auth-btn");
  const authMenu = root.querySelector("#topbar-auth-menu");
  const logoutBtn = root.querySelector("#topbar-logout");
  const runtimeStatusBtn = root.querySelector("#topbar-runtime-status");
  const pluginSubscriptionsBtn = root.querySelector("#topbar-plugin-subscriptions");
  const authDropdown = root.querySelector(".auth-dropdown");

  if (authBtn && authMenu && authDropdown) {
    const closeMenu = () => {
      authMenuOpen = false;
      authDropdown.classList.remove("is-open");
      document.removeEventListener("click", closeMenuOnClickOutside);
    };

    const openMenu = () => {
      authMenuOpen = true;
      authDropdown.classList.add("is-open");
      document.addEventListener("click", closeMenuOnClickOutside);
    };

    const closeMenuOnClickOutside = (e) => {
      if (!authBtn.contains(e.target) && !authMenu.contains(e.target)) {
        closeMenu();
      }
    };

    authBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (authMenuOpen) {
        closeMenu();
        return;
      }
      openMenu();
    });

    authMenu.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    if (authMenuOpen) {
      document.addEventListener("click", closeMenuOnClickOutside);
    }
  }

  if (runtimeStatusBtn && typeof onNavigate === "function") {
    runtimeStatusBtn.addEventListener("click", () => {
      authMenuOpen = false;
      onNavigate("/system/status").catch(() => {});
    });
  }

  // Keep plugin navigation in the top-right menu so it does not interrupt the main flow.
  if (pluginSubscriptionsBtn && typeof onNavigate === "function") {
    pluginSubscriptionsBtn.addEventListener("click", () => {
      authMenuOpen = false;
      onNavigate("/plugin-subscriptions").catch(() => {});
    });
  }

  if (logoutBtn && typeof onLogout === "function") {
    logoutBtn.addEventListener("click", () => {
      authMenuOpen = false;
      onLogout().catch(() => {});
    });
  }

  const logClockBtn = root.querySelector("#topbar-log-clock");
  if (logClockBtn && typeof onEditLogClock === "function") {
    const trigger = () => {
      try {
        const result = onEditLogClock({ seconds: logClockSeconds });
        result?.catch?.(() => {});
      } catch {}
    };

    logClockBtn.addEventListener("click", trigger);
    logClockBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        trigger();
      }
    });
  }
}

function chip(label, value, cls) {
  return `<div class="status-chip ${cls}">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function chipButton(id, label, value, cls) {
  return `<div id="${escapeAttr(id)}" class="status-chip status-chip-btn ${escapeAttr(cls)}" role="button" tabindex="0" title="Click to edit">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function formatCurrentLayer(status) {
  return displayText(
    status?.layer
      || status?.currentLayer
      || status?.map
      || status?.webStatus?.layer
      || status?.webStatus?.currentLayer
      || status?.webStatus?.map,
    "Unknown",
  );
}

function formatMode(status) {
  return displayText(status?.mode || deriveModeFromLayer(status?.layer || status?.currentLayer || status?.map), "Unknown");
}

function formatTps(status) {
  const value = Number(status?.tps);
  return Number.isFinite(value) ? value.toFixed(1) : "--";
}

function formatTpsTone(status) {
  switch (String(status?.tpsStatus ?? "unknown")) {
    case "good":
      return "good";
    case "warning":
      return "warn";
    case "critical":
      return "bad";
    case "stale":
      return "muted";
    default:
      return "muted";
  }
}

function formatPlayers(status) {
  const current = Number(status?.playerCount ?? 0);
  const max = Number(status?.maxPlayers);
  const currentText = Number.isFinite(current) ? String(current) : "0";
  return Number.isFinite(max) && max > 0 ? `${currentText}/${max}` : currentText;
}

function formatQueue(status) {
  const value = Number(status?.queueCount ?? status?.playerQueue ?? status?.webStatus?.queueCount ?? 0);
  return Number.isFinite(value) ? String(value) : "0";
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

function deriveModeFromLayer(layer) {
  const text = String(layer ?? "").trim();
  if (!text) return "";

  const tokens = text.split(/[_\s-]+/).filter(Boolean);
  if (!tokens.length) return "";

  const lastToken = tokens[tokens.length - 1];
  if (/^seed$/i.test(lastToken)) return "seed";

  if (/^(?:v?\d+|pve|pvp)$/i.test(lastToken) && tokens.length > 1) {
    const previous = String(tokens[tokens.length - 2] ?? "").trim();
    if (!previous) return "";
    if (/^seed$/i.test(previous)) return "seed";
    if (/^(?:pve|pvp)$/i.test(previous)) return previous;
    return /^[a-z]+$/i.test(previous) ? previous : "";
  }

  const mode = String(lastToken).trim();
  if (/^seed$/i.test(mode)) return "seed";
  if (/^(?:pve|pvp)$/i.test(mode)) return mode;
  return /^[a-z]+$/i.test(mode) ? mode : "";
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

function escapeAttr(value) {
  return String(value ?? "").replace(/["']/g, "");
}
