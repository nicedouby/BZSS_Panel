// -*- coding: utf-8 -*-

/**
 * 页面：玩家数据库
 *
 * 类型：不可禁用基础 Web 模块。
 * 数据来源：module.playerDatabase
 */
export async function renderPage({ root, api, openDrawer }) {
  const data = await api("/api/player-database/list");
  const players = data.players ?? [];

  root.innerHTML = `
    <section class="page">
      <div class="page-title-row">
        <div class="page-title">玩家数据库</div>
        <button id="refresh">刷新</button>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th>名称</th><th>Steam64</th><th>EOS</th><th>状态</th><th>最后出现</th></tr></thead>
            <tbody>
              ${players.map((p, i) => `
                <tr data-player="${i}">
                  <td>${esc(p.name)}</td>
                  <td>${esc(p.steam64)}</td>
                  <td>${esc(p.eos)}</td>
                  <td>${esc(p.state)}</td>
                  <td>${esc(p.lastSeenTime)}</td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  `;

  root.querySelector("#refresh").addEventListener("click", () => renderPage({ root, api, openDrawer }));

  root.querySelectorAll("[data-player]").forEach((el) => {
    el.addEventListener("click", () => {
      const player = players[Number(el.dataset.player)];
      openDrawer({
        title: "玩家详情",
        body: `<pre>${esc(JSON.stringify(player, null, 2))}</pre>`,
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
