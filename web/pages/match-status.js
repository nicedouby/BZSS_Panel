// -*- coding: utf-8 -*-

/**
 * 页面：对局状态
 *
 * 类型：不可禁用基础 Web 模块。
 * 数据来源：module.matchState / playerState / squadState
 */
export async function renderPage({ root, api, openDrawer }) {
  const data = await api("/api/match/overview");
  const status = data.status ?? {};
  const players = data.players ?? [];
  const squads = data.squads ?? [];

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div class="page-title">对局状态</div>
        <button id="refresh">刷新</button>
      </div>

      <div class="grid cols-3">
        <div class="card">服务器：${esc(status.serverName)}</div>
        <div class="card">玩家：${players.length}</div>
        <div class="card">小队：${squads.length}</div>
      </div>

      <div class="grid cols-2">
        <div class="card">
          <h3>小队列表</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>ID</th><th>名称</th><th>队长</th><th>阵营</th></tr></thead>
              <tbody>
                ${squads.map((s, i) => `
                  <tr data-squad="${i}">
                    <td>${esc(s.squadId)}</td>
                    <td>${esc(s.name)}</td>
                    <td>${esc(s.leaderName)}</td>
                    <td>${esc(s.faction)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>

        <div class="card">
          <h3>玩家列表</h3>
          <div class="table-wrap">
            <table>
              <thead><tr><th>名称</th><th>状态</th><th>兵种</th><th>最后出现</th></tr></thead>
              <tbody>
                ${players.map((p) => `
                  <tr>
                    <td>${esc(p.name)}</td>
                    <td>${esc(p.state)}</td>
                    <td>${esc(p.role)}</td>
                    <td>${esc(p.lastSeenTime)}</td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, openDrawer }));

  root.querySelectorAll("[data-squad]").forEach((el) => {
    el.addEventListener("click", () => {
      const squad = squads[Number(el.dataset.squad)];
      openDrawer({
        title: "小队详情",
        body: `<pre>${esc(JSON.stringify(squad, null, 2))}</pre>`,
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
