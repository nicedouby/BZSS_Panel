// -*- coding: utf-8 -*-

import { renderTopbar } from "./layout/topbar.js";
import { renderSidebar } from "./layout/sidebar.js";
import { openDrawer } from "./layout/drawer.js";
import { openModal } from "./layout/modal.js";

const state = {
  pages: [],
  currentPage: null,
  status: null,
  currentPageCleanup: null,
  auth: {
    authenticated: false,
    user: null,
  },
};

const pageScroll = document.querySelector("#page-scroll");
let topbarTimer = null;

async function apiFetch(path, options = {}, { handleAuth = true } = {}) {
  const res = await fetch(path, {
    cache: "no-store",
    ...options,
  });

  if (handleAuth && res.status === 401) {
    handleUnauthorized();
    const error = new Error("Unauthorized");
    error.code = "Unauthorized";
    throw error;
  }

  return res;
}

async function api(path) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
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
  if (!state.auth.authenticated) return;

  const routeInfo = parseRouteTarget(route);
  const page = state.pages.find((p) => p.route === routeInfo.path) ?? state.pages[0];
  if (!page) return;

  if (typeof state.currentPageCleanup === "function") {
    try {
      state.currentPageCleanup();
    } catch {}
    state.currentPageCleanup = null;
  }

  state.currentPage = page;
  history.replaceState(null, "", `#${routeInfo.full}`);

  renderSidebar({
    pages: state.pages,
    activeRoute: page.route,
    onNavigate: navigateTo,
  });

  pageScroll.innerHTML = `<div class="card">Loading ${escapeHtml(page.title)}...</div>`;

  const mod = await import(page.pageModule);
  const cleanup = await mod.renderPage({
    root: pageScroll,
    api,
    apiFetch,
    openDrawer,
    openModal,
    onNavigate: navigateTo,
    page,
    routeInfo,
  });

  if (typeof cleanup === "function") {
    state.currentPageCleanup = cleanup;
  } else if (typeof pageScroll.__pageCleanup === "function") {
    state.currentPageCleanup = pageScroll.__pageCleanup;
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

function ensureTopbarTimer() {
  if (topbarTimer) return;
  topbarTimer = window.setInterval(() => {
    refreshTopbar().catch(() => {});
  }, 1000);
}

function renderFrame() {
  renderTopbar({
    root: document.querySelector("#topbar"),
    status: state.status ?? {},
    auth: state.auth,
    onLogout: logout,
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
        <p class="login-copy">Only a user marked as SuperAdmin can enter the control panel.</p>
        <form id="login-form" class="login-form">
          <label>
            <span>Username</span>
            <input id="login-username" name="username" autocomplete="username" value="DoubyBear" required>
          </label>
          <label>
            <span>Password</span>
            <input id="login-password" name="password" type="password" autocomplete="current-password" value="DoubyBear" required>
          </label>
          <button id="login-submit" type="submit">Login as SuperAdmin</button>
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
      ensureTopbarTimer();

      const route = location.hash.replace(/^#/, "") || "/match-status";
      await navigateTo(route);
    } catch (error) {
      messageEl.textContent = `Login failed: ${error.message}`;
      submitButton.disabled = false;
    }
  });
}

function handleUnauthorized() {
  if (topbarTimer) {
    window.clearInterval(topbarTimer);
    topbarTimer = null;
  }

  if (typeof state.currentPageCleanup === "function") {
    try {
      state.currentPageCleanup();
    } catch {}
    state.currentPageCleanup = null;
  }

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
  ensureTopbarTimer();

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
