// -*- coding: utf-8 -*-

export async function renderPage({ root }) {
  root.innerHTML = `
    <section class="page">
      <div class="card">
        <div class="page-title">联办踢出</div>
        <div class="page-subtitle">这个页面已迁移到 Vue 页面，请使用 /plugins/lianban-kick。</div>
      </div>
    </section>
  `;
}
