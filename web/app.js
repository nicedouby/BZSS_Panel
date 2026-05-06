// -*- coding: utf-8 -*-

/**
 * Web App Shell
 *
 * Web 端分层：
 * - app.js：加载 Shell
 * - layout/：顶栏、侧栏、弹窗、抽屉
 * - pages/：每个页面独立
 */

import { renderTopbar } from "./layout/topbar.js";
import { renderSidebar } from "./layout/sidebar.js";
import { openDrawer } from "./layout/drawer.js";
import { openModal } from "./layout/modal.js";

const state = {
  pages: [],
  currentPage: null,
  status: null,
  currentPageCleanup: null,
};

const pageScroll = document.querySelector("#page-scroll");

async function api(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
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
  const page = state.pages.find((p) => p.route === route) ?? state.pages[0];
  if (!page) return;

  if (typeof state.currentPageCleanup === "function") {
    try {
      state.currentPageCleanup();
    } catch {}
    state.currentPageCleanup = null;
  }

  state.currentPage = page;
  history.replaceState(null, "", `#${page.route}`);

  renderSidebar({
    pages: state.pages,
    activeRoute: page.route,
    onNavigate: navigateTo,
  });

  pageScroll.innerHTML = `<div class="card">加载 ${page.title}...</div>`;

  const mod = await import(page.pageModule);
  const cleanup = await mod.renderPage({
    root: pageScroll,
    api,
    openDrawer,
    openModal,
    page,
  });
  if (typeof cleanup === "function") {
    state.currentPageCleanup = cleanup;
  } else if (typeof pageScroll.__pageCleanup === "function") {
    state.currentPageCleanup = pageScroll.__pageCleanup;
  }
}

async function refreshTopbar() {
  state.status = await api("/api/web/status");
  renderTopbar({
    root: document.querySelector("#topbar"),
    status: state.status,
  });
}

async function main() {
  await loadBootData();

  renderTopbar({
    root: document.querySelector("#topbar"),
    status: state.status,
  });

  renderSidebar({
    pages: state.pages,
    activeRoute: "",
    onNavigate: navigateTo,
  });

  const route = location.hash.replace(/^#/, "") || "/match-status";
  await navigateTo(route);

  setInterval(refreshTopbar, 2000);
}

main().catch((error) => {
  pageScroll.innerHTML = `<div class="card">Web 启动失败：${escapeHtml(error.message)}</div>`;
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
