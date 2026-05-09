// -*- coding: utf-8 -*-

let authMenuOpen = false;

/**
 * 顶部状态栏
 *
 * 这里负责两件事：
 * 1. 展示当前服务端核心状态，例如地图、人数、排队、时间等。
 * 2. 提供右上角用户菜单，其中插件订阅入口只放在这里，不进入左侧主导航。
 */
export function renderTopbar({ root, status, auth, onLogout, onNavigate }) {
  const user = auth?.user ?? null;
  const roleText = user?.isSuperAdmin ? "SuperAdmin | has everything" : (user?.role ?? "Guest");
  const currentMap = formatCurrentMap(status);
  const nextMap = displayText(status.nextLayer, "Unknown");
  const mode = formatMode(status);
  const tps = formatTps(status);
  const tpsTone = formatTpsTone(status);
  const players = formatPlayers(status);
  const queue = String(Number(status.queueCount ?? status.playerQueue ?? 0));
  const playtime = formatPlaytime(status.playtime);
  const canManagePlugins = Boolean(user?.isSuperAdmin);

  root.innerHTML = `
    <div class="brand">${escapeHtml(status.serverName ?? "BZSS Panel")}</div>
    ${chip("Current", currentMap, "")}
    ${chip("Next", nextMap, "")}
    ${chip("Mode", mode, mode !== "Unknown" ? "good" : "muted")}
    ${chip("TPS", tps, tpsTone)}
    ${chip("Players", players, "")}
    ${chip("Queue", queue, Number(queue) > 0 ? "warn" : "")}
    ${chip("Time", playtime, "")}
    <div class="topbar-spacer"></div>
    ${user ? `
      <div class="auth-dropdown ${authMenuOpen ? "is-open" : ""}">
        <button id="topbar-auth-btn" class="auth-badge-btn" type="button">
          <strong>${escapeHtml(user?.username ?? "Guest")}</strong>
          <span>${escapeHtml(roleText)}</span>
        </button>
        <div id="topbar-auth-menu" class="auth-dropdown-menu">
          ${canManagePlugins ? `<button id="topbar-plugin-subscriptions" class="auth-dropdown-item" type="button">🔌 插件订阅</button>` : ""}
          <button id="topbar-logout" class="auth-dropdown-item" type="button">退出登录</button>
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

  // 插件订阅入口在右上角菜单中跳转，避免打断左侧主工作流。
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
}

function chip(label, value, cls) {
  return `<div class="status-chip ${cls}">${escapeHtml(label)}: ${escapeHtml(value)}</div>`;
}

function formatCurrentMap(status) {
  return displayText(status?.layer || status?.currentLayer || status?.map, "Unknown");
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
  if (tokens.length < 2) return "";

  const lastToken = tokens[tokens.length - 1];
  const modeToken = /^(?:v?\d+|pve|pvp|seed)$/i.test(lastToken) ? tokens[tokens.length - 2] : lastToken;
  if (!modeToken) return "";

  const mode = String(modeToken).trim();
  return /^[A-Za-z]+$/.test(mode) ? mode.toUpperCase() : "";
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
