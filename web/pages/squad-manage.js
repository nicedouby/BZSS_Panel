// -*- coding: utf-8 -*-

/**
 * 页面：建队管理
 *
 * 类型：可禁用 Web 模块。
 * 数据来源：module.squadState / module.squadManage
 */
export async function renderPage({ root, api, openModal }) {
  const data = await api("/api/squads/list");
  const squads = data.squads ?? [];

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div class="page-title">建队管理</div>
        <button id="refresh">刷新</button>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>ID</th><th>名称</th><th>队长</th><th>阵营</th><th>操作</th></tr></thead>
            <tbody>
              ${squads.map((s, i) => `
                <tr>
                  <td>${esc(s.squadId)}</td>
                  <td>${esc(s.name)}</td>
                  <td>${esc(s.leaderName)}</td>
                  <td>${esc(s.faction)}</td>
                  <td><button data-disband="${i}">解散</button></td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, openModal }));

  root.querySelectorAll("[data-disband]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const squad = squads[Number(btn.dataset.disband)];
      openModal({
        title: "确认解散小队",
        body: `
          <p>当前只是 UI 骨架，尚未接 POST API。</p>
          <pre>${esc(JSON.stringify(squad, null, 2))}</pre>
        `,
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
