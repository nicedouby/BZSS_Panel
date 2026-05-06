// -*- coding: utf-8 -*-

/**
 * Drawer
 *
 * 右侧抽屉：用于查看详情。
 */
export function openDrawer({ title, body }) {
  const root = document.querySelector("#drawer-root");
  root.innerHTML = `
    <div class="drawer-backdrop"></div>
    <div class="drawer">
      <div class="drawer-header">${escapeHtml(title)}</div>
      <div class="drawer-body">${body}</div>
    </div>
  `;

  root.querySelector(".drawer-backdrop").addEventListener("click", () => {
    root.innerHTML = "";
  });
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
