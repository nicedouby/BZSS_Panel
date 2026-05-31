// -*- coding: utf-8 -*-

/**
 * Sidebar
 *
 * The page list comes from WebRegistry. Pages can opt out of the main
 * navigation with hiddenFromSidebar while remaining routable.
 */
export function renderSidebar({ pages, activeRoute, onNavigate }) {
  const root = document.querySelector("#sidebar");
  const visiblePages = dedupePagesByRoute(pages.filter((page) => !page.hiddenFromSidebar));
  const groups = groupBy(visiblePages, (p) => p.group ?? "其他");
  const normalizedActiveRoute = normalizeRoute(activeRoute);

  root.innerHTML = "";

  for (const [groupName, groupPages] of groups) {
    const group = document.createElement("div");
    group.className = "sidebar-group";
    group.innerHTML = `<div class="sidebar-group-title">${escapeHtml(groupName)}</div>`;

    for (const page of groupPages) {
      const item = document.createElement("div");
      item.className = "sidebar-item" + (normalizeRoute(page.route) === normalizedActiveRoute ? " active" : "");
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

function normalizeRoute(route) {
  const raw = String(route ?? "").trim().replace(/^#+/, "");
  if (!raw) return "/";

  let pathname = raw;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(raw)) {
    try {
      pathname = new URL(raw).pathname || "/";
    } catch {
      pathname = raw;
    }
  }

  const noQueryOrHash = pathname.split(/[?#]/, 1)[0];
  const withLeadingSlash = noQueryOrHash.startsWith("/") ? noQueryOrHash : `/${noQueryOrHash}`;
  const compacted = withLeadingSlash.replace(/\/{2,}/g, "/");
  if (compacted.length > 1 && compacted.endsWith("/")) return compacted.slice(0, -1);
  return compacted;
}

function dedupePagesByRoute(pages) {
  const seen = new Set();
  const unique = [];
  for (const page of pages) {
    const route = normalizeRoute(page?.route);
    if (seen.has(route)) continue;
    seen.add(route);
    unique.push({ ...page, route });
  }
  return unique;
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
