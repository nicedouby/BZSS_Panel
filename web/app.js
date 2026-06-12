// -*- coding: utf-8 -*-

import { renderTopbar } from "./layout/topbar.js";
import { renderSidebar } from "./layout/sidebar.js";
import { openDrawer } from "./layout/drawer.js";
import { openModal } from "./layout/modal.js";
import { getRuntimeTaskManager } from "./runtime-task-manager.js";

const state = {
  pages: [],
  currentPage: null,
  status: null,
  currentPageCleanup: null,
  currentPageAbortController: null,
  auth: {
    authenticated: false,
    user: null,
  },
};

const pageScroll = document.querySelector("#page-scroll");
const taskManager = getRuntimeTaskManager();
const apiInFlight = new Map();
let navigationSeq = 0;

const MERGED_API_KEYS = [
  ["/api/web/status", "api:web-status"],
  ["/api/snapshot/all", "api:snapshot-all"],
];

async function apiFetch(path, options = {}, { handleAuth = true } = {}) {
  const controller = new AbortController();
  const externalSignal = options.signal;

  const abortFromExternal = () => controller.abort("abort");
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort("abort");
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  try {
    const res = await fetch(path, {
      cache: "no-store",
      ...options,
      signal: controller.signal,
    });

    if (handleAuth && res.status === 401) {
      handleUnauthorized();
      const error = new Error("Unauthorized");
      error.code = "Unauthorized";
      throw error;
    }

    return res;
  } finally {
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

async function api(path, fetchOptions = {}, requestOptions = {}) {
  const dedupeKey = requestOptions?.dedupeKey ?? resolveApiDedupeKey(path);

  const run = async () => {
    const res = await apiFetch(path, fetchOptions, requestOptions);
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  };

  if (!dedupeKey) {
    return await run();
  }

  if (apiInFlight.has(dedupeKey)) {
    return await apiInFlight.get(dedupeKey);
  }

  const pending = run().finally(() => {
    if (apiInFlight.get(dedupeKey) === pending) {
      apiInFlight.delete(dedupeKey);
    }
  });

  apiInFlight.set(dedupeKey, pending);
  return await pending;
}

async function apiPost(path, body = {}, options = {}) {
  return await apiFetch(path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, options);
}

async function loadBootData() {
  const [pagesData, status] = await Promise.all([
    api("/api/web/pages"),
    api("/api/web/status"),
  ]);

  state.pages = pagesData.pages;
  state.status = status;
}

async function navigateTo(route) {
  const seq = ++navigationSeq;
  if (!state.auth.authenticated) return;

  const routeInfo = parseRouteTarget(route);
  const page = state.pages.find((p) => p.route === routeInfo.path) ?? state.pages[0];
  if (!page) return;

  cleanupCurrentPage({ abort: true });

  const pageAbortController = new AbortController();
  state.currentPageAbortController = pageAbortController;

  const pageApiFetch = (path, options = {}, requestOptions = {}) => apiFetch(
    path,
    {
      ...options,
      signal: options.signal ?? pageAbortController.signal,
    },
    requestOptions,
  );

  const pageApi = (path, options = {}, requestOptions = {}) => api(
    path,
    {
      ...options,
      signal: options.signal ?? pageAbortController.signal,
    },
    requestOptions,
  );

  state.currentPage = page;
  history.replaceState(null, "", `#${routeInfo.full}`);

  renderSidebar({
    pages: state.pages,
    activeRoute: page.route,
    onNavigate: navigateTo,
  });

  pageScroll.innerHTML = `<div class="card">Loading ${escapeHtml(page.title)}...</div>`;

  try {
    const mod = await import(page.pageModule);
    if (seq !== navigationSeq) return;

    const cleanup = await mod.renderPage({
      root: pageScroll,
      api: pageApi,
      apiFetch: pageApiFetch,
      globalApi: api,
      globalApiFetch: apiFetch,
      taskManager,
      openDrawer,
      openModal,
      onNavigate: navigateTo,
      page,
      routeInfo,
    });

    if (seq !== navigationSeq) {
      if (typeof cleanup === "function") {
        try {
          cleanup();
        } catch {}
      }
      return;
    }

    if (typeof cleanup === "function") {
      state.currentPageCleanup = cleanup;
    } else if (typeof pageScroll.__pageCleanup === "function") {
      state.currentPageCleanup = pageScroll.__pageCleanup;
    }
  } catch (error) {
    if (seq !== navigationSeq) return;
    console.error(`Failed to render page ${page.route}`, error);
    pageScroll.innerHTML = `
      <section class="page">
        <div class="card">
          <div class="page-title">页面加载失败</div>
          <div class="page-subtitle">${escapeHtml(page.title)} 无法完成渲染。</div>
          <p style="margin-top:12px; color: var(--muted);">${escapeHtml(error?.message || "Unknown error")}</p>
          <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">
            <button id="page-retry" type="button">重试</button>
            <button id="page-go-console" type="button">打开控制台</button>
          </div>
        </div>
      </section>
    `;

    pageScroll.querySelector("#page-retry")?.addEventListener("click", () => {
      navigateTo(routeInfo.full).catch(() => {});
    });
    pageScroll.querySelector("#page-go-console")?.addEventListener("click", () => {
      navigateTo("/console").catch(() => {});
    });
  }
}

function parseRouteTarget(route) {
  const raw = String(route || "").trim() || "/match-status";
  const cleaned = raw.replace(/^#/, "");
  const [pathPart, queryPart = ""] = cleaned.split("?");
  const path = pathPart || "/match-status";
  return {
    full: queryPart ? `${path}?${queryPart}` : path,
    path,
    params: new URLSearchParams(queryPart),
  };
}

async function refreshTopbar() {
  if (!state.auth.authenticated) return;
  state.status = await api("/api/web/status");
  renderFrame();
}

function ensureTopbarTask() {
  taskManager.registerTask({
    id: "topbar-status",
    intervalMs: 1000,
    backgroundIntervalMs: 5000,
    visibleOnly: false,
    dedupeKey: "api:web-status",
    scope: "global",
    run: async ({ signal }) => {
      if (!state.auth.authenticated) return;
      state.status = await api("/api/web/status", { signal }, { dedupeKey: "api:web-status" });
      renderFrame();
    },
  });
}

function renderFrame() {
  renderTopbar({
    root: document.querySelector("#topbar"),
    status: state.status ?? {},
    auth: state.auth,
    onLogout: logout,
    onNavigate: navigateTo,
    onEditLogClock: openLogClockEditor,
  });

  renderSidebar({
    pages: state.auth.authenticated ? state.pages : [],
    activeRoute: state.currentPage?.route ?? "",
    onNavigate: navigateTo,
  });
}

function renderShellVisibility() {
  const app = document.querySelector("#app");
  app.classList.toggle("is-authenticated", Boolean(state.auth.authenticated));
}

async function openLogClockEditor({ seconds } = {}) {
  if (!state.auth.authenticated) return;

  const initialSeconds = Number.isFinite(Number(seconds))
    ? Number(seconds)
    : Number(state.status?.logClockSeconds ?? 0);
  const initialValue = formatDurationInput(initialSeconds);

  openModal({
    title: "修改日志时间",
    body: `
      <form id="log-clock-form" class="rcon-form" style="grid-template-columns: 1fr auto; gap: 10px;">
        <input id="log-clock-input" placeholder="例如 10 或 12:34 或 1:02:03" value="${escapeHtml(initialValue)}" />
        <button type="submit">保存</button>
      </form>
      <div style="display:flex; gap:10px; margin-top:10px; align-items:center; flex-wrap: wrap;">
        <button id="log-clock-reset" type="button">重置为 0</button>
        <small style="color: var(--muted);">纯数字按「分钟」解析；包含冒号按 mm:ss / hh:mm:ss 解析。</small>
      </div>
    `,
  });

  const modalRoot = document.querySelector("#modal-root");
  const form = modalRoot.querySelector("#log-clock-form");
  const input = modalRoot.querySelector("#log-clock-input");
  const resetBtn = modalRoot.querySelector("#log-clock-reset");

  const close = () => {
    modalRoot.innerHTML = "";
  };

  const submitSeconds = async (nextSeconds) => {
    await apiPost("/api/log-clock/set", { seconds: nextSeconds });
    close();
    await refreshTopbar();
  };

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    const parsed = parseDurationSeconds(input?.value ?? "");
    if (parsed == null) return;
    submitSeconds(parsed).catch(() => {});
  });

  resetBtn?.addEventListener("click", () => {
    apiPost("/api/log-clock/reset", {})
      .then(async () => {
        close();
        await refreshTopbar();
      })
      .catch(() => {});
  });
}

function parseDurationSeconds(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  if (/^\\d+(?:\\.\\d+)?$/.test(text)) {
    const minutes = Number.parseFloat(text);
    if (!Number.isFinite(minutes) || minutes < 0) return null;
    return Math.floor(minutes * 60);
  }

  const parts = text.split(":").map((p) => p.trim());
  if (parts.length === 2 || parts.length === 3) {
    const nums = parts.map((p) => Number.parseInt(p, 10));
    if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

    if (parts.length === 2) {
      const [mm, ss] = nums;
      return mm * 60 + ss;
    }

    const [hh, mm, ss] = nums;
    return hh * 3600 + mm * 60 + ss;
  }

  return null;
}

function formatDurationInput(totalSeconds) {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const s = seconds % 60;
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function restoreSession() {
  const res = await fetch("/api/auth/session", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const data = await res.json();
  state.auth = {
    authenticated: Boolean(data.authenticated),
    user: data.user ?? null,
  };
}

function renderLoginScreen(message = "") {
  pageScroll.innerHTML = `
    <section class="login-shell">
      <div class="login-card">
        <div class="login-eyebrow">Secure Access</div>
        <h1>BZSS Panel Login</h1>
        <p class="login-copy">Enter the panel using your operator credentials.</p>
        <form id="login-form" class="login-form">
          <label>
            <span>Username</span>
            <input id="login-username" name="username" autocomplete="username" value="" required>
          </label>
          <label>
            <span>Password</span>
            <input id="login-password" name="password" type="password" autocomplete="current-password" value="" required>
          </label>
          <button id="login-submit" type="submit">Login</button>
          <div id="login-message" class="login-message">${escapeHtml(message)}</div>
        </form>
      </div>
    </section>
  `;

  const form = pageScroll.querySelector("#login-form");
  const messageEl = pageScroll.querySelector("#login-message");
  const submitButton = pageScroll.querySelector("#login-submit");

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    submitButton.disabled = true;
    messageEl.textContent = "Verifying credentials...";

    const username = pageScroll.querySelector("#login-username")?.value ?? "";
    const password = pageScroll.querySelector("#login-password")?.value ?? "";

    try {
      const res = await apiPost("/api/auth/login", { username, password }, { handleAuth: false });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        messageEl.textContent = data.message ?? "Login failed.";
        submitButton.disabled = false;
        return;
      }

      state.auth = {
        authenticated: true,
        user: data.user ?? null,
      };
      renderShellVisibility();
      await loadBootData();
      renderFrame();
      ensureTopbarTask();

      const route = location.hash.replace(/^#/, "") || "/match-status";
      await navigateTo(route);
    } catch (error) {
      messageEl.textContent = `Login failed: ${error.message}`;
      submitButton.disabled = false;
    }
  });
}

function handleUnauthorized() {
  taskManager.removeTask("topbar-status", { abort: true });
  cleanupCurrentPage({ abort: true });

  state.auth = {
    authenticated: false,
    user: null,
  };
  state.pages = [];
  state.currentPage = null;
  state.status = null;

  renderShellVisibility();
  renderFrame();
  renderLoginScreen("Session expired. Please log in again.");
}

async function logout() {
  await apiPost("/api/auth/logout", {});
  handleUnauthorized();
  renderLoginScreen("Signed out.");
}

async function main() {
  await restoreSession();
  renderShellVisibility();

  if (!state.auth.authenticated) {
    renderFrame();
    renderLoginScreen();
    return;
  }

  await loadBootData();
  renderFrame();
  ensureTopbarTask();

  const route = location.hash.replace(/^#/, "") || "/match-status";
  await navigateTo(route);
}

main().catch((error) => {
  pageScroll.innerHTML = `<div class="card">Web startup failed: ${escapeHtml(error.message)}</div>`;
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]));
}

function cleanupCurrentPage({ abort = true } = {}) {
  if (abort && state.currentPageAbortController) {
    state.currentPageAbortController.abort();
  }
  state.currentPageAbortController = null;

  if (typeof state.currentPageCleanup === "function") {
    try {
      state.currentPageCleanup();
    } catch {}
  }
  state.currentPageCleanup = null;
}

function resolveApiDedupeKey(path) {
  const normalized = String(path || "").split("?")[0];
  for (const [prefix, key] of MERGED_API_KEYS) {
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return key;
    }
  }
  return null;
}
