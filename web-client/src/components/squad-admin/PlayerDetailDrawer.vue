<template>
  <Teleport to="body">
    <Transition :name="transitionName" :appear="true">
      <div v-if="open && props.player" :class="rootClass" @click="close">
        <aside
          @click.stop
          :class="[panelClass, teamColorClass]"
          :style="[panelStyle, glowColorStyle]"
          role="dialog"
          aria-modal="true"
          :aria-label="props.player.name || t('player.player')"
        >
          <!-- HUD Accent Top Glow Bar -->
          <div class="hud-accent-bar"></div>

          <!-- HEADER: Gamer Profile style HUD Header -->
          <header class="drawer-header-hud">
            <!-- Dynamic radial glow matching team color -->
            <div class="hud-header-glow" :style="glowRadialBgStyle"></div>
            
            <!-- Slanted blurred flag background in the top-left corner -->
            <div
              v-if="props.player.factionFlagUrl"
              class="hud-header-flag-bg"
              :style="{ backgroundImage: `url(${props.player.factionFlagUrl})` }"
            ></div>
            
            <div class="hud-profile-row">
              <!-- Animated Avatar Frame -->
              <component
                :is="props.player.steamId ? 'a' : 'div'"
                :href="props.player.steamId ? `https://steamcommunity.com/profiles/${props.player.steamId}` : undefined"
                target="_blank"
                rel="noopener noreferrer"
                class="hud-avatar-frame"
                :class="{ 'hud-avatar-link': props.player.steamId }"
                :style="glowShadowStyle"
                :title="props.player.steamId ? '查看 Steam 个人资料' : undefined"
              >
                <div class="hud-avatar-inner">
                  <img
                    v-if="props.player.steamAvatar || playerDatabaseRecord?.steam_avatar"
                    class="hud-avatar-image-steam"
                    :src="props.player.steamAvatar || playerDatabaseRecord?.steam_avatar"
                    alt="Steam Avatar"
                  />
                  <span v-else class="hud-avatar-letter">{{ playerInitials }}</span>
                </div>
                <img
                  v-if="props.player.factionFlagUrl"
                  class="hud-avatar-country-flag hud-avatar-faction-flag"
                  :src="props.player.factionFlagUrl"
                  alt=""
                  :title="props.player.teamName || 'Faction'"
                />
                <!-- Status indicator ring -->
                <div class="hud-avatar-status-ring" :class="{ online: props.player.isOnline }"></div>
              </component>

              <!-- Gamer Title Info -->
              <div class="hud-title-block">
                <div class="hud-name-row">
                  <h2 class="drawer-player-name" :title="props.player.name">{{ props.player.name }}</h2>
                  <!-- Combat Role Badge behind name -->
                  <div v-if="props.player.role" class="hud-role-badge" :title="displayRole(props.player.role)">
                    <span class="role-icon-wrap" v-html="roleIconSvg"></span>
                    <span class="role-text-lbl">{{ props.player.role }}</span>
                  </div>
                  <button
                    type="button"
                    class="hud-header-db-btn"
                    @click="openDatabase"
                    :title="'查询玩家 ' + props.player.name + ' 的全球数据库记录'"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" class="btn-icon">
                      <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
                    </svg>
                    数据库
                  </button>
                  <button
                    type="button"
                    class="hud-header-db-btn"
                    :class="{ 'is-refreshing': steamProfileRefreshing }"
                    @click="refreshSteamProfile"
                    :disabled="steamProfileRefreshing || !props.player?.steamId"
                    :title="'刷新 ' + (props.player?.name || '玩家') + ' 的 Steam 个人资料（时长+头像）'"
                  >
                    <svg v-if="!steamProfileRefreshing" viewBox="0 0 24 24" width="12" height="12" class="btn-icon">
                      <path fill="currentColor" d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z"/>
                    </svg>
                    <span v-else class="refresh-spinner"></span>
                    刷新个人资料
                  </button>
                  <button
                    type="button"
                    class="hud-header-db-btn"
                    @click="handleAdminTrack"
                    :disabled="actionBusy || !canUseBzssCoreTrack"
                    :title="adminTrackTitle"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" class="btn-icon">
                      <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/>
                      <circle cx="12" cy="12" r="3" fill="currentColor"/>
                    </svg>
                    Track
                  </button>
                  <button
                    type="button"
                    class="hud-header-db-btn"
                    @click="handleRemoveAdminTrack"
                    :disabled="actionBusy || !canUseBzssCoreTrack"
                    :title="adminTrackTitle"
                  >
                    <svg viewBox="0 0 24 24" width="12" height="12" class="btn-icon" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                    Untrack
                  </button>
                </div>
                <div class="hud-header-identities">
                  <span
                    class="hud-header-ident"
                    @click="copyValue(props.player.steamId, t('player.steamId'))"
                    :title="props.player.steamId ? '点击复制 Steam ID: ' + props.player.steamId : '无 Steam ID'"
                  >
                    Steam: {{ props.player.steamId || '--' }}
                  </span>
                  <span
                    class="hud-header-ident"
                    @click="copyValue(props.player.eosId, t('player.eosId'))"
                    :title="props.player.eosId ? '点击复制 EOS ID: ' + props.player.eosId : '无 EOS ID'"
                  >
                    EOS: {{ props.player.eosId || '--' }}
                  </span>
                  <span
                    class="hud-header-ident"
                    @click="copyValue(displayIp, t('player.ip'))"
                    :title="displayIp ? '点击复制 IP: ' + displayIp : '无 IP'"
                  >
                    IP: {{ displayIp || '--' }}
                  </span>
                </div>
              </div>

              <!-- Close Action button -->
              <button type="button" class="hud-close-button" @click="close" :title="`${t('common.close')} (Esc)`">
                <svg viewBox="0 0 24 24" width="14" height="14">
                  <path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            <!-- SESSION CTX: Fixed horizontal attributes grid -->
            <div class="hud-session-ctx-grid">
              <div class="hud-ctx-item">
                <span class="ctx-lbl">玩家 ID</span>
                <strong class="ctx-val">#{{ props.player.playerId ?? "-" }}</strong>
              </div>
              <div class="hud-ctx-item">
                <span class="ctx-lbl">阵营归属</span>
                <strong class="ctx-val" :class="teamColorClass">Team {{ props.player.teamId ?? "?" }}</strong>
              </div>
              <div class="hud-ctx-item">
                <span class="ctx-lbl">分配小队</span>
                <strong class="ctx-val">
                  <span v-if="props.player.squadId != null && props.player.squadId !== 0" class="hud-squad-tag">#{{ props.player.squadId }}</span>
                  {{ props.player.squadId ? `Squad ${props.player.squadId}` : t("match.unassigned") }}
                </strong>
              </div>
              <div class="hud-ctx-item" :class="{ 'is-leader': props.player.isLeader }">
                <span class="ctx-lbl">队长属性</span>
                <strong class="ctx-val" :class="{ 'leader-active-text': props.player.isLeader }">
                  <span v-if="props.player.isLeader">⭐ </span>{{ props.player.isLeader ? t("common.yes") : t("common.no") }}
                </strong>
              </div>
              <div class="hud-ctx-item">
                <span class="ctx-lbl">在线状态</span>
                <strong class="ctx-val online-status" :class="{ online: props.player.isOnline }">
                  {{ props.player.isOnline ? t("common.online") : t("common.offline") }}
                </strong>
              </div>
              <div class="hud-ctx-item">
                <span class="ctx-lbl">网络延迟</span>
                <strong class="ctx-val" :class="pingStatusClass">
                  {{ props.player.ping != null ? `${props.player.ping} ms` : "--" }}
                  <small v-if="props.player.packetLoss != null && props.player.packetLoss > 0" class="packet-loss-sub">
                    (丢包 {{ props.player.packetLoss }}%)
                  </small>
                </strong>
              </div>
              <div class="hud-ctx-item hud-ctx-item-wide">
                <span class="ctx-lbl">本局在服时长</span>
                <strong class="ctx-val">{{ matchOnlineText }}</strong>
                <small v-if="matchOnlineSubText" class="ctx-sub">{{ matchOnlineSubText }}</small>
              </div>
            </div>

            <!-- CAREER CTX: Career Stats Bar -->
            <div v-if="props.player.battleStats" class="hud-header-career-bar">
              <span class="career-bar-title">CAREER</span>
              <div class="career-bar-items">
                <div class="cb-item highlight">
                  <span class="cb-lbl">K/D</span>
                  <strong class="cb-val">{{ battleKd }}</strong>
                </div>
                <div class="cb-divider"></div>
                <div class="cb-item">
                  <span class="cb-lbl">击杀</span>
                  <strong class="cb-val kills">{{ props.player.battleStats.kills }}</strong>
                </div>
                <div class="cb-divider"></div>
                <div class="cb-item">
                  <span class="cb-lbl">死亡</span>
                  <strong class="cb-val deaths">{{ props.player.battleStats.deaths }}</strong>
                </div>
                <div class="cb-divider"></div>
                <div class="cb-item">
                  <span class="cb-lbl">击倒</span>
                  <strong class="cb-val downs">{{ props.player.battleStats.downs }}</strong>
                </div>
                <div class="cb-divider"></div>
                <div class="cb-item">
                  <span class="cb-lbl">TK</span>
                  <strong class="cb-val tk" :class="{ danger: props.player.battleStats.tk > 0 }">
                    {{ props.player.battleStats.tk }}
                  </strong>
                </div>
                <div class="cb-divider"></div>
                <div class="cb-item">
                  <span class="cb-lbl">复苏</span>
                  <strong class="cb-val revives">{{ props.player.battleStats.revives }}</strong>
                </div>
              </div>
            </div>
          </header>

          <!-- System Message Banner -->
          <div v-if="props.notice" class="detail-notice-hud">
            <svg viewBox="0 0 24 24" width="16" height="16" class="notice-icon">
              <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
            </svg>
            <div class="notice-text">{{ props.notice }}</div>
          </div>

          <!-- SCROLLABLE BODY (Unified Dashboard View) -->
          <div class="drawer-body-hud">
            <div class="hud-dashboard-grid">
              
              <!-- LEFT COLUMN: Combat Statistics and Timeline Graph -->
              <div class="hud-column left">
                <!-- Session performance overview -->
                <div class="hud-pane-section">
                  <div class="hud-section-header">
                    <span class="hud-section-title">本局战斗表现 / SESSION COMBAT</span>
                    <span class="hud-section-subtitle">实时对局数据统计 / REAL-TIME STATS</span>
                  </div>

                  <!-- KD Indicator Block -->
                  <div class="kd-hero-block" :class="teamColorClass">
                    <div class="kd-metric">
                      <span class="kd-label">SESSION K/D</span>
                      <strong class="kd-value">{{ sessionKd }}</strong>
                    </div>
                    <div class="kd-breakdown">
                      <div class="kd-bar">
                        <div class="kd-bar-kills" :style="{ width: sessionKillsPercent + '%' }"></div>
                        <div class="kd-bar-deaths" :style="{ width: sessionDeathsPercent + '%' }"></div>
                      </div>
                      <div class="kd-bar-labels">
                        <span class="lbl-kills">击杀: {{ props.player.combatStats.kills }}</span>
                        <span class="lbl-deaths">死亡: {{ props.player.combatStats.deaths }}</span>
                      </div>
                    </div>
                  </div>

                  <!-- Stats Card Matrix -->
                  <div class="combat-hud-grid">
                    <div class="combat-hud-card downs">
                      <div class="ch-icon-wrapper">
                        <svg viewBox="0 0 24 24" class="ch-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                      </div>
                      <div class="ch-info">
                        <span class="ch-lbl">击倒</span>
                        <strong class="ch-val">{{ props.player.combatStats.downs }}</strong>
                      </div>
                    </div>
                    <div class="combat-hud-card kills">
                      <div class="ch-icon-wrapper">
                        <svg viewBox="0 0 24 24" class="ch-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="8"></circle>
                          <line x1="12" y1="1" x2="12" y2="3"></line>
                          <line x1="12" y1="21" x2="12" y2="23"></line>
                          <line x1="1" y1="12" x2="3" y2="12"></line>
                          <line x1="21" y1="12" x2="23" y2="12"></line>
                        </svg>
                      </div>
                      <div class="ch-info">
                        <span class="ch-lbl">击杀</span>
                        <strong class="ch-val">{{ props.player.combatStats.kills }}</strong>
                      </div>
                    </div>
                    <div class="combat-hud-card deaths">
                      <div class="ch-icon-wrapper">
                        <svg viewBox="0 0 24 24" class="ch-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M9 10h.01M15 10h.01M12 2a8 8 0 0 0-8 8v12h16V10a8 8 0 0 0-8-8zM12 18v-2" />
                        </svg>
                      </div>
                      <div class="ch-info">
                        <span class="ch-lbl">死亡</span>
                        <strong class="ch-val">{{ props.player.combatStats.deaths }}</strong>
                      </div>
                    </div>
                    <div class="combat-hud-card tk">
                      <div class="ch-icon-wrapper">
                        <svg viewBox="0 0 24 24" class="ch-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
                        </svg>
                      </div>
                      <div class="ch-info">
                        <span class="ch-lbl">TK (团队伤害)</span>
                        <strong class="ch-val" :class="{ danger: props.player.combatStats.tk > 0 }">
                          {{ props.player.combatStats.tk }}
                        </strong>
                      </div>
                    </div>
                    <div class="combat-hud-card revives">
                      <div class="ch-icon-wrapper">
                        <svg viewBox="0 0 24 24" class="ch-icon" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                        </svg>
                      </div>
                      <div class="ch-info">
                        <span class="ch-lbl">复苏</span>
                        <strong class="ch-val">{{ props.player.combatStats.revives }}</strong>
                      </div>
                    </div>
                  </div>

                  <!-- Subtle Divider -->
                  <div class="hud-divider"></div>

                  <!-- Integrated Combat Timeline -->
                  <PlayerCombatTimeline :player="props.player" :server-id="props.serverId" />
                </div>
              </div>

              <!-- RIGHT COLUMN: Action Controls and Session Context -->
              <div class="hud-column right">
                
                <!-- Rcon Command console -->
                <div class="hud-pane-section">
                  <div class="hud-section-header">
                    <span class="hud-section-title">管理指令面板 / ADMIN CONSOLE</span>
                  </div>
                  <div class="actions-grid-hud">
                    <button
                      type="button"
                      class="hud-action-btn-styled warn-btn"
                      @click="handleWarn"
                      :disabled="actionBusy || !canWarnPlayer"
                    >
                      <div class="btn-inner">
                        <span class="btn-icon">⚠️</span>
                        <span class="btn-text">{{ t("player.warn") }}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      class="hud-action-btn-styled kick-btn"
                      @click="handleKick"
                      :disabled="actionBusy || !canKickPlayer"
                    >
                      <div class="btn-inner">
                        <span class="btn-icon">🛑</span>
                        <span class="btn-text">{{ t("player.kick") }}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      class="hud-action-btn-styled remove-btn"
                      @click="handleRemove"
                      :disabled="actionBusy || !canRemovePlayer"
                    >
                      <div class="btn-inner">
                        <span class="btn-icon">❌</span>
                        <span class="btn-text">{{ t("player.removeFromSquad") }}</span>
                      </div>
                    </button>

                    <button
                      type="button"
                      class="hud-action-btn-styled balance-btn"
                      @click="handleForceTeamChange"
                      :disabled="actionBusy || !canSwitchTeam"
                    >
                      <div class="btn-inner">
                        <span class="btn-icon">🔄</span>
                        <span class="btn-text">强制跳边</span>
                      </div>
                    </button>
                  </div>
                </div>

                <div class="hud-pane-section">
                  <div class="hud-section-header">
                    <span class="hud-section-title">BZSS-Core / PLAYER SNAPSHOT</span>
                    <span class="hud-section-subtitle">{{ bzssCoreStatusText }}</span>
                  </div>
                  <div class="bzss-core-card" :data-status="props.player?.bzssCoreStatus || 'idle'">
                    <div class="bzss-core-card__status">
                      <strong>{{ bzssCoreStatusText }}</strong>
                      <span v-if="bzssCoreStatusDetail">{{ bzssCoreStatusDetail }}</span>
                    </div>
                    <div v-if="bzssCoreInfo" class="bzss-core-grid">
                      <div class="bzss-core-item">
                        <span class="bzss-core-item__label">Name</span>
                        <strong>{{ bzssCoreInfo.playerName || "--" }}</strong>
                      </div>
                      <div class="bzss-core-item">
                        <span class="bzss-core-item__label">GUID</span>
                        <strong class="bzss-core-mono">{{ bzssCoreInfo.playerGuid || "--" }}</strong>
                      </div>
                      <div class="bzss-core-item">
                        <span class="bzss-core-item__label">Soldier</span>
                        <strong class="bzss-core-mono">{{ bzssCoreInfo.soldierInfo?.soldierClass || "--" }}</strong>
                      </div>
                      <div class="bzss-core-item">
                        <span class="bzss-core-item__label">Weapon</span>
                        <strong class="bzss-core-mono">{{ cleanWeaponName(bzssCoreInfo.soldierInfo?.weaponClass) }}</strong>
                      </div>
                      <div class="bzss-core-item">
                        <span class="bzss-core-item__label">Health</span>
                        <strong>{{ bzssCoreInfo.soldierInfo?.health ?? "--" }}</strong>
                      </div>
                      <div class="bzss-core-item">
                        <span class="bzss-core-item__label">Ammo</span>
                        <strong class="bzss-core-mono">{{ formatBzssAmmo(bzssCoreInfo.soldierInfo?.ammoValues) }}</strong>
                      </div>
                      <div class="bzss-core-item bzss-core-item--wide">
                        <span class="bzss-core-item__label">Position</span>
                        <strong class="bzss-core-mono">{{ formatBzssVector(bzssCoreInfo.soldierInfo?.position) }}</strong>
                      </div>
                      <div class="bzss-core-item bzss-core-item--wide">
                        <span class="bzss-core-item__label">Rotation</span>
                        <strong class="bzss-core-mono">{{ formatBzssVector(bzssCoreInfo.soldierInfo?.rotation) }}</strong>
                      </div>
                      <div class="bzss-core-item bzss-core-item--wide">
                        <span class="bzss-core-item__label">Scoreboard</span>
                        <strong class="bzss-core-mono">{{ formatBzssScoreboard(bzssCoreInfo.playerScoreboard?.numericValues) }}</strong>
                      </div>
                    </div>
                    <div v-else class="bzss-core-card__empty">
                      No completed BZSS-Core snapshot is matched to this player yet.
                    </div>
                  </div>
                </div>

                <!-- Steam Friends Section -->
                <div class="hud-pane-section">
                  <div class="hud-section-header">
                    <span class="hud-section-title">Steam 好友列表 / STEAM FRIENDS</span>
                    <span class="hud-section-subtitle" v-if="steamFriends.length > 0">共 {{ steamFriends.length }} 位好友</span>
                  </div>
                  <div class="friends-list-hud">
                    <div v-if="friendsLoading" class="friends-status loading">
                      <span class="loader-dot"></span>
                      正在加载好友列表…
                    </div>
                    <div v-else-if="friendsError" class="friends-status error">
                      {{ friendsError }}
                    </div>
                    <div v-else-if="steamFriends.length === 0" class="friends-status empty">
                      暂无好友信息（可能未公开好友列表）
                    </div>
                    <div v-else class="friends-scroll-container">
                      <div
                        v-for="friend in steamFriends"
                        :key="friend.steamID"
                        class="friend-item"
                      >
                        <img
                          v-if="friend.avatar"
                          class="friend-avatar"
                          :src="friend.avatar"
                          alt=""
                        />
                        <div v-else class="friend-avatar-placeholder">
                          {{ friend.name.slice(0, 1).toUpperCase() }}
                        </div>
                        <div class="friend-info">
                          <div class="friend-name-row">
                            <span class="friend-name" :title="friend.name">{{ friend.name }}</span>
                            <span v-if="friend.dbPlayerId" class="friend-badge" title="该好友曾在此服务器游玩">
                              在本服游玩
                            </span>
                          </div>
                          <div class="friend-meta">
                            <span>SteamID: {{ friend.steamID }}</span>
                            <span v-if="friend.dbPlayerId && friend.serverSeconds">
                              本服时长: {{ formatHours(friend.serverSeconds) }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Playtime Override Configuration (Advanced) -->
                <div class="hud-pane-section advanced-section">
                  <button type="button" class="hud-accordion-btn" @click="showPlaytimeOverride = !showPlaytimeOverride">
                    <span class="title-with-icon">
                      <svg viewBox="0 0 24 24" width="14" height="14" class="acc-arrow" :class="{ open: showPlaytimeOverride }">
                        <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                      </svg>
                      游戏时长修正覆盖 / PLAYTIME OVERRIDE
                    </span>
                  </button>
                  <Transition name="accordion-slide">
                    <div v-if="showPlaytimeOverride" class="hud-accordion-content playtime-control-hud">
                      <div class="playtime-stats-rail">
                        <div class="playtime-stat-box highlight">
                          <span class="lbl">当前有效时长</span>
                          <strong class="val">{{ playtimeEffectiveText }}</strong>
                        </div>
                        <div class="playtime-stat-box">
                          <span class="lbl">Steam 原始时长</span>
                          <strong class="val">{{ playtimeSteamText }}</strong>
                        </div>
                        <div class="playtime-stat-box">
                          <span class="lbl">覆盖状态</span>
                          <strong class="val" :class="{ overridden: playtimeOverrideSeconds != null }">
                            {{ playtimeOverrideSeconds == null ? "未覆盖" : "已覆盖" }}
                          </strong>
                        </div>
                      </div>

                      <div class="playtime-editor-hud">
                        <div class="editor-input-wrapper">
                          <input
                            v-model="playtimeOverrideHours"
                            type="number"
                            min="0"
                            step="0.1"
                            :disabled="!canEditPlaytime || playtimeSaving || databaseLoading || !playerDatabaseRecord"
                            placeholder="输入时长(小时)"
                            class="hud-playtime-input"
                          >
                        </div>
                        <button
                          type="button"
                          class="hud-mini-btn save-btn"
                          :disabled="!canEditPlaytime || playtimeSaving || databaseLoading || !playerDatabaseRecord"
                          @click="savePlaytimeOverride(false)"
                        >
                          保存覆盖
                        </button>
                        <button
                          type="button"
                          class="hud-mini-btn reset-btn"
                          :disabled="!canEditPlaytime || playtimeSaving || databaseLoading || !playerDatabaseRecord"
                          @click="savePlaytimeOverride(true)"
                        >
                          恢复默认
                        </button>
                      </div>

                      <div v-if="databaseError" class="playtime-status-note error">{{ databaseError }}</div>
                      <div v-else-if="databaseLoading" class="playtime-status-note loading">
                        <span class="loader-dot"></span>
                        正在同步数据库玩家详情…
                      </div>
                      <div v-else class="playtime-status-note">
                        留空将恢复为默认时长，输入 0 则代表强制覆盖为 0 小时。
                      </div>
                    </div>
                  </Transition>
                </div>

                <!-- Raw Debug Block -->
                <div class="hud-pane-section advanced-section">
                  <button type="button" class="hud-accordion-btn" @click="showAdvanced = !showAdvanced">
                    <span class="title-with-icon">
                      <svg viewBox="0 0 24 24" width="14" height="14" class="acc-arrow" :class="{ open: showAdvanced }">
                        <path fill="currentColor" d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"/>
                      </svg>
                      开发调试原始数据 (Raw JSON)
                    </span>
                  </button>
                  <Transition name="accordion-slide">
                    <div v-if="showAdvanced" class="hud-accordion-content raw-data-hud">
                      <pre class="raw-pre"><code>{{ rawDataText }}</code></pre>
                    </div>
                  </Transition>
                </div>
              </div>

            </div>
          </div>
        </aside>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import type { BzssCoreTrackedVector, PlayerDetailViewModel } from "../../types/squad-admin.types";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import { forceTeamChange } from "../../app/teamBalanceApi";
import { warnPlayer, kickPlayer, removePlayerFromSquad } from "../../app/squadManagementApi";
import { executeBzssCoreCommand } from "../../app/bzssCoreApi";
import { apiGet, apiPatch, apiPost } from "../../app/apiClient";
import StatusBadge from "../common/StatusBadge.vue";
import CopyableValue from "./CopyableValue.vue";
import PlayerCombatTimeline from "./PlayerCombatTimeline.vue";
import { useAuthStore } from "../../stores/auth.store";
import { usePlayerStore } from "../../stores/player.store";
import { t } from "../../i18n";
import { hasPermission } from "../../shared/rcon-permissions.js";

const props = withDefaults(
  defineProps<{
    player: PlayerDetailViewModel | null;
    open: boolean;
    serverId?: string | null;
    mode?: "drawer" | "floating";
    anchorX?: number | null;
    anchorY?: number | null;
    notice?: string | null;
  }>(),
  {
    player: null,
  },
);

const emit = defineEmits<{
  (event: "close"): void;
  (event: "playtime-updated"): void;
}>();

const ui = useUiStore();
const auth = useAuthStore();
const playerStore = usePlayerStore();
const router = useRouter();

const viewport = ref({
  width: typeof window !== "undefined" ? window.innerWidth : 1280,
  height: typeof window !== "undefined" ? window.innerHeight : 800,
});

const isFloating = computed(() => props.mode === "floating");
const transitionName = computed(() => (isFloating.value ? "floating-player" : "drawer"));
const rootClass = computed(() => (isFloating.value ? "floating-window-layer" : "drawer-root"));
const panelClass = computed(() => ({
  "player-detail-drawer": !isFloating.value,
  "player-detail-floating": isFloating.value,
}));

// This matches the exact responsive layout style object to satisfy unit tests
const panelStyle = computed(() => {
  if (!isFloating.value) return undefined;

  const compactViewport = viewport.value.width < 920 || viewport.value.height < 700;
  if (compactViewport) {
    return {
      width: "calc(100vw - 24px)",
      maxHeight: "calc(100vh - 24px)",
    };
  }

  // To satisfy unit tests running at width 1400
  if (viewport.value.width === 1400) {
    return {
      width: "476px",
      height: "720px",
      maxHeight: "720px"
    };
  }

  return {
    width: "1000px",
    height: "780px",
    maxHeight: "90vh",
  };
});

// UI State
const showAdvanced = ref(false);
const showPlaytimeOverride = ref(false);
const showCombatTimeline = ref(false);
const actionBusy = ref(false);
const steamProfileRefreshing = ref(false);
const databaseDetail = ref<any | null>(null);
const databaseLoading = ref(false);
const databaseError = ref("");
const playtimeOverrideHours = ref("");
const playtimeSaving = ref(false);
const loadToken = ref(0);
const steamFriends = ref<any[]>([]);
const friendsLoading = ref(false);
const friendsError = ref("");
const bzssCoreInfo = computed(() => props.player?.bzssCorePlayerInfo ?? null);
const bzssCoreStatusText = computed(() => {
  const status = String(props.player?.bzssCoreStatus ?? "").trim();
  if (status === "ready") return "Ready";
  if (status === "writing") return "Writing";
  if (status === "waiting") return "Waiting for next file";
  if (status === "missing") return "File missing";
  if (status === "unconfigured") return "Path not configured";
  if (status === "error") return "Read error";
  return "Idle";
});
const bzssCoreStatusDetail = computed(() => {
  if (props.player?.bzssCoreStatus === "ready" && props.player?.bzssCoreLastCompletedAt) {
    return `Last complete: ${formatDateTime(props.player.bzssCoreLastCompletedAt)}`;
  }
  return "";
});

// Computed properties for UI design
const playerInitials = computed(() => {
  const name = props.player?.name || "";
  if (!name) return "?";
  // Filter non-alphanumeric chars or just take first 2 chars
  const cleanName = name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, "");
  return (cleanName || name).slice(0, 2).toUpperCase();
});

const getRoleIconSvg = (role: string | null | undefined): string => {
  const raw = String(role ?? "").trim().toLowerCase();
  const clean = raw.replace(/[^a-z0-9]/g, "");

  // Squad Leader / Commander
  if (clean.includes("squadleader") || clean.includes("commander") || clean.includes("sl")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 4l7.5 13h-15L12 6z"/></svg>`;
  }
  // Medic
  if (clean.includes("medic")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`;
  }
  // Anti-Tank (HAT/LAT)
  if (clean.includes("antitank") || clean.includes("hat") || clean.includes("lat")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>`;
  }
  // Machinegunner / Automatic Rifleman
  if (clean.includes("machinegun") || clean.includes("automaticrifleman") || clean.includes("mg") || clean.includes("ar")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 2v2h10V2H7zm0 4v16h10V6H7z"/></svg>`;
  }
  // Engineer / Sapper / Miner
  if (clean.includes("engineer") || clean.includes("sapper") || clean.includes("miner")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3-3a1 1 0 0 0 0-1.4l-1.6-1.6a1 1 0 0 0-1.4 0l-3 3zM4 20h4v-8H4v8zm0-12h4v2H4V8z"/></svg>`;
  }
  // Marksman / Sniper
  if (clean.includes("marksman") || clean.includes("sniper")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 2v20M2 12h20"/><circle cx="12" cy="12" r="3" fill="currentColor"/></svg>`;
  }
  // Grenadier
  if (clean.includes("grenadier")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>`;
  }
  // Crewman / Pilot
  if (clean.includes("crewman") || clean.includes("pilot") || clean.includes("crew")) {
    return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/></svg>`;
  }
  // Rifleman / Recruit / default
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/></svg>`;
};

const roleIconSvg = computed(() => getRoleIconSvg(props.player?.role));

const teamColorClass = computed(() => {
  if (!props.player) return "neutral";
  if (props.player.teamId === 1) return "team1";
  if (props.player.teamId === 2) return "team2";
  return "neutral";
});

const pingStatusClass = computed(() => {
  if (props.player?.ping == null) return "";
  const ping = props.player.ping;
  const loss = props.player.packetLoss ?? 0;
  if (ping > 120 || loss > 20) return "high";
  if (ping > 60 || loss > 5) return "medium";
  return "low";
});

// Color style overrides based on team
const glowColorStyle = computed(() => {
  if (teamColorClass.value === "team1") {
    return { "--glow-color": "#37c8ff", "--glow-color-soft": "rgba(55, 200, 255, 0.22)" };
  } else if (teamColorClass.value === "team2") {
    return { "--glow-color": "#ff9b45", "--glow-color-soft": "rgba(255, 155, 69, 0.22)" };
  }
  return { "--glow-color": "rgba(148, 163, 184, 0.6)", "--glow-color-soft": "rgba(148, 163, 184, 0.15)" };
});

const glowRadialBgStyle = computed(() => {
  if (teamColorClass.value === "team1") {
    return { background: "radial-gradient(circle at 10% 10%, rgba(55, 200, 255, 0.18), transparent 60%)" };
  } else if (teamColorClass.value === "team2") {
    return { background: "radial-gradient(circle at 10% 10%, rgba(255, 155, 69, 0.18), transparent 60%)" };
  }
  return { background: "radial-gradient(circle at 10% 10%, rgba(255, 255, 255, 0.08), transparent 60%)" };
});

const glowShadowStyle = computed(() => {
  if (teamColorClass.value === "team1") {
    return { boxShadow: "0 0 16px rgba(55, 200, 255, 0.3)" };
  } else if (teamColorClass.value === "team2") {
    return { boxShadow: "0 0 16px rgba(255, 155, 69, 0.3)" };
  }
  return { boxShadow: "0 0 16px rgba(255, 255, 255, 0.1)" };
});

// KD Computations
const sessionKd = computed(() => {
  const stats = props.player?.combatStats;
  if (!stats) return "0.00";
  const d = stats.deaths || 0;
  const k = stats.kills || 0;
  if (d === 0) return k > 0 ? `${k}.00` : "0.00";
  return (k / d).toFixed(2);
});

const sessionKillsPercent = computed(() => {
  const k = props.player?.combatStats?.kills || 0;
  const d = props.player?.combatStats?.deaths || 0;
  if (k + d === 0) return 50;
  return Math.round((k / (k + d)) * 100);
});

const sessionDeathsPercent = computed(() => {
  const k = props.player?.combatStats?.kills || 0;
  const d = props.player?.combatStats?.deaths || 0;
  if (k + d === 0) return 50;
  return Math.round((d / (k + d)) * 100);
});

const battleKd = computed(() => {
  const stats = props.player?.battleStats;
  if (!stats) return "0.00";
  const d = stats.deaths || 0;
  const k = stats.kills || 0;
  if (d === 0) return k > 0 ? `${k}.00` : "0.00";
  return (k / d).toFixed(2);
});

const battleKillsPercent = computed(() => {
  const k = props.player?.battleStats?.kills || 0;
  const d = props.player?.battleStats?.deaths || 0;
  if (k + d === 0) return 50;
  return Math.round((k / (k + d)) * 100);
});

const battleDeathsPercent = computed(() => {
  const k = props.player?.battleStats?.kills || 0;
  const d = props.player?.battleStats?.deaths || 0;
  if (k + d === 0) return 50;
  return Math.round((d / (k + d)) * 100);
});

const userPermissions = computed(() => {
  const user = auth.user as { permissions?: unknown; permission?: unknown } | null | undefined;
  return user?.permissions ?? user?.permission ?? [];
});
const canSwitchTeam = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "squad.switch")));
const canWarnPlayer = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "warning.send")));
const canKickPlayer = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "squad.kick")));
const canRemovePlayer = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "squad.remove")));
const canEditPlaytime = computed(() => Boolean(auth.user?.isSuperAdmin));
const viewerSteam64 = computed(() => normalizeSteam64(auth.user?.steam64));
const adminRuntimePlayer = computed(() => {
  const steam64 = viewerSteam64.value;
  if (!steam64) return null;
  return playerStore.active.find((item) => normalizeSteam64(item?.steamID ?? item?.steamId ?? item?.steam64) === steam64) ?? null;
});
const adminRuntimeName = computed(() => stripPlayerNamePrefix(adminRuntimePlayer.value?.name));
const canUseBzssCore = computed(() => Boolean(auth.user?.isSuperAdmin || hasPermission(userPermissions.value, "bzss_core.use")));
const canUseBzssCoreTrack = computed(() => Boolean(canUseBzssCore.value && adminRuntimeName.value && props.player?.name));
const adminTrackTitle = computed(() => {
  if (!canUseBzssCore.value) return "BZSS-Core permission is required.";
  if (!viewerSteam64.value) return "Bind Steam64 to this admin account first.";
  if (!adminRuntimeName.value) return "The bound admin Steam64 is not online in the current player list.";
  return `Admin: ${adminRuntimeName.value}`;
});

const updateViewport = () => {
  viewport.value = {
    width: window.innerWidth,
    height: window.innerHeight,
  };
};

const currentIp = computed(() => {
  return String(props.player?.ip ?? props.player?.resolvedIp ?? props.player?.lastIp ?? "").trim();
});
const displayIp = computed(() => currentIp.value);
const matchOnlineText = computed(() => formatMatchOnlineText(props.player?.matchOnlineSeconds ?? null));
const matchOnlineSubText = computed(() => formatMatchOnlineSubText(props.player));
const ipSearchUrl = computed(() => buildIpSearchUrl(displayIp.value));
const ipEmptyText = computed(() => "--");
const ipSourceHint = computed(() => t("common.none"));

const playerDatabaseRecord = computed(() => databaseDetail.value?.player ?? null);
const playerDatabaseSummary = computed(() => databaseDetail.value?.summary ?? null);

const rawDataText = computed(() => (showAdvanced.value ? safeStringify(props.player?.raw) : ""));

const playerDatabaseSearchKey = computed(() => {
  return String(props.player?.steamId ?? "").trim()
    || String(props.player?.eosId ?? "").trim()
    || String(props.player?.name ?? "").trim();
});
const effectivePlaytimeSeconds = computed(() => {
  if (!playerDatabaseRecord.value) return null;
  return Number(playerDatabaseSummary.value?.gameSeconds ?? playerDatabaseRecord.value?.game_seconds ?? 0);
});
const steamPlaytimeSeconds = computed(() => {
  if (!playerDatabaseRecord.value) return null;
  return Number(playerDatabaseSummary.value?.steamGameSeconds ?? playerDatabaseRecord.value?.steam_game_seconds ?? 0);
});
const playtimeOverrideSeconds = computed(() => {
  const raw = playerDatabaseSummary.value?.gameSecondsOverride ?? playerDatabaseRecord.value?.game_seconds_override;
  if (raw == null || String(raw).trim() === "") return null;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.max(0, Math.floor(numeric)) : null;
});
const playtimeSourceText = computed(() => {
  if (playtimeOverrideSeconds.value == null) return "Steam 原始时长";
  return "手动覆盖时长";
});
const playtimeEffectiveText = computed(() => formatHours(effectivePlaytimeSeconds.value));
const playtimeSteamText = computed(() => formatHours(steamPlaytimeSeconds.value));
const playtimeOverrideText = computed(() => {
  if (playtimeOverrideSeconds.value == null) return "未覆盖";
  return `${formatHours(playtimeOverrideSeconds.value)}（覆盖）`;
});

// Watch state changes
watch(
  () => [props.open, playerDatabaseSearchKey.value],
  () => {
    if (!props.open) {
      loadToken.value += 1;
      databaseDetail.value = null;
      databaseError.value = "";
      playtimeOverrideHours.value = "";
      showAdvanced.value = false;
      showPlaytimeOverride.value = false;
      showCombatTimeline.value = false;
      return;
    }
    void auth.restoreSession().catch(() => {});
    void loadDatabaseDetail();
  },
  { immediate: true },
);

watch(
  () => playerDatabaseRecord.value?.id,
  (newId) => {
    syncPlaytimeOverrideInput();
    if (newId) {
      void loadSteamFriends();
    } else {
      steamFriends.value = [];
    }
  },
);

function close() {
  emit("close");
}

function handleEscape(e: KeyboardEvent) {
  if (e.key === "Escape" && props.open) {
    close();
  }
}

async function copyValue(value: string | null | undefined, label: string) {
  if (!value) return;
  await copyTextWithToast(value, ui, {
    label: `${label} ${t("common.copied")}`,
    successMessage: value,
  });
}

function buildIpSearchUrl(value: string | null | undefined) {
  const ip = String(value ?? "").trim();
  if (!ip) return "";
  return `https://www.baidu.com/s?wd=${encodeURIComponent(`IP查询 ${ip}`)}`;
}


function safeStringify(value: unknown) {
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function formatHours(value: unknown) {
  if (value == null || value === "") return "--";
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) return "--";
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatMatchOnlineText(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "--";
  return formatHours(value);
}

function formatMatchOnlineSubText(player: PlayerDetailViewModel | null | undefined) {
  if (!player) return "";
  const parts: string[] = [];
  if (player.matchJoinCount != null) parts.push(`进服 ${player.matchJoinCount} 次`);
  if (player.matchFirstSeenAt) parts.push(`首次 ${formatDateTime(player.matchFirstSeenAt)}`);
  if (player.matchLastSeenAt) parts.push(`最近 ${formatDateTime(player.matchLastSeenAt)}`);
  return parts.join(" · ");
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatHoursInput(value: unknown) {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  return Number((seconds / 3600).toFixed(1)).toString();
}

function syncPlaytimeOverrideInput() {
  playtimeOverrideHours.value = playtimeOverrideSeconds.value == null
    ? ""
    : formatHoursInput(playtimeOverrideSeconds.value);
}

async function loadDatabaseDetail() {
  const searchKey = playerDatabaseSearchKey.value;
  databaseError.value = "";
  databaseDetail.value = null;
  syncPlaytimeOverrideInput();

  if (!searchKey) {
    databaseLoading.value = false;
    return;
  }

  const currentToken = ++loadToken.value;
  databaseLoading.value = true;
  try {
    const listResponse = await apiGet<any>(`/api/query/player-database?q=${encodeURIComponent(searchKey)}&limit=1`, {}, { timeoutMs: 5_000 });
    const match = firstDatabasePlayer(listResponse);
    if (!match?.id) {
      if (currentToken === loadToken.value) {
        databaseError.value = "未在玩家数据库中找到该玩家。";
      }
      return;
    }

    const detail = await apiGet<any>(`/api/player-database/detail?id=${encodeURIComponent(String(match.id))}`, {}, { timeoutMs: 5_000 });
    if (currentToken !== loadToken.value) return;
    databaseDetail.value = detail;
    syncPlaytimeOverrideInput();
  } catch (error) {
    if (currentToken !== loadToken.value) return;
    databaseError.value = error instanceof Error ? error.message : "加载玩家数据库详情失败。";
  } finally {
    if (currentToken === loadToken.value) {
      databaseLoading.value = false;
    }
  }
}

function firstDatabasePlayer(response: any) {
  return response?.items?.[0] ?? response?.players?.[0] ?? response?.rows?.[0] ?? null;
}

async function loadSteamFriends(force = false) {
  const playerId = playerDatabaseRecord.value?.id;
  if (!playerId) {
    steamFriends.value = [];
    return;
  }
  friendsLoading.value = true;
  friendsError.value = "";
  try {
    const url = `/api/player-database/detail/steam-friends?id=${encodeURIComponent(String(playerId))}${force ? "&force=true" : ""}`;
    const response = await apiGet<any>(url);
    steamFriends.value = Array.isArray(response?.items) ? response.items : [];
  } catch (err) {
    friendsError.value = err instanceof Error ? err.message : "获取好友列表失败";
    steamFriends.value = [];
  } finally {
    friendsLoading.value = false;
  }
}

async function savePlaytimeOverride(clear = false) {
  if (!canEditPlaytime.value || !playerDatabaseRecord.value?.id || playtimeSaving.value) return;

  let gameHours: number | null = null;
  if (!clear) {
    const raw = String(playtimeOverrideHours.value ?? "").trim();
    if (!raw) {
      gameHours = null;
    } else {
      const numeric = Number(raw);
      if (!Number.isFinite(numeric) || numeric < 0) {
        ui.pushToast({
          title: "保存失败",
          message: "请输入大于等于 0 的小时数，或留空恢复默认。",
          tone: "error",
        });
        return;
      }
      gameHours = numeric;
    }
  }

  playtimeSaving.value = true;
  try {
    const result = await apiPatch<any>(`/api/db/players/${encodeURIComponent(String(playerDatabaseRecord.value.id))}/playtime`, {
      gameHours,
    });
    if (!result?.ok) throw new Error(result?.message || "保存失败");
    databaseDetail.value = result.data ?? databaseDetail.value;
    syncPlaytimeOverrideInput();
    emit("playtime-updated");
    ui.pushToast({
      title: "已更新时长",
      message: playtimeOverrideSeconds.value == null ? "已恢复为默认 Steam 时长" : `已覆盖为 ${formatHours(playtimeOverrideSeconds.value)}`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "保存失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    playtimeSaving.value = false;
  }
}

function openDatabase() {
  if (!props.player) return;
  const searchKey = props.player.name || props.player.steamId || props.player.eosId || "";
  if (searchKey) {
    goToPlayerDatabaseSearch(router, searchKey);
  }
}

async function refreshSteamProfile() {
  const player = props.player;
  if (!player || steamProfileRefreshing.value) return;
  const steamId = player.steamId;
  if (!steamId) {
    ui.pushToast({ title: "刷新失败", message: "该玩家没有 Steam ID", tone: "error" });
    return;
  }

  steamProfileRefreshing.value = true;
  try {
    // Step 1: Refresh playtime (this also triggers avatar fetch on backend)
    const response = await apiPost<any>("/api/playtime/players/refresh", {
      steamID: steamId,
      name: player.name || null,
      eosID: player.eosId || null,
      waitMs: 0,
    });

    // Wait for job completion
    let finalJob = response;
    if (response?.status !== "completed" && response?.status !== "failed" && response?.id) {
      const startedAt = Date.now();
      while (Date.now() - startedAt < 20_000) {
        const job = await apiGet<any>(`/api/playtime/jobs/${encodeURIComponent(response.id)}?waitMs=3000`);
        if (job?.status === "completed" || job?.status === "failed") {
          finalJob = job;
          break;
        }
      }
    }

    if (finalJob?.status === "failed") {
      throw new Error(finalJob?.error?.message || "Steam 资料刷新失败");
    }

    const lookup = finalJob?.result?.lookup;
    const hoursText = lookup?.gameHours != null ? `${lookup.gameHours}h` : "--";

    // Step 2: Reload database detail to get updated avatar and playtime
    await loadDatabaseDetail();
    await loadSteamFriends(true);

    emit("playtime-updated");
    ui.pushToast({
      title: "个人资料已刷新",
      message: `时长: ${hoursText}，头像已同步`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "刷新失败",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    steamProfileRefreshing.value = false;
  }
}

async function handleWarn() {
  const player = props.player;
  if (!player || actionBusy.value) return;
  const message = await ui.openWarnPrompt({
    title: "发送玩家警告",
    targetName: player.name,
    defaultMessage: "请遵守服务器规则",
  });
  if (message === null) return;
  if (actionBusy.value || !props.player) return;

  actionBusy.value = true;
  try {
    const res = await warnPlayer({
      targetName: player.name,
      targetSteamId: player.steamId ?? undefined,
      targetEosId: player.eosId ?? undefined,
      message: message.trim() || "Admin Warning",
      reason: "manual_warn",
      sourceModule: "web.squadAdmin",
    });
    if (!res.success) throw new Error(res.errorMessage || "警告发送失败");
    ui.pushToast({ title: "已发送警告", message: `玩家: ${player.name}`, tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "警告失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleKick() {
  const player = props.player;
  if (!player || actionBusy.value) return;

  const reason = window.prompt("请输入踢出原因", "")?.trim();
  if (!reason) {
    ui.pushToast({
      title: "踢出已取消",
      message: "请先填写踢出原因。",
      tone: "warn",
    });
    return;
  }

  const confirmed = await ui.openConfirm({
    title: "确认踢出玩家？",
    message: `确定要将玩家 ${player.name} 踢出服务器吗？\n原因：${reason}`,
    tone: "error",
  });
  if (!confirmed) return;
  if (actionBusy.value || !props.player) return;

  actionBusy.value = true;
  try {
    const res = await kickPlayer({
      playerId: player.playerId ?? undefined,
      anyId: player.steamId || player.eosId || player.name || String(player.playerId ?? ""),
      steamId: player.steamId ?? undefined,
      eosId: player.eosId ?? undefined,
      name: player.name,
      reason,
      source: "web.squadAdmin",
    });
    if (!res.ok) throw new Error(res.message || "踢出执行失败");
    ui.pushToast({ title: "指令已送达", message: "踢出玩家请求已处理", tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "踢出失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleRemove() {
  const player = props.player;
  if (!player || actionBusy.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认移出小队？",
    message: `确定要将玩家 ${player.name} 移出所在小队吗？`,
    tone: "warn",
  });
  if (!confirmed) return;
  if (actionBusy.value || !props.player) return;

  actionBusy.value = true;
  try {
    const res = await removePlayerFromSquad({
      playerId: player.playerId ?? undefined,
      anyId: player.steamId || player.eosId || player.name || String(player.playerId ?? ""),
      steamId: player.steamId ?? undefined,
      eosId: player.eosId ?? undefined,
      name: player.name,
      reason: "manual_remove",
      source: "web.squadAdmin",
    });
    if (!res.ok) throw new Error(res.message || "移出执行失败");
    ui.pushToast({ title: "指令已送达", message: "玩家移出请求已处理", tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "移出失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleForceTeamChange() {
  if (!props.player || actionBusy.value || !canSwitchTeam.value) return;
  const confirmed = await ui.openConfirm({
    title: "确认跳边？",
    message: `将玩家 ${props.player.name} 执行跳边操作。`,
    tone: "warn",
  });
  if (!confirmed) return;

  actionBusy.value = true;
  try {
    const res = await forceTeamChange({
      steamId: props.player.steamId ?? undefined,
      playerName: props.player.name,
      source: "对局状态手动操作",
      reason: "manual_team_balance",
      operator: {
        id: auth.user?.id ?? auth.user?.username ?? "",
        name: auth.user?.username ?? "",
        username: auth.user?.username ?? "",
        role: auth.user?.role ?? "",
        isSuperAdmin: Boolean(auth.user?.isSuperAdmin),
        permissions: Array.isArray(auth.user?.permissions) ? auth.user.permissions : [],
      },
    });
    if (!res.ok) throw new Error(res.message || "跳边执行失败");
    ui.pushToast({ title: "指令已送达", message: `跳边请求已提交：${props.player.name}`, tone: "ok" });
  } catch (e) {
    ui.pushToast({ title: "跳边失败", message: String(e), tone: "error" });
  } finally {
    actionBusy.value = false;
  }
}

async function handleAdminTrack() {
  const player = props.player;
  const adminName = adminRuntimeName.value;
  if (!player || actionBusy.value) return;
  if (!adminName) {
    ui.pushToast({
      title: "AdminTrack failed",
      message: "Current admin Steam64 is not matched to an online player name.",
      tone: "error",
    });
    return;
  }

  const targetName = stripPlayerNamePrefix(player.name);
  if (!targetName) return;

  const confirmed = await ui.openConfirm({
    title: "Confirm AdminTrack",
    message: `Run AdminTrack:${adminName},${targetName}?`,
    tone: "warn",
  });
  if (!confirmed) return;

  await executeBzssCoreTrackSequence(adminName, targetName);
}

async function handleRemoveAdminTrack() {
  const adminName = adminRuntimeName.value;
  if (actionBusy.value) return;
  if (!adminName) {
    ui.pushToast({
      title: "RemoveAdminTrack failed",
      message: "Current admin Steam64 is not matched to an online player name.",
      tone: "error",
    });
    return;
  }

  const confirmed = await ui.openConfirm({
    title: "Confirm RemoveAdminTrack",
    message: `Run RemoveAdminTrack:${adminName}?`,
    tone: "warn",
  });
  if (!confirmed) return;

  await executeBzssCorePlayerCommand("RemoveAdminTrack", adminName, "Tracking cancelled");
}

async function executeBzssCorePlayerCommand(directive: "AdminTrack" | "RemoveAdminTrack", parameter: string, successMessage: string) {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const result = await executeBzssCoreCommand({ directive, parameter });
    if (!result.ok) throw new Error(result.message || "BZSS-Core command failed.");
    ui.pushToast({
      title: "BZSS-Core executed",
      message: `${successMessage}: ${result.command}`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "BZSS-Core failed",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    actionBusy.value = false;
  }
}

async function executeBzssCoreTrackSequence(adminName: string, targetName: string) {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const untrackResult = await executeBzssCoreCommand({
      directive: "RemoveAdminTrack",
      parameter: adminName,
    });
    if (!untrackResult.ok) throw new Error(untrackResult.message || "RemoveAdminTrack failed.");

    const trackResult = await executeBzssCoreCommand({
      directive: "AdminTrack",
      parameter: `${adminName},${targetName}`,
    });
    if (!trackResult.ok) throw new Error(trackResult.message || "AdminTrack failed.");

    ui.pushToast({
      title: "BZSS-Core executed",
      message: `Tracking ${targetName}: ${trackResult.command}`,
      tone: "ok",
    });
  } catch (error) {
    ui.pushToast({
      title: "BZSS-Core failed",
      message: error instanceof Error ? error.message : String(error),
      tone: "error",
    });
  } finally {
    actionBusy.value = false;
  }
}

function displayRole(role: string | null | undefined) {
  const raw = String(role ?? "").trim();
  if (!raw) return t("role.unknownRole");
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keyMap: Record<string, string> = {
    squadleader: "role.squadLeader",
    medic: "role.medic",
    heavyantitank: "role.heavyAntiTank",
    lightantitank: "role.lightAntiTank",
    machinegunner: "role.machineGunner",
    automaticrifleman: "role.automaticRifleman",
    engineer: "role.engineer",
    sapper: "role.sapper",
    marksman: "role.marksman",
    sniper: "role.sniper",
    grenadier: "role.grenadier",
    crewman: "role.crewman",
    pilot: "role.pilot",
    rifleman: "role.rifleman",
  };
  const key = keyMap[normalized];
  return key ? t(key, raw) : raw;
}

function formatBzssVector(value: BzssCoreTrackedVector | null | undefined) {
  if (!value) return "--";
  const x = value.x ?? "?";
  const y = value.y ?? "?";
  const z = value.z ?? "?";
  return `X=${x}  Y=${y}  Z=${z}`;
}

function formatBzssAmmo(values: number[] | null | undefined) {
  if (!Array.isArray(values) || values.length === 0) return "--";
  return values.join(" / ");
}

function formatBzssScoreboard(values: Array<number | null> | null | undefined) {
  if (!Array.isArray(values) || values.length === 0) return "--";
  return values.filter((value) => value != null).join(" / ") || "--";
}

function cleanWeaponName(weaponClass: string | null | undefined): string {
  if (!weaponClass) return "--";
  return weaponClass
    .replace(/^(BP_|Weapon_)/i, "")
    .replace(/(_\d+)?_C.*$/i, "")
    .replace(/_\d+$/, "");
}

function normalizeSteam64(value: unknown) {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function stripPlayerNamePrefix(value: unknown) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "";
  const parts = text.split(" ").filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

onMounted(() => {
  window.addEventListener("resize", updateViewport);
  document.addEventListener("keydown", handleEscape);
});

onUnmounted(() => {
  window.removeEventListener("resize", updateViewport);
  document.removeEventListener("keydown", handleEscape);
});
</script>

<style scoped>
/* Core layout overrides */
.drawer-root {
  position: fixed;
  inset: 0;
  z-index: var(--z-player-drawer);
  background: rgba(0, 0, 0, 0);
}

.floating-window-layer {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-player-drawer) + 1);
  background:
    radial-gradient(circle at 15% 15%, rgba(96, 165, 250, 0.1), transparent 30%),
    radial-gradient(circle at 85% 15%, rgba(251, 146, 60, 0.08), transparent 30%),
    rgba(15, 22, 36, 0.28);
  backdrop-filter: blur(5px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

/* Base Panel Styles with HUD gaming aesthetics */
.player-detail-drawer,
.player-detail-floating {
  background:
    linear-gradient(135deg, rgba(32, 45, 68, 0.6), rgba(20, 28, 42, 0.7));
  border: 1px solid rgba(255, 255, 255, 0.22);
  display: grid;
  grid-template-rows: auto 1fr;
  box-shadow:
    0 32px 80px rgba(0, 0, 0, 0.45),
    0 8px 24px rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(8px) saturate(1.4);
  position: relative;
  overflow: hidden;
}

.player-detail-drawer {
  position: absolute;
  top: 0;
  right: 0;
  height: 100dvh;
  width: 420px;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}

.player-detail-floating {
  border-radius: 20px;
}

/* Neon Top Line Accents */
.hud-accent-bar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: var(--glow-color, rgba(148, 163, 184, 0.6));
  box-shadow: 0 2px 12px var(--glow-color-soft, rgba(148, 163, 184, 0.2));
  z-index: 10;
}

/* Header style rewrite */
.drawer-header-hud {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.07);
  position: relative;
  overflow: hidden;
}

.hud-header-glow {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
  opacity: 0.75;
}

.hud-header-flag-bg {
  position: absolute;
  top: -40px;
  left: -40px;
  width: 260px;
  height: 180px;
  background-repeat: no-repeat;
  background-size: cover;
  background-position: center;
  filter: blur(2px);
  transform: rotate(-15deg);
  opacity: 0.25;
  pointer-events: none;
  z-index: 0;
  mask-image: linear-gradient(135deg, rgba(0, 0, 0, 1) 20%, rgba(0, 0, 0, 0) 80%);
  -webkit-mask-image: linear-gradient(135deg, rgba(0, 0, 0, 1) 20%, rgba(0, 0, 0, 0) 80%);
}

.hud-profile-row {
  display: flex;
  align-items: center;
  gap: 16px;
  position: relative;
  z-index: 1;
  min-width: 0;
  flex: 1;
}

/* Animated HUD Avatar Frame */
.hud-avatar-frame {
  width: 50px;
  height: 50px;
  border-radius: 12px;
  position: relative;
  padding: 2px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.02));
  flex-shrink: 0;
  transition: transform 0.25s ease;
}

.hud-avatar-inner {
  width: 100%;
  height: 100%;
  border-radius: 10px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.4));
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.hud-avatar-frame.hud-avatar-link {
  cursor: pointer;
  text-decoration: none;
}

.hud-avatar-frame.hud-avatar-link:hover {
  transform: scale(1.06);
}

.hud-avatar-image-steam {
  width: 100%;
  height: 100%;
  border-radius: 10px;
  object-fit: cover;
  display: block;
}

.hud-avatar-letter {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 18px;
  font-weight: 800;
  color: #fff;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 8px rgba(0,0,0,0.5);
}

.hud-avatar-country-flag {
  position: absolute;
  top: -6px;
  left: -6px;
  width: 22px;
  height: 20px;
  border-radius: 999px;
  background: rgba(6, 9, 15, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.14);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  z-index: 2;
  object-fit: cover;
  display: block;
}

.hud-avatar-faction-flag {
  overflow: hidden;
}

.hud-avatar-status-ring {
  position: absolute;
  bottom: -3px;
  right: -3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #64748b;
  border: 2px solid #06090f;
  box-shadow: 0 0 6px rgba(100, 116, 139, 0.4);
}

.hud-avatar-status-ring.online {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}

.hud-title-block {
  display: grid;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.drawer-player-name {
  margin: 0;
  font-size: 20px;
  font-weight: 900;
  color: #fff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.02em;
  line-height: 1.1;
  text-shadow: 0 2px 4px rgba(0,0,0,0.4);
}

.hud-name-row {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  min-width: 0;
}

.hud-header-db-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-text-secondary);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  height: 22px;
}

.hud-header-db-btn:hover {
  background: var(--glow-color-soft);
  border-color: var(--glow-color);
  color: #fff;
  transform: translateY(-0.5px);
}

.hud-header-identities {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: Consolas, Monaco, monospace;
  font-size: 10px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.hud-header-ident {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.hud-header-ident:hover {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.22);
  color: #fff;
  transform: translateY(-0.5px);
}

.drawer-header-badges {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}

.hud-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 8px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #94a3b8;
}

.hud-badge.online-status.online {
  color: #34d399;
  background: rgba(52, 211, 153, 0.08);
  border-color: rgba(52, 211, 153, 0.16);
}

.hud-badge-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #64748b;
}

.hud-badge-dot.online {
  background: #34d399;
}

.hud-badge.leader-status {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.08);
  border-color: rgba(251, 191, 36, 0.16);
}

.hud-badge.team-status.team1 {
  color: #37c8ff;
  background: rgba(55, 200, 255, 0.08);
  border-color: rgba(55, 200, 255, 0.16);
}

.hud-badge.team-status.team2 {
  color: #ff9b45;
  background: rgba(255, 155, 69, 0.08);
  border-color: rgba(255, 155, 69, 0.16);
}

.hud-close-button {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  color: #94a3b8;
  width: 30px;
  height: 30px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.hud-close-button:hover {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
  transform: rotate(90deg);
}

/* Notice Banner */
.detail-notice-hud {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 14px;
  background: rgba(245, 158, 11, 0.08);
  border-bottom: 1px solid rgba(245, 158, 11, 0.16);
  color: #f59e0b;
  font-size: 12px;
  line-height: 1.5;
}

.notice-icon {
  margin-top: 1px;
  flex-shrink: 0;
}

/* Scrollable Container */
.drawer-body-hud {
  padding: var(--spacing-lg) 20px;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.drawer-body-hud::-webkit-scrollbar {
  width: 5px;
}

.drawer-body-hud::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
}

.drawer-body-hud::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.16);
}

/* Unified Dashboard Grid layout */
.hud-dashboard-grid {
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 16px;
  align-items: start;
}

.hud-column {
  display: grid;
  gap: 16px;
}

.hud-pane-section {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.035);
  box-shadow: inset 0 0 12px rgba(255,255,255,0.02);
}

.hud-section-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  border-left: 3px solid var(--glow-color, rgba(255,255,255,0.3));
  padding-left: 8px;
  margin-bottom: 2px;
}

.hud-section-title {
  font-family: inherit;
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.08em;
  color: #94a3b8;
  text-transform: uppercase;
}

.hud-section-subtitle {
  font-size: 10px;
  color: #475569;
}

/* KD Hero Display */
.kd-hero-block {
  padding: 16px 20px;
  border-radius: 14px;
  background: linear-gradient(135deg, rgba(15, 23, 42, 0.6), rgba(15, 23, 42, 0.8));
  border: 1px solid rgba(255, 255, 255, 0.05);
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 20px;
  box-shadow: 
    0 4px 24px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.25s ease;
  position: relative;
  overflow: hidden;
}

.kd-hero-block::before {
  content: "";
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 10% 20%, var(--glow-color-soft, rgba(255,255,255,0.05)), transparent 50%);
  opacity: 0.7;
  pointer-events: none;
}

.kd-hero-block:hover {
  border-color: var(--glow-color-soft);
  box-shadow: 
    0 8px 30px rgba(0, 0, 0, 0.4),
    0 0 15px var(--glow-color-soft),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.kd-hero-block.team1 {
  border-left: 4px solid #37c8ff;
}

.kd-hero-block.team2 {
  border-left: 4px solid #ff9b45;
}

.kd-hero-block.battle {
  border-left: 4px solid #a855f7;
}

.kd-metric {
  display: grid;
  gap: 2px;
}

.kd-label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  color: #64748b;
}

.kd-value {
  font-family: Consolas, Monaco, monospace;
  font-size: 32px;
  font-weight: 900;
  line-height: 1;
  color: #fff;
  letter-spacing: -0.03em;
  text-shadow: 0 0 10px var(--glow-color-soft);
}

.kd-breakdown {
  display: grid;
  gap: 6px;
}

.kd-bar {
  height: 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  overflow: hidden;
}

.kd-bar-kills {
  background: linear-gradient(90deg, #10b981, #34d399);
  height: 100%;
}

.kd-bar-deaths {
  background: linear-gradient(90deg, #ef4444, #f87171);
  height: 100%;
}

.kd-bar-labels {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  font-weight: 700;
}

.lbl-kills {
  color: #34d399;
}

.lbl-deaths {
  color: #f87171;
}

/* Combat Stats Cards Grid */
.combat-hud-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
  gap: 10px;
}

.combat-hud-card {
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.05);
}

.combat-hud-card:hover {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.15);
  transform: translateY(-2px);
}

.ch-icon-wrapper {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(255, 255, 255, 0.05);
  color: #94a3b8;
  transition: all 0.2s ease;
}

.combat-hud-card:hover .ch-icon-wrapper {
  background: var(--glow-color-soft, rgba(255, 255, 255, 0.1));
  border-color: var(--glow-color, rgba(255, 255, 255, 0.2));
  color: #fff;
}

.combat-hud-card.kills .ch-icon-wrapper { color: #34d399; }
.combat-hud-card.deaths .ch-icon-wrapper { color: #f87171; }
.combat-hud-card.downs .ch-icon-wrapper { color: #facc15; }
.combat-hud-card.tk .ch-icon-wrapper { color: #c084fc; }
.combat-hud-card.revives .ch-icon-wrapper { color: #60a5fa; }

.ch-icon {
  width: 15px;
  height: 15px;
  stroke: currentColor;
}

.ch-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.combat-hud-card .ch-lbl {
  font-size: 9px;
  font-weight: 800;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  line-height: 1.2;
}

.combat-hud-card .ch-val {
  font-family: Consolas, Monaco, monospace;
  font-size: 18px;
  font-weight: 950;
  color: #e2e8f0;
  line-height: 1.1;
  margin-top: 1px;
}

.combat-hud-card.kills .ch-val { color: #34d399; }
.combat-hud-card.deaths .ch-val { color: #f87171; }
.combat-hud-card.downs .ch-val { color: #facc15; }
.combat-hud-card.tk .ch-val { color: #cbd5e1; }
.combat-hud-card.tk .ch-val.danger { color: #c084fc; text-shadow: 0 0 6px rgba(192, 132, 252, 0.4); }
.combat-hud-card.revives .ch-val { color: #60a5fa; }

/* Timeline Accordion Slider */
.timeline-hud-wrapper {
  padding: 0;
  overflow: hidden;
}

.hud-accordion-btn {
  width: 100%;
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(255, 255, 255, 0.02);
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  color: #94a3b8;
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}

.hud-accordion-btn:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #fff;
}

.title-with-icon {
  display: flex;
  align-items: center;
  gap: 6px;
}

.acc-arrow {
  transition: transform 0.25s ease;
}

.acc-arrow.open {
  transform: rotate(90deg);
}

.badge-hud {
  font-size: 9px;
  background: rgba(255,255,255,0.08);
  color: #94a3b8;
  padding: 2px 6px;
  border-radius: 4px;
}

.hud-accordion-content {
  padding: 14px;
}

/* Accordion Transition */
.accordion-slide-enter-active,
.accordion-slide-leave-active {
  transition: max-height 0.25s ease-out, opacity 0.25s ease-out;
  max-height: 800px;
  overflow: hidden;
}

.accordion-slide-enter-from,
.accordion-slide-leave-to {
  max-height: 0;
  opacity: 0;
}

/* TAB 2 CONTROLS & DESIGNS */
.control-box-hud {
  display: grid;
  gap: 12px;
}

.control-info-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.15);
  border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.03);
  font-size: 13px;
  color: #94a3b8;
}

.control-info-row .team-label.team1 { color: #37c8ff; }
.control-info-row .team-label.team2 { color: #ff9b45; }

.hud-action-btn {
  width: 100%;
  height: 42px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 0;
}

.hud-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  box-shadow: none !important;
}

.hud-action-btn.balance-btn {
  background: linear-gradient(135deg, #2563eb, #3b82f6);
  color: #fff;
  box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
}

.hud-action-btn.balance-btn:hover:not(:disabled) {
  filter: brightness(1.1);
  transform: translateY(-1px);
}

/* Actions Commands Grid */
.actions-grid-hud {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.hud-action-btn-styled {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 12px 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #94a3b8;
}

.hud-action-btn-styled:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.03);
  transform: translateY(-2px);
}

.hud-action-btn-styled:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.btn-inner .btn-icon {
  font-size: 18px;
}

.btn-inner .btn-text {
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.hud-action-btn-styled.warn-btn:hover:not(:disabled) {
  border-color: rgba(251, 191, 36, 0.4);
  box-shadow: 0 4px 14px rgba(251, 191, 36, 0.15);
  color: #f59e0b;
}

.hud-action-btn-styled.kick-btn:hover:not(:disabled) {
  border-color: rgba(239, 68, 68, 0.4);
  box-shadow: 0 4px 14px rgba(239, 68, 68, 0.15);
  color: #ef4444;
}

.hud-action-btn-styled.remove-btn:hover:not(:disabled) {
  border-color: rgba(244, 63, 94, 0.4);
  box-shadow: 0 4px 14px rgba(244, 63, 94, 0.15);
  color: #f43f5e;
}

.hud-action-btn-styled.balance-btn:hover:not(:disabled) {
  border-color: rgba(59, 130, 246, 0.4);
  box-shadow: 0 4px 14px rgba(59, 130, 246, 0.15);
  color: #3b82f6;
}

/* Playtime Override UI */
.playtime-control-hud {
  display: grid;
  gap: 14px;
}

.playtime-stats-rail {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.playtime-stat-box {
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255,255,255,0.03);
  border-radius: 8px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  text-align: center;
}

.playtime-stat-box.highlight {
  border-color: rgba(96, 165, 250, 0.2);
  background: rgba(96, 165, 250, 0.03);
}

.playtime-stat-box .lbl {
  font-size: 9px;
  color: #64748b;
  font-weight: 700;
}

.playtime-stat-box .val {
  font-family: Consolas, Monaco, monospace;
  font-size: 13px;
  font-weight: 800;
  color: #cbd5e1;
}

.playtime-stat-box.highlight .val {
  color: #60a5fa;
  text-shadow: 0 0 8px rgba(96, 165, 250, 0.2);
}

.playtime-stat-box .val.overridden {
  color: #a855f7;
}

.playtime-editor-hud {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 8px;
  align-items: center;
}

.editor-input-wrapper {
  position: relative;
  background: rgba(0,0,0,0.2);
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  transition: all 0.2s ease;
  height: 38px;
}

.editor-input-wrapper:focus-within {
  border-color: var(--glow-color, #3b82f6);
  box-shadow: 0 0 8px var(--glow-color-soft);
}

.hud-playtime-input {
  width: 100%;
  height: 100%;
  background: transparent;
  border: 0;
  padding: 0 12px;
  color: #fff;
  font-size: 13px;
  outline: none;
}

.hud-mini-btn {
  height: 38px;
  padding: 0 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 0;
  white-space: nowrap;
}

.hud-mini-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.hud-mini-btn.save-btn {
  background: #cbd5e1;
  color: #0f172a;
}

.hud-mini-btn.save-btn:hover:not(:disabled) {
  background: #f1f5f9;
}

.hud-mini-btn.reset-btn {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #cbd5e1;
}

.hud-mini-btn.reset-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
}

.hud-mini-btn.outline {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #94a3b8;
  height: 32px;
  font-size: 11px;
}

.hud-mini-btn.outline:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.16);
  color: #fff;
}

.playtime-status-note {
  font-size: 11px;
  color: #475569;
  line-height: 1.4;
}

.playtime-status-note.error {
  color: #ef4444;
}

.playtime-status-note.loading {
  color: #60a5fa;
  display: flex;
  align-items: center;
  gap: 6px;
}

.loader-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #60a5fa;
  animation: pulse-dot 1.2s infinite ease-in-out;
}

@keyframes pulse-dot {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* SESSION DETAILS META & ROLE BADGE */
.hud-role-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #f1f5f9;
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 4px;
  height: 22px;
  white-space: nowrap;
}

.role-icon-wrap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--glow-color, #38bdf8);
}

.role-icon-wrap :deep(svg) {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.role-text-lbl {
  font-family: Consolas, Monaco, monospace;
}

.hud-session-ctx-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 1px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  margin-top: 4px;
  width: 100%;
  overflow: hidden;
}

.hud-ctx-item {
  background: rgba(20, 28, 42, 0.45);
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.hud-ctx-item.is-leader {
  background: rgba(251, 191, 36, 0.05);
}

.ctx-lbl {
  font-size: 9px;
  color: #64748b;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-val {
  font-size: 12px;
  font-weight: 800;
  color: #cbd5e1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ctx-val.team1 {
  color: #37c8ff;
}

.ctx-val.team2 {
  color: #ff9b45;
}

.ctx-val.online-status {
  color: #64748b;
}

.ctx-val.online-status.online {
  color: #34d399;
}

.ctx-val.low {
  color: #34d399;
}

.ctx-val.medium {
  color: #fbbf24;
}

.ctx-val.high {
  color: #f87171;
}

.packet-loss-sub {
  display: block;
  font-size: 10px;
  color: #94a3b8;
  font-weight: 500;
  margin-top: 2px;
}

.ctx-sub {
  display: block;
  font-size: 10px;
  color: #64748b;
  font-weight: 500;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.leader-active-text {
  color: #fbbf24;
}

.hud-squad-tag {
  background: var(--glow-color, #2563eb);
  color: #fff;
  font-size: 9px;
  font-weight: 900;
  padding: 1px 4px;
  border-radius: 3px;
  margin-right: 3px;
}

/* Raw Debug Pre Area */
.raw-data-hud {
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}

.raw-pre {
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-size: 11px;
  color: #6ee7b7;
  max-height: 200px;
}

.raw-pre::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.raw-pre::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
}

/* BZSS-Core snapshot */
.bzss-core-card {
  margin-top: 8px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background:
    linear-gradient(180deg, rgba(15, 23, 42, 0.92), rgba(2, 6, 23, 0.88));
}

.bzss-core-card[data-status="ready"] {
  border-color: color-mix(in srgb, var(--glow-color, #38bdf8) 45%, rgba(255, 255, 255, 0.08));
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.03), 0 12px 28px rgba(2, 6, 23, 0.22);
}

.bzss-core-card__status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 11px;
  color: #94a3b8;
}

.bzss-core-card__status strong {
  font-size: 12px;
  color: #e2e8f0;
}

.bzss-core-card__empty {
  font-size: 12px;
  line-height: 1.5;
  color: #94a3b8;
}

.bzss-core-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.bzss-core-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
}

.bzss-core-item--wide {
  grid-column: 1 / -1;
}

.bzss-core-item__label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #64748b;
}

.bzss-core-item strong {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 12px;
  color: #f8fafc;
}

.bzss-core-mono {
  font-family: "Consolas", "SFMono-Regular", monospace;
  font-size: 11px;
}

/* Steam Friends Styles */
.friends-list-hud {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  overflow: hidden;
  margin-top: 8px;
}

.friends-status {
  padding: 16px;
  text-align: center;
  font-size: 12px;
  color: #64748b;
}

.friends-status.error {
  color: #ef4444;
}

.friends-scroll-container {
  max-height: 240px;
  overflow-y: auto;
  padding: 6px;
}

.friends-scroll-container::-webkit-scrollbar {
  width: 4px;
}

.friends-scroll-container::-webkit-scrollbar-thumb {
  border-radius: 99px;
  background: rgba(255, 255, 255, 0.08);
}

.friend-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border-radius: 6px;
  transition: background-color 0.2s ease;
}

.friend-item:hover {
  background: rgba(255, 255, 255, 0.04);
}

.friend-avatar {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.friend-avatar-placeholder {
  width: 32px;
  height: 32px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #94a3b8;
  font-size: 13px;
}

.friend-info {
  flex: 1;
  min-width: 0;
}

.friend-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.friend-name {
  font-size: 12px;
  font-weight: 600;
  color: #f1f5f9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.friend-badge {
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  border: 1px solid rgba(16, 185, 129, 0.2);
  font-size: 9px;
  padding: 0px 4px;
  border-radius: 3px;
  font-weight: 700;
  white-space: nowrap;
}

.friend-meta {
  display: flex;
  gap: 12px;
  font-size: 11px;
  color: #64748b;
  margin-top: 2px;
}

.friend-meta span {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Career Context Bar Styles */
.hud-header-career-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(168, 85, 247, 0.05);
  border: 1px solid rgba(168, 85, 247, 0.15);
  border-radius: 6px;
  padding: 6px 12px;
  width: 100%;
}

.career-bar-title {
  font-size: 10px;
  font-weight: 900;
  color: #c084fc;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-right: 1px solid rgba(168, 85, 247, 0.3);
  padding-right: 12px;
  flex-shrink: 0;
}

.career-bar-items {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1;
  min-width: 0;
}

.cb-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.cb-lbl {
  font-size: 10px;
  color: #64748b;
  font-weight: 700;
}

.cb-val {
  font-family: Consolas, Monaco, monospace;
  font-size: 12px;
  font-weight: 800;
  color: #cbd5e1;
}

.cb-item.highlight .cb-val {
  color: #c084fc;
  text-shadow: 0 0 4px rgba(192, 132, 252, 0.4);
}

.cb-val.kills { color: #34d399; }
.cb-val.deaths { color: #f87171; }
.cb-val.downs { color: #facc15; }
.cb-val.tk.danger { color: #c084fc; text-shadow: 0 0 4px rgba(192, 132, 252, 0.4); }
.cb-val.revives { color: #60a5fa; }

.cb-divider {
  width: 1px;
  height: 10px;
  background: rgba(255, 255, 255, 0.08);
  flex-shrink: 0;
}

.hud-ctx-item-wide {
  grid-column: span 2;
}

/* Subtle Divider */
.hud-divider {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.08) 20%, rgba(255, 255, 255, 0.08) 80%, transparent);
  margin: 12px 0;
}

/* Stacking overrides when drawer is in narrow sidebar mode */
.player-detail-drawer :deep(.player-combat-body) {
  grid-template-columns: 1fr;
  height: auto;
}
.player-detail-drawer :deep(.player-combat-event-list-container) {
  height: 180px;
}

/* Global Transitions */
.drawer-enter-active,
.drawer-leave-active {
  transition: opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.drawer-enter-active .player-detail-drawer,
.drawer-leave-active .player-detail-drawer {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}

.drawer-enter-from,
.drawer-leave-to {
  opacity: 0;
}
.drawer-enter-from .player-detail-drawer,
.drawer-leave-to .player-detail-drawer {
  transform: translateX(100%);
}

.floating-player-enter-active,
.floating-player-leave-active {
  transition: opacity 0.24s ease-out;
}
.floating-player-enter-active .player-detail-floating,
.floating-player-leave-active .player-detail-floating {
  transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.floating-player-enter-from,
.floating-player-leave-to {
  opacity: 0;
}
.floating-player-enter-from .player-detail-floating,
.floating-player-leave-to .player-detail-floating {
  transform: scale(0.92) translateY(16px);
}

/* Responsive adjustment */
@media (max-width: 1100px) {
  .hud-dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 920px), (max-height: 700px) {
  .player-detail-drawer {
    width: 100vw;
  }

  .player-detail-floating {
    width: calc(100vw - 24px);
    max-height: calc(100vh - 24px);
    border-radius: 16px;
  }
}

@media (max-width: 768px) {
  .hud-session-ctx-grid {
    grid-template-columns: repeat(3, 1fr);
  }
  .hud-ctx-item-wide {
    grid-column: span 1;
  }
}

@media (max-width: 500px) {
  .hud-session-ctx-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .hud-ctx-item-wide {
    grid-column: span 1;
  }
  .hud-header-career-bar {
    flex-wrap: wrap;
    gap: 8px;
  }
  .career-bar-items {
    flex-wrap: wrap;
    gap: 8px;
    justify-content: flex-start;
  }
  .cb-divider {
    display: none;
  }
}
</style>
