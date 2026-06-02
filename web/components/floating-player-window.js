// -*- coding: utf-8 -*-

const ROOT_ID = "floating-player-window-root";
let activeWindowState = null;
let windowKeydownHandler = null;
let windowResizeHandler = null;

export function getActivePlayerWindow() {
  return activeWindowState;
}

export function setActivePlayerWindow(nextState = {}) {
  activeWindowState = {
    ...activeWindowState,
    ...nextState,
  };

  const root = ensureRoot();
  renderWindow(root, activeWindowState);
  installWindowListeners();
  positionWindow(root);
  window.requestAnimationFrame?.(() => {
    const currentRoot = document.querySelector(`#${ROOT_ID}`);
    if (currentRoot) positionWindow(currentRoot);
  });
  return root;
}

export function closeActivePlayerWindow() {
  activeWindowState = null;
  uninstallWindowListeners();
  const root = document.querySelector(`#${ROOT_ID}`);
  if (root) root.remove();
}

function ensureRoot() {
  let root = document.querySelector(`#${ROOT_ID}`);
  if (!root) {
    root = document.createElement("div");
    root.id = ROOT_ID;
    document.body.appendChild(root);
  }
  return root;
}

function renderWindow(root, state) {
  if (!state) {
    root.innerHTML = "";
    return;
  }

  root.innerHTML = `
    <div class="floating-window-layer">
      <button class="floating-window-layer__backdrop" type="button" aria-label="关闭玩家详情"></button>
      <section class="floating-player-window" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.playerName || "玩家详情")}">
        <header class="floating-player-window__header">
          <div class="floating-player-window__header-copy">
            <div class="floating-player-window__eyebrow">Player detail</div>
            <div class="floating-player-window__header-title">${escapeHtml(state.playerName || "未知玩家")}</div>
            <div class="floating-player-window__header-subtitle">${escapeHtml(state.playerSubtitle || "对局状态浮窗")}</div>
          </div>
          <button class="floating-player-window__close" type="button" data-floating-close="1" aria-label="关闭">×</button>
        </header>
        <div class="floating-player-window__body" data-floating-body="1">
          ${state.contentHtml || ""}
        </div>
      </section>
    </div>
  `;

  root.querySelector(".floating-window-layer__backdrop")?.addEventListener("click", closeActivePlayerWindow);
  root.querySelectorAll("[data-floating-close]").forEach((el) => {
    el.addEventListener("click", closeActivePlayerWindow);
  });
  root.querySelector(".floating-player-window")?.addEventListener("click", (event) => event.stopPropagation());
  root.querySelector(".floating-player-window__body")?.addEventListener("click", (event) => event.stopPropagation());

  state.onRendered?.(root, state);
}

function installWindowListeners() {
  if (!windowKeydownHandler) {
    windowKeydownHandler = (event) => {
      if (event.key === "Escape") closeActivePlayerWindow();
    };
    window.addEventListener("keydown", windowKeydownHandler);
  }

  if (!windowResizeHandler) {
    windowResizeHandler = () => {
      const root = document.querySelector(`#${ROOT_ID}`);
      if (root) positionWindow(root);
    };
    window.addEventListener("resize", windowResizeHandler);
  }
}

function uninstallWindowListeners() {
  if (windowKeydownHandler) {
    window.removeEventListener("keydown", windowKeydownHandler);
    windowKeydownHandler = null;
  }
  if (windowResizeHandler) {
    window.removeEventListener("resize", windowResizeHandler);
    windowResizeHandler = null;
  }
}

function positionWindow(root) {
  const state = activeWindowState;
  const windowEl = root.querySelector(".floating-player-window");
  if (!state || !windowEl) return;

  const isSmallScreen = window.innerWidth < 768 || window.innerHeight < 760;
  const margin = 12;

  if (isSmallScreen) {
    windowEl.style.left = "12px";
    windowEl.style.top = "12px";
    windowEl.style.transform = "none";
    windowEl.style.right = "auto";
    windowEl.style.bottom = "auto";
    windowEl.style.width = "calc(100vw - 24px)";
    windowEl.style.maxHeight = "calc(100vh - 24px)";
    return;
  }

  const rect = windowEl.getBoundingClientRect();
  const width = rect.width || 460;
  const height = rect.height || 640;
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = Number(state.anchorX ?? viewportWidth / 2) + 16;
  let top = Number(state.anchorY ?? viewportHeight / 2) + 16;

  if (left + width > viewportWidth - margin) {
    left = Math.max(margin, viewportWidth - width - margin);
  }
  if (top + height > viewportHeight - margin) {
    top = Math.max(margin, viewportHeight - height - margin);
  }

  left = Math.max(margin, left);
  top = Math.max(margin, top);

  windowEl.style.left = `${left}px`;
  windowEl.style.top = `${top}px`;
  windowEl.style.transform = "none";
  windowEl.style.right = "auto";
  windowEl.style.bottom = "auto";
  windowEl.style.width = `${Math.min(width, Math.max(380, viewportWidth - 24))}px`;
  windowEl.style.maxHeight = `${Math.max(320, viewportHeight - 48)}px`;
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
