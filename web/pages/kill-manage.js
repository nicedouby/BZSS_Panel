// -*- coding: utf-8 -*-

/**
 * 页面：击杀管理
 *
 * 类型：可禁用 Web 模块。
 * 数据来源：module.killManage
 */
export async function renderPage({ root, api, openDrawer }) {
  const data = await api("/api/kills/recent");
  const records = data.records ?? [];

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div class="page-title">击杀管理</div>
        <button id="refresh">刷新</button>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>类型</th><th>受害者</th><th>攻击者</th><th>伤害</th><th>武器</th><th>可信度</th></tr></thead>
            <tbody>
              ${records.map((r, i) => `
                <tr data-record="${i}">
                  <td>${esc(r.type)}</td>
                  <td>${esc(r.victimName)}</td>
                  <td>${esc(r.attackerName)}</td>
                  <td>${esc(r.damage)}</td>
                  <td>${esc(r.weapon)}</td>
                  <td>${esc(r.confidence)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, openDrawer }));

  root.querySelectorAll("[data-record]").forEach((el) => {
    el.addEventListener("click", () => {
      const record = records[Number(el.dataset.record)];
      openDrawer({
        title: "击杀记录详情",
        body: `<pre>${esc(JSON.stringify(record, null, 2))}</pre>`,
      });
    });
  });
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
