// -*- coding: utf-8 -*-

export async function renderPage({ root, api }) {
  root.innerHTML = `
    <section class="page-header">
      <div class="header-main">
        <h1 class="page-title">快照录制</h1>
        <p class="page-subtitle">查看对局结束后自动生成的所有快照文件。</p>
      </div>
      <div class="header-actions">
        <button type="button" id="refresh-btn" class="bzss-btn">刷新列表</button>
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
  const refreshBtn = root.querySelector("#refresh-btn");

  async function loadList() {
    try {
      const snapshots = await api.matchSnapshot.listSnapshots();
      if (!snapshots || snapshots.length === 0) {
        listEl.innerHTML = `<tr><td colspan="4" class="text-center">暂无录制记录</td></tr>`;
        return;
      }

      listEl.innerHTML = snapshots.map((s) => `
        <tr>
          <td><strong>${s.name}</strong><div class="muted">${s.id}</div></td>
          <td>${new Date(s.createdAt).toLocaleString()}</td>
          <td>${(s.size / 1024).toFixed(2)} KB</td>
          <td>
            <button type="button" class="bzss-btn sm" onclick="window.open('/api/match-snapshot/view?id=${encodeURIComponent(s.id)}&format=image')">图片</button>
            <button type="button" class="bzss-btn sm" onclick="window.open('/api/match-snapshot/view?id=${encodeURIComponent(s.id)}&format=json')">JSON</button>
            <button type="button" class="bzss-btn sm" onclick="window.open('/api/match-snapshot/view?id=${encodeURIComponent(s.id)}&format=csv')">CSV</button>
            <button type="button" class="bzss-btn sm" onclick="window.open('/api/match-snapshot/view?id=${encodeURIComponent(s.id)}&format=markdown')">MD</button>
          </td>
        </tr>
      `).join("");
    } catch (error) {
      listEl.innerHTML = `<tr><td colspan="4" class="text-center text-danger">加载失败: ${error.message}</td></tr>`;
    }
  }

  refreshBtn.addEventListener("click", loadList);
  await loadList();
}
