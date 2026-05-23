// -*- coding: utf-8 -*-

export async function renderPage({ root, api, apiFetch }) {
  if (root.__fsbRefreshTimer) {
    window.clearTimeout(root.__fsbRefreshTimer);
    root.__fsbRefreshTimer = null;
  }

  let state = {
    enabled: true,
    logSeconds: 600,
    config: {
      phase1Seconds: 20,
      phase2Seconds: 50,
      infantryWhitelist: []
    }
  };

  async function loadStatus() {
    try {
      const resp = await apiFetch("/api/plugins/fair-squad-building/status");
      if (resp.ok) {
        state = { ...state, ...resp.data };
      }
    } catch (err) {
      console.error("[FSB] Load failed:", err);
    }
  }

  function render() {
    const isSafe = state.logSeconds < 590;
    const logTimeText = isSafe ? `${state.logSeconds}s` : `待定 (${state.logSeconds}s)`;
    const phase = state.logSeconds < state.config.phase1Seconds ? "阶段 1 (禁建)" : 
                 (state.logSeconds < state.config.phase2Seconds ? "阶段 2 (仅步兵)" : "阶段 3 (全开放)");

    root.innerHTML = `
      <section class="page">
        <div class="page-title-row">
          <div>
            <div class="page-title">公平建队设置</div>
            <div class="page-subtitle">控制开局阶段的建队规则，保障公平竞争。</div>
          </div>
          <div class="fsb-status-badge ${state.enabled ? "active" : "disabled"}">
            ${state.enabled ? "已开启" : "已关闭"}
          </div>
        </div>

        <div class="grid cols-2">
          <div class="card">
            <h3>实时状态</h3>
            <div class="fsb-stat-row">
              <span>当前日志时间:</span>
              <strong class="${isSafe ? "text-success" : "text-warning"}">${logTimeText}</strong>
            </div>
            <div class="fsb-stat-row">
              <span>当前阶段:</span>
              <strong>${phase}</strong>
            </div>
            <p class="text-muted" style="margin-top: 1rem; font-size: 0.85rem;">
              * 只有日志时间从 0 开始（检测到切图）时插件才会生效。
              如果日志时间为 600s（默认值），插件将自动进入保护模式，不执行任何操作。
            </p>
          </div>

          <div class="card">
            <h3>开关控制</h3>
            <div class="form-group">
              <label>插件总开关</label>
              <button id="fsb-toggle" class="btn ${state.enabled ? "btn-danger" : "btn-success"}">
                ${state.enabled ? "停用插件" : "启用插件"}
              </button>
            </div>
          </div>
        </div>

        <div class="card" style="margin-top: 1.5rem;">
          <h3>规则配置</h3>
          <div class="form-grid">
            <div class="form-group">
              <label>阶段 1 时长 (秒)</label>
              <input type="number" id="fsb-p1" value="${state.config.phase1Seconds}" min="0" max="300">
              <small>此时间内禁止任何建队动作。</small>
            </div>
            <div class="form-group">
              <label>阶段 2 时长 (秒)</label>
              <input type="number" id="fsb-p2" value="${state.config.phase2Seconds}" min="0" max="600">
              <small>此时间内仅允许默认队名（Squad X）和白名单中的队伍。</small>
            </div>
          </div>

          <div class="form-group" style="margin-top: 1.5rem;">
            <label>步兵队白名单 (每行一个关键字)</label>
            <textarea id="fsb-whitelist" rows="5" style="width: 100%; font-family: monospace;">${(state.config.infantryWhitelist || []).join("\n")}</textarea>
            <small>队名包含这些关键字的小队在阶段 2 不会被解散。</small>
          </div>

          <div style="margin-top: 2rem;">
            <button id="fsb-save" class="btn btn-primary">保存配置</button>
            <span id="fsb-save-status" style="margin-left: 1rem;"></span>
          </div>
        </div>
      </section>

      <style>
        .fsb-status-badge { padding: 4px 12px; border-radius: 4px; font-weight: bold; }
        .fsb-status-badge.active { background: #d4edda; color: #155724; }
        .fsb-status-badge.disabled { background: #f8d7da; color: #721c24; }
        .fsb-stat-row { display: flex; justify-content: space-between; margin-bottom: 0.5rem; font-size: 1.1rem; }
        .text-success { color: #28a745; }
        .text-warning { color: #ffc107; }
        .text-muted { color: #6c757d; }
        .form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        .form-group label { display: block; margin-bottom: 0.5rem; font-weight: bold; }
        .form-group input, .form-group textarea { padding: 8px; border: 1px solid #ddd; border-radius: 4px; width: 100%; box-sizing: border-box; }
        .btn { padding: 8px 16px; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .btn-primary { background: #007bff; color: white; }
        .btn-success { background: #28a745; color: white; }
        .btn-danger { background: #dc3545; color: white; }
      </style>
    `;

    root.querySelector("#fsb-toggle").onclick = async () => {
      const next = !state.enabled;
      await apiFetch("/api/plugins/fair-squad-building/config", {
        method: "PATCH",
        body: JSON.stringify({ enabled: next })
      });
      state.enabled = next;
      render();
    };

    root.querySelector("#fsb-save").onclick = async () => {
      const p1 = parseInt(root.querySelector("#fsb-p1").value);
      const p2 = parseInt(root.querySelector("#fsb-p2").value);
      const whitelist = root.querySelector("#fsb-whitelist").value.split("\n").map(s => s.trim()).filter(Boolean);
      
      const statusEl = root.querySelector("#fsb-save-status");
      statusEl.textContent = "正在保存...";
      
      try {
        await apiFetch("/api/plugins/fair-squad-building/config", {
          method: "PATCH",
          body: JSON.stringify({
            phase1Seconds: p1,
            phase2Seconds: p2,
            infantryWhitelist: whitelist
          })
        });
        statusEl.textContent = "✅ 已保存";
        state.config.phase1Seconds = p1;
        state.config.phase2Seconds = p2;
        state.config.infantryWhitelist = whitelist;
        setTimeout(() => { statusEl.textContent = ""; }, 2000);
      } catch (err) {
        statusEl.textContent = "❌ 保存失败";
      }
    };
  }

  await loadStatus();
  render();

  function scheduleRefresh() {
    root.__fsbRefreshTimer = window.setTimeout(async () => {
      await loadStatus();
      // 局部刷新时间，不重绘整个页面以防丢失输入
      const isSafe = state.logSeconds < 590;
      const logTimeText = isSafe ? `${state.logSeconds}s` : `待定 (${state.logSeconds}s)`;
      const timeEl = root.querySelector(".text-success, .text-warning");
      if (timeEl) {
        timeEl.textContent = logTimeText;
        timeEl.className = isSafe ? "text-success" : "text-warning";
      }
      scheduleRefresh();
    }, 2000);
  }

  scheduleRefresh();

  root.__pageCleanup = () => {
    if (root.__fsbRefreshTimer) {
      window.clearTimeout(root.__fsbRefreshTimer);
      root.__fsbRefreshTimer = null;
    }
  };

  return root.__pageCleanup;
}
