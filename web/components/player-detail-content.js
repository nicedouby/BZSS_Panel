// -*- coding: utf-8 -*-

export function renderPlayerDetailContent(viewModel = {}) {
  const squads = Array.isArray(viewModel.squadMembers) ? viewModel.squadMembers : [];
  return `
    <div class="floating-player-window__body-inner">
      ${viewModel.missingNotice ? `
        <div class="floating-player-window__notice">
          ${esc(viewModel.missingNotice)}
        </div>
      ` : ""}

      <section class="floating-player-window__section">
        <div class="floating-player-window__section-head">
          <div>
            <div class="floating-player-window__eyebrow">玩家详情</div>
            <div class="floating-player-window__title">${esc(viewModel.playerName || "未知玩家")}</div>
            <div class="floating-player-window__subtitle">
              ${esc(viewModel.playerSubtitle || "对局状态玩家详情")}
            </div>
          </div>
          <div class="floating-player-window__badge-row">
            ${viewModel.isLeader ? `<span class="match-badge leader">队长</span>` : ""}
            ${viewModel.stateLabel ? `<span class="match-pill">${esc(viewModel.stateLabel)}</span>` : ""}
          </div>
        </div>

        <div class="floating-player-window__grid">
          ${renderField("Steam ID", viewModel.steamID, "floating-player-window__copyable")}
          ${renderField("EOS ID", viewModel.eosID, "floating-player-window__copyable")}
          ${renderField("Player ID", viewModel.playerID)}
          ${renderField("当前 IP", viewModel.currentIp, "floating-player-window__copyable")}
          ${renderField("权限组", viewModel.permissionGroup)}
          ${renderField("队伍 / 小队", viewModel.teamSquadLabel)}
          ${renderField("阵营", viewModel.factionLabel)}
          ${renderField("职位 / 兵种", viewModel.roleLabel)}
          ${renderField("游戏时长", viewModel.playtimeLabel, "", "player-playtime-value")}
          ${renderField("最近可见", viewModel.lastSeenLabel)}
          ${renderField("K / D / Death", viewModel.statsLabel)}
          ${renderField("玩家历史入口", viewModel.historyEntryLabel)}
        </div>
      </section>

      <section class="floating-player-window__section">
        <div class="floating-player-window__section-head">
          <div>
            <div class="floating-player-window__eyebrow">管理操作</div>
            <div class="floating-player-window__subtitle">复制、警告、踢出、移出小队、跳转历史记录</div>
          </div>
        </div>

        <div class="floating-player-window__actions">
          <button type="button" id="refresh-player-playtime">刷新时长</button>
          <button type="button" id="warn-player">警告</button>
          <button type="button" id="kick-player">踢出</button>
          <button type="button" id="remove-player-from-squad">移除小队</button>
          <button type="button" id="open-player-database">玩家数据库</button>
        </div>

        <div class="floating-player-window__note" id="player-playtime-status">
          ${esc(viewModel.playtimeStatus || "Steam 时长刷新会写入本地时长缓存，并同步玩家档案。")}
        </div>
      </section>

      <section class="floating-player-window__section">
        <div class="floating-player-window__section-head">
          <div>
            <div class="floating-player-window__eyebrow">小队信息</div>
            <div class="floating-player-window__subtitle">${esc(viewModel.squadSubtitle || "当前玩家所属小队")}</div>
          </div>
          ${viewModel.squadBadge ? `<span class="match-squad-id">${esc(viewModel.squadBadge)}</span>` : ""}
        </div>

        <div class="floating-player-window__grid">
          ${renderField("小队名称", viewModel.squadName)}
          ${renderField("小队状态", viewModel.squadStateLabel)}
          ${renderField("创建人", viewModel.squadCreatorLabel)}
          ${renderField("成员数量", viewModel.squadSizeLabel)}
        </div>

        <div class="floating-player-window__member-list">
          ${squads.length
            ? squads.map((member, index) => renderMember(member, index)).join("")
            : `<div class="floating-player-window__empty">暂无小队成员</div>`}
        </div>
      </section>

      <section class="floating-player-window__section floating-player-window__combat-section">
        <div class="floating-player-window__section-head">
          <div>
            <div class="floating-player-window__eyebrow">Recent clean combat</div>
            <div class="floating-player-window__subtitle">${esc(viewModel.combatSubtitle || "按时间切片查看伤害、击倒、击杀频率")}</div>
          </div>
          <div class="floating-player-window__range" id="player-combat-range-label">最近 60 分钟</div>
        </div>

        <div id="player-combat-chart" class="floating-player-window__combat-chart">Loading...</div>
        <div id="player-combat-detail" class="floating-player-window__combat-detail">选择一个时间点查看详情。</div>
        <div id="player-clean-combat-list" class="floating-player-window__combat-list">Loading...</div>
      </section>
    </div>
  `;
}

function renderField(label, value, className = "", valueId = "") {
  const safeValue = value == null || value === "" ? "—" : value;
  const isCopyable = String(className || "").includes("copyable") && safeValue !== "—";
  const fieldClass = `floating-player-window__field ${className}`.trim();
  const content = isCopyable
    ? `
      <button type="button" class="floating-player-window__copy" data-copy-label="${esc(label)}" data-copy-value="${esc(safeValue)}">
        <span>${esc(label)}</span>
        <strong${valueId ? ` id="${esc(valueId)}"` : ""}>${esc(safeValue)}</strong>
      </button>
    `
    : `
      <span>${esc(label)}</span>
      <strong${valueId ? ` id="${esc(valueId)}"` : ""}>${esc(safeValue)}</strong>
    `;

  return `
    <div class="${fieldClass}">
      ${content}
    </div>
  `;
}

function renderMember(member = {}, index = 0) {
  return `
    <button type="button" class="floating-player-window__member" data-floating-member-index="${index}">
      <div class="floating-player-window__member-main">
        <span class="floating-player-window__member-name">${esc(member.name || "未知玩家")}</span>
        ${member.isLeader ? '<span class="match-badge leader">队长</span>' : ""}
      </div>
      <div class="floating-player-window__member-meta">
        ${member.playtime ? `<span>${esc(member.playtime)}</span>` : ""}
        ${member.squadLabel ? `<span>${esc(member.squadLabel)}</span>` : ""}
        ${member.roleLabel ? `<span>${esc(member.roleLabel)}</span>` : ""}
        ${member.stateLabel ? `<span>${esc(member.stateLabel)}</span>` : ""}
        ${member.statsLabel ? `<span>${esc(member.statsLabel)}</span>` : ""}
      </div>
    </button>
  `;
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
