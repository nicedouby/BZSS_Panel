// -*- coding: utf-8 -*-

/**
 * 页面：控制台
 *
 * 类型：不可禁用基础 Web 模块。
 * 数据来源：module.console
 */
export async function renderPage({ root, api }) {
  const data = await api("/api/console/lines");
  const lines = data.lines ?? [];

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div class="page-title">控制台</div>
        <button id="refresh">刷新</button>
      </div>

      <div class="card">
        <div class="log-list">
          ${lines.map((line) => `
            <div class="log-line">
              <span>${esc(line.time)}</span>
              <span>[${esc(line.type)}]</span>
              <span>${esc(line.message)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api }));
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]));
}
