// -*- coding: utf-8 -*-

export async function renderPage({ root, api, apiFetch, openDrawer, onNavigate }) {
  root.innerHTML = `
    <section class="page-header">
      <div class="header-main">
        <h1 class="page-title">快照录制</h1>
        <p class="page-subtitle">对局结束时自动记录的所有快照文件 (调试模式开启)</p>
      </div>
      <div class="header-actions">
        <button type="button" id="manual-snapshot-btn" class="bzss-btn primary">手动捕获快照</button>
      </div>
    </section>

    <section class="page-card">
      <div class="card-body">
        <table class="bzss-table">
          <thead>
            <tr>
              <th>名称</th>
              <th>录制时间</th>
              <th>大小</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody id="snapshot-list">
            <tr>
              <td colspan="4" class="text-center">正在加载...</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  `;

  const listEl = root.querySelector("#snapshot-list");
  const manualBtn = root.querySelector("#manual-snapshot-btn");

  async function loadList() {
    try {
      const snapshots = await api.matchSnapshot.listSnapshots();
      if (!snapshots || snapshots.length === 0) {
        listEl.innerHTML = `<tr><td colspan="4" class="text-center">暂无录制记录</td></tr>`;
        return;
      }

      listEl.innerHTML = snapshots.map(s => `
        <tr>
          <td><strong>${s.name}</strong></td>
          <td>${new Date(s.createdAt).toLocaleString()}</td>
          <td>${(s.size / 1024).toFixed(2)} KB</td>
          <td>
            <button type="button" class="bzss-btn sm" onclick="window.open('/api/match-snapshot/view?id=${encodeURIComponent(s.id)}')">查看 JSON</button>
          </td>
        </tr>
      `).join("");
    } catch (e) {
      listEl.innerHTML = `<tr><td colspan="4" class="text-center text-danger">加载失败: ${e.message}</td></tr>`;
    }
  }

  manualBtn.addEventListener("click", async () => {
    manualBtn.disabled = true;
    manualBtn.textContent = "捕获中...";
    try {
      await api.matchSnapshot.takeManualSnapshot();
      await loadList();
    } finally {
      manualBtn.disabled = false;
      manualBtn.textContent = "手动捕获快照";
    }
  });

  await loadList();
}
