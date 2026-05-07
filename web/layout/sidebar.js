// -*- coding: utf-8 -*-

/**
 * Sidebar
 *
 * 左侧 Web 模块栏。
 * 页面来自后端 WebRegistry，而不是前端写死。
 */
export function renderSidebar({ pages, activeRoute, onNavigate }) {
  const root = document.querySelector("#sidebar");
  const groups = groupBy(pages, (p) => p.group ?? "其他");

  root.innerHTML = "";

  for (const [groupName, groupPages] of groups) {
    const group = document.createElement("div");
    group.className = "sidebar-group";
    group.innerHTML = `<div class="sidebar-group-title">${escapeHtml(groupName)}</div>`;

    for (const page of groupPages) {
      const item = document.createElement("div");
      item.className = "sidebar-item" + (page.route === activeRoute ? " active" : "");
      item.innerHTML = `
        <span>${escapeHtml(page.icon ?? "•")}</span>
        <span>${escapeHtml(page.title)}</span>
        ${page.required ? `<span class="sidebar-item-required" aria-label="固定" title="固定"></span>` : ""}
      `;

      item.addEventListener("click", () => onNavigate(page.route));
      group.appendChild(item);
    }

    root.appendChild(group);
  }
}

function groupBy(items, getKey) {
  const map = new Map();

  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }

  return map;
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
