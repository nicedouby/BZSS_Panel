<template>
  <section class="tracking-page">
    <h1 class="sr-only">建队规则链</h1>

    <WorkspaceToolbar sticky>
      <div class="toolbar-main">
        <span class="page-title">建队规则链</span>
        <span class="pill" :data-tone="guardState?.enabled ? 'ok' : 'danger'">队名规范 {{ guardState?.enabled ? "运行" : "关闭" }}</span>
        <span class="pill" :data-tone="stepwiseState?.enabled ? 'ok' : 'danger'">阶梯建队 {{ stepwiseState?.enabled ? "运行" : "关闭" }}</span>
        <span class="pill" :data-tone="fairState?.enabled ? 'ok' : 'danger'">公平建队 {{ fairState?.enabled ? "运行" : "关闭" }}</span>
        <span class="pill" :data-tone="patrolState?.enabled ? 'warning' : 'muted'">巡逻 {{ patrolState?.enabled ? "开启" : "关闭" }}</span>
      </div>

      <template #actions>
        <router-link to="/debug/squad-name-policy/rules" class="btn ghost">队名规范维护</router-link>
        <button type="button" class="btn ghost" :disabled="loading" @click="refreshNow">
          {{ loading ? "刷新中..." : "刷新" }}
        </button>
        <button type="button" :class="['btn', autoRefresh ? 'primary' : 'ghost']" @click="toggleAutoRefresh">
          {{ autoRefresh ? "自动刷新中" : "开启自动刷新" }}
        </button>
        <button
          v-if="!isOverviewPage"
          type="button"
          :class="['btn', showSettings ? 'primary' : 'ghost']"
          @click="toggleSettings"
        >
          ⚙️ {{ currentSubPageTitle }}配置
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>

    <nav class="flow-tabs" aria-label="建队规则链页面">
      <router-link
        v-for="tab in flowTabs"
        :key="tab.path"
        :to="tab.path"
        class="flow-tab"
        :class="{ active: pageMode === tab.mode }"
      >
        <strong>{{ tab.title }}</strong>
        <span>{{ tab.caption }}</span>
      </router-link>
    </nav>

    <!-- ======= OVERVIEW PAGE ======= -->
    <template v-if="isOverviewPage">

      <!-- Primary hero row -->
      <section class="overview-hero">
        <article class="health-panel" :data-tone="healthTone">
          <span>链路状态</span>
          <strong>{{ healthLabel }}</strong>
          <em>{{ enabledFlowCount }} / 3 个流程运行中，当前风险 {{ riskTotal }} 条</em>
        </article>
        <article class="hero-metric">
          <span>建队判定</span>
          <strong>{{ buildDecisionRecords.length }}</strong>
          <em>最新链路流水总量</em>
        </article>
        <article class="hero-metric">
          <span>通过率</span>
          <strong>{{ passRateText }}</strong>
          <em>{{ allowedDecisionCount }} 条最终通过</em>
        </article>
        <article class="hero-metric danger">
          <span>违规判定</span>
          <strong>{{ violationDecisionCount }}</strong>
          <em>需要关注的拒绝结果</em>
        </article>
        <article class="hero-metric warning">
          <span>处置动作</span>
          <strong>{{ disbandedCount + warnedCount }}</strong>
          <em>解散 {{ disbandedCount }} / 警告 {{ warnedCount }}</em>
        </article>
      </section>

      <!-- Secondary stats row -->
      <section class="overview-secondary-band">
        <article class="sec-metric">
          <div class="sec-metric-header">
            <span>当前在场小队</span>
            <strong>{{ orderedLifecycle.length }}</strong>
          </div>
          <div class="sec-metric-row">
            <span class="sec-tag infantry">步兵 {{ lifecycleComposition.infantry }}</span>
            <span class="sec-tag vehicle">载具 {{ lifecycleComposition.vehicle }}</span>
            <span class="sec-tag support">支援 {{ lifecycleComposition.support }}</span>
            <span v-if="lifecycleComposition.other > 0" class="sec-tag">其他 {{ lifecycleComposition.other }}</span>
          </div>
        </article>

        <article class="sec-metric">
          <div class="sec-metric-header">
            <span>跳过判定</span>
            <strong>{{ skippedDecisionCount }}</strong>
          </div>
          <div class="sec-metric-row">
            <span>巡逻命中 {{ patrolViolationCount }}</span>
            <span>在场疑似 {{ activeViolations.length }}</span>
          </div>
        </article>

        <article class="sec-metric" :class="{ 'has-danger': squadNameFlowStats.violations > 0 }">
          <div class="sec-metric-header">
            <span>队名规范</span>
            <strong>{{ squadNameFlowStats.total }}</strong>
          </div>
          <div class="sec-metric-row">
            <span class="danger-text">违规 {{ squadNameFlowStats.violations }}</span>
            <span class="pass-text">通过 {{ squadNameFlowStats.allowed }}</span>
            <span>{{ squadNameFlowStats.passRate }}</span>
          </div>
        </article>

        <article class="sec-metric" :class="{ 'has-danger': stepwiseFlowStats.violations > 0 }">
          <div class="sec-metric-header">
            <span>阶梯建队</span>
            <strong>{{ stepwiseFlowStats.total }}</strong>
          </div>
          <div class="sec-metric-row">
            <span class="danger-text">违规 {{ stepwiseFlowStats.violations }}</span>
            <span class="pass-text">通过 {{ stepwiseFlowStats.allowed }}</span>
            <span>{{ stepwiseFlowStats.passRate }}</span>
          </div>
        </article>

        <article class="sec-metric" :class="{ 'has-danger': fairFlowStats.violations > 0 }">
          <div class="sec-metric-header">
            <span>公平建队</span>
            <strong>{{ fairFlowStats.total }}</strong>
          </div>
          <div class="sec-metric-row">
            <span class="danger-text">违规 {{ fairFlowStats.violations }}</span>
            <span class="pass-text">通过 {{ fairFlowStats.allowed }}</span>
            <span>{{ fairFlowStats.passRate }}</span>
          </div>
        </article>

        <article class="sec-metric">
          <div class="sec-metric-header">
            <span>公平建队阶段</span>
            <strong class="phase-label">{{ fairPhaseLabel }}</strong>
          </div>
          <div class="sec-metric-row">
            <span>人数 {{ fairPopulationCount }}</span>
            <span>时钟 {{ fairClockLabel }}</span>
          </div>
        </article>
      </section>

      <!-- Overview grid (4 cards) -->
      <section class="overview-grid">
        <PageCard title="流程健康" description="三个流程按顺序组成最终建队判定。" compact>
          <div class="flow-stack">
            <article v-for="stage in ruleStages" :key="stage.key" class="flow-stage" :data-tone="stage.tone">
              <div class="flow-stage-index">{{ stage.index }}</div>
              <div class="flow-stage-body">
                <div class="flow-stage-head">
                  <strong>{{ stage.title }}</strong>
                  <span class="pill" :data-tone="stage.tone">{{ stage.status }}</span>
                </div>
                <p>{{ stage.description }}</p>
                <div class="flow-stage-meta">
                  <span>{{ stage.primaryMetric }}</span>
                  <span>{{ stage.secondaryMetric }}</span>
                  <span v-if="stage.tertiaryMetric" class="pass-text">{{ stage.tertiaryMetric }}</span>
                </div>
              </div>
              <router-link :to="stage.path" class="btn ghost btn-sm">进入</router-link>
            </article>
          </div>
        </PageCard>

        <PageCard title="流程对比" description="按规则来源聚合判定量和风险量。" compact>
          <div class="flow-compare">
            <article v-for="item in flowSummaries" :key="item.mode" class="compare-row">
              <div>
                <strong>{{ item.title }}</strong>
                <span>{{ item.description }}</span>
              </div>
              <div class="compare-stats-block">
                <div class="compare-stats">
                  <span>{{ item.total }} 判定</span>
                  <span class="danger-text">{{ item.violations }} 违规</span>
                  <span class="pass-text">{{ item.allowed }} 通过</span>
                </div>
                <div class="compare-rate-bar">
                  <div class="compare-rate-bar-track">
                    <div
                      class="rate-fill"
                      :style="{ width: item.passRatePct + '%' }"
                      :class="item.violations > 0 ? 'rate-warn' : 'rate-ok'"
                    />
                  </div>
                  <span class="rate-label">{{ item.passRate }}</span>
                </div>
              </div>
              <router-link :to="item.path" class="btn ghost btn-sm">查看</router-link>
            </article>
          </div>
        </PageCard>

        <PageCard title="最近风险" description="优先展示最近的违规、错误和在场疑似违规。" compact body-mode="scroll">
          <div v-if="!overviewRiskRecords.length" class="empty-state compact">暂无风险记录。</div>
          <div v-else class="record-list">
            <article v-for="item in overviewRiskRecords" :key="item.id" class="record-card danger">
              <div class="record-head">
                <div>
                  <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                  <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
                </div>
                <span class="pill" :data-tone="item.decisionTone">{{ item.sourceLabel }}</span>
              </div>
              <div class="record-meta">
                <span>队长: {{ item.creatorName || "-" }}</span>
                <span>时间: {{ formatTime(item.updatedAt || item.createdAt) }}</span>
              </div>
              <p class="reason">{{ item.reason || "未提供原因" }}</p>
            </article>
          </div>
        </PageCard>

        <PageCard title="当前在场小队" description="仅展示最终通过规则链的 RCON 快照。" compact body-mode="scroll">
          <template #actions>
            <div class="nature-summary">
              <span class="sec-tag infantry">步兵 {{ lifecycleComposition.infantry }}</span>
              <span class="sec-tag vehicle">载具 {{ lifecycleComposition.vehicle }}</span>
              <span class="sec-tag support">支援 {{ lifecycleComposition.support }}</span>
            </div>
          </template>
          <div v-if="!orderedLifecycle.length" class="empty-state compact">当前没有可展示的小队快照。</div>
          <div v-else class="squad-table">
            <article v-for="record in orderedLifecycle.slice(0, 16)" :key="record.key" class="squad-row">
              <div>
                <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
                <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }}</span>
              </div>
              <span>{{ record.creatorName || "-" }}</span>
              <span class="nature-badge" :data-nature="record.squadNature">{{ record.squadNatureLabel || record.squadNature || "-" }}</span>
              <span class="pill" :data-tone="record.creationSource === 'LOG' ? 'ok' : 'muted'">
                {{ record.sourceLabel || record.creationSource || "-" }}
              </span>
            </article>
          </div>
        </PageCard>
      </section>

    </template>

    <!-- ======= SUB-PAGES ======= -->
    <template v-else>

      <!-- Sub-page ops band -->
      <section class="ops-band">
        <article class="ops-card primary">
          <span>当前风险</span>
          <strong>{{ riskTotal }}</strong>
          <em>违规判定 + 在场疑似违规</em>
        </article>
        <article class="ops-card">
          <span>当前流程判定</span>
          <strong>{{ currentDecisionRecords.length }}</strong>
          <em>{{ currentFlowTitle }}</em>
        </article>
        <article class="ops-card">
          <span>最终通过</span>
          <strong>{{ allowedDecisionCount }}</strong>
          <em>允许保留的小队</em>
        </article>
        <article class="ops-card danger">
          <span>已处置</span>
          <strong>{{ disbandedCount }}</strong>
          <em>解散记录</em>
        </article>
        <article class="ops-card warning">
          <span>已警告</span>
          <strong>{{ warnedCount }}</strong>
          <em>广播或警告动作</em>
        </article>
        <article class="ops-card">
          <span>巡逻命中</span>
          <strong>{{ patrolViolationCount }}</strong>
          <em>仅识别，不直接处置</em>
        </article>
      </section>

      <!-- Sub-page content + settings sidebar -->
      <div class="sub-page-workspace" :class="{ 'sidebar-open': showSettings }">
        <!-- Main content grid -->
        <section class="content-grid" :data-mode="pageMode">
          <PageCard
            class="records-panel"
            :title="currentFlowTitle"
            :description="currentFlowDescription"
            compact
            body-mode="scroll"
          >
            <template #actions>
              <span class="pill" data-tone="muted">{{ currentDecisionRecords.length }} 条</span>
            </template>

            <div v-if="!currentDecisionRecords.length" class="empty-state">暂无该流程判定记录。</div>
            <div v-else class="record-list">
              <article
                v-for="item in currentDecisionRecords"
                :key="item.id"
                class="record-card"
                :class="{ danger: item.decisionTone === 'danger' }"
              >
                <div class="record-head">
                  <div>
                    <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                    <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
                  </div>
                  <span class="pill" :data-tone="item.decisionTone">{{ item.decisionLabel }}</span>
                </div>
                <div class="record-meta">
                  <span>队长: {{ item.creatorName || "-" }}</span>
                  <span>来源: {{ item.sourceLabel }}</span>
                  <span>时间: {{ formatTime(item.updatedAt || item.createdAt) }}</span>
                </div>
                <p class="reason">{{ item.reason || "未提供原因" }}</p>
                <div v-if="item.actionLabels.length" class="tag-row">
                  <span v-for="action in item.actionLabels" :key="`${item.id}-${action}`" class="tag">{{ action }}</span>
                </div>
                <div class="record-actions">
                  <button v-if="item.canWhitelist" type="button" class="btn ghost btn-sm" @click="openWhitelistDialog(item)">
                    加入白名单
                  </button>
                  <span v-if="item.squadNatureLabel" class="action-hint">当前性质: {{ item.squadNatureLabel }}</span>
                </div>
              </article>
            </div>
          </PageCard>

          <PageCard
            v-if="isSquadNamePage"
            class="risk-panel"
            title="当前疑似违规小队"
            description="只保留当前仍在 RCON 快照中的疑似违规队名，便于值班盯盘。"
            compact
            body-mode="scroll"
            tone="danger"
          >
            <div v-if="!activeViolations.length" class="empty-state">当前没有仍在场的疑似违规小队。</div>
            <div v-else class="record-list">
              <article v-for="item in activeViolations" :key="item.key" class="record-card danger">
                <div class="record-head">
                  <div>
                    <strong>{{ item.squadName || `Squad ${item.squadId ?? "?"}` }}</strong>
                    <span>T{{ item.teamId ?? "?" }} / S{{ item.squadId ?? "?" }}</span>
                  </div>
                  <span class="pill danger">{{ item.sourceLabel }}</span>
                </div>
                <div class="record-meta">
                  <span>建队: {{ item.createdAtLabel || formatTime(item.createdAt) }}</span>
                  <span>来源: {{ item.creationSourceLabel }}</span>
                  <span>队长: {{ item.creatorName || "-" }}</span>
                </div>
                <p class="reason">{{ item.reason || "未提供原因" }}</p>
                <div class="record-actions">
                  <button v-if="canWhitelistRecord(item)" type="button" class="btn ghost btn-sm" @click="openWhitelistDialog(item)">
                    加入白名单
                  </button>
                  <span v-if="item.squadNatureLabel" class="action-hint">当前性质: {{ item.squadNatureLabel }}</span>
                </div>
              </article>
            </div>
          </PageCard>

          <PageCard title="当前 RCON 小队快照" :description="currentSnapshotDescription" compact body-mode="scroll">
            <div v-if="!orderedLifecycle.length" class="empty-state">当前没有可展示的小队快照。</div>
            <div v-else class="squad-table">
              <article v-for="record in orderedLifecycle" :key="record.key" class="squad-row">
                <div>
                  <strong>{{ record.squadName || `Squad ${record.squadId ?? "?"}` }}</strong>
                  <span>T{{ record.teamId ?? "?" }} / S{{ record.squadId ?? "?" }}</span>
                </div>
                <span>{{ record.creatorName || "-" }}</span>
                <span class="nature-badge" :data-nature="record.squadNature">{{ record.squadNatureLabel || record.squadNature || "-" }}</span>
                <span class="pill" :data-tone="record.creationSource === 'LOG' ? 'ok' : 'muted'">
                  {{ record.sourceLabel || record.creationSource || "-" }}
                </span>
                <button v-if="canWhitelistRecord(record)" type="button" class="btn ghost btn-sm" @click="openWhitelistDialog(record)">
                  白名单
                </button>
              </article>
            </div>
          </PageCard>

          <PageCard
            v-if="isSquadNamePage"
            title="最近巡逻识别"
            description="巡逻系统只识别当前队名是否合规，暂不直接解散。"
            compact
            body-mode="scroll"
          >
            <div v-if="!patrolRecords.length" class="empty-state">暂无巡逻记录。</div>
            <div v-else class="record-list">
              <article v-for="record in patrolRecords" :key="record.id" class="record-card" :class="{ danger: record.violation }">
                <div class="record-head">
                  <div>
                    <strong>{{ record.event?.squadName || `Squad ${record.event?.squadId ?? "?"}` }}</strong>
                    <span>T{{ record.event?.teamId ?? "?" }} / S{{ record.event?.squadId ?? "?" }}</span>
                  </div>
                  <span class="pill" :data-tone="record.violation ? 'danger' : 'ok'">{{ record.violation ? "违规" : "通过" }}</span>
                </div>
                <div class="record-meta">
                  <span>时间: {{ formatTime(record.updatedAt || record.createdAt) }}</span>
                  <span>来源: {{ record.source || "-" }}</span>
                </div>
                <p class="reason">{{ record.reason || "未提供原因" }}</p>
              </article>
            </div>
          </PageCard>
        </section>

        <!-- ===== SETTINGS SIDEBAR ===== -->
        <transition name="slide-right">
          <aside v-if="showSettings" class="flow-settings-sidebar">
            <header class="sidebar-head">
              <div>
                <h3>{{ currentSubPageTitle }}配置</h3>
                <p class="sidebar-subtitle">{{ currentSubPageSettingsDesc }}</p>
              </div>
              <button type="button" class="btn ghost btn-sm" @click="showSettings = false">✕</button>
            </header>

            <div v-if="settingsError" class="settings-error-banner">{{ settingsError }}</div>

            <!-- ===== Squad-name settings ===== -->
            <div v-if="isSquadNamePage" class="sidebar-body">
              <section class="settings-section">
                <h4>当前状态</h4>
                <div class="status-row">
                  <span>守卫模块</span>
                  <span class="pill" :data-tone="guardState?.enabled ? 'ok' : 'danger'">
                    {{ guardState?.enabled ? "运行中" : "关闭" }}
                  </span>
                </div>
                <div class="status-row">
                  <span>巡逻模块</span>
                  <span class="pill" :data-tone="patrolState?.enabled ? 'warning' : 'muted'">
                    {{ patrolState?.enabled ? "运行中" : "关闭" }}
                  </span>
                </div>
                <div class="status-row">
                  <span>检测日志建队</span>
                  <span>{{ guardState?.detectLogCreated ? "是" : "否" }}</span>
                </div>
                <div v-if="guardState?.action" class="status-row">
                  <span>处置动作</span>
                  <span class="pill" data-tone="muted">{{ guardState.action }}</span>
                </div>
              </section>

              <section v-if="guardState?.stats" class="settings-section">
                <h4>模块统计</h4>
                <div v-for="(val, key) in guardStateStatsDisplay" :key="key" class="status-row">
                  <span>{{ key }}</span>
                  <span>{{ val }}</span>
                </div>
              </section>

              <section class="settings-section">
                <h4>规则维护</h4>
                <p class="settings-hint">队名规则在独立的规则表格中维护，支持载具别名、关键字和白名单配置。</p>
                <router-link to="/debug/squad-name-policy/rules" class="btn ghost settings-link-btn">
                  打开队名规则表格 →
                </router-link>
              </section>
            </div>

            <!-- ===== Stepwise settings ===== -->
            <div v-else-if="pageMode === 'stepwise'" class="sidebar-body">
              <section class="settings-section">
                <h4>插件开关</h4>
                <div class="toggle-row">
                  <div>
                    <strong>阶梯式建队守卫</strong>
                    <p>按开局时间段、小队性质和队长游玩时长管控建队。</p>
                  </div>
                  <button
                    type="button"
                    :class="['toggle-btn', stepwiseState?.enabled ? 'on' : 'off']"
                    :disabled="settingsSaving"
                    @click="togglePlugin('stepwise-squad-playtime-guard', !stepwiseState?.enabled)"
                  >
                    {{ stepwiseState?.enabled ? "运行中" : "已关闭" }}
                  </button>
                </div>
              </section>

              <section v-if="stepwiseFullState?.settings" class="settings-section">
                <h4>广播设置</h4>
                <label class="checkbox-field">
                  <input
                    type="checkbox"
                    :checked="stepwiseDraft.broadcastOnApproved"
                    :disabled="settingsSaving"
                    @change="stepwiseDraft.broadcastOnApproved = ($event.target as HTMLInputElement).checked"
                  />
                  <div>
                    <strong>通过时广播</strong>
                    <span>建队被允许时向频道广播提示</span>
                  </div>
                </label>
                <label class="checkbox-field">
                  <input
                    type="checkbox"
                    :checked="stepwiseDraft.broadcastOnViolation"
                    :disabled="settingsSaving"
                    @change="stepwiseDraft.broadcastOnViolation = ($event.target as HTMLInputElement).checked"
                  />
                  <div>
                    <strong>违规时广播</strong>
                    <span>建队被拒绝时向频道广播警告</span>
                  </div>
                </label>
                <label class="checkbox-field">
                  <input
                    type="checkbox"
                    :checked="stepwiseDraft.warnOnMissingPlaytime"
                    :disabled="settingsSaving"
                    @change="stepwiseDraft.warnOnMissingPlaytime = ($event.target as HTMLInputElement).checked"
                  />
                  <div>
                    <strong>时长缺失时警告</strong>
                    <span>无法查询到玩家游玩时长时发出警告</span>
                  </div>
                </label>

                <button
                  type="button"
                  class="btn primary settings-save-btn"
                  :disabled="settingsSaving"
                  @click="saveStepwiseSettings"
                >
                  {{ settingsSaving ? "保存中..." : "保存广播设置" }}
                </button>
              </section>

              <section v-if="stepwiseFullState?.settings?.rules" class="settings-section">
                <h4>时长规则概览</h4>
                <p class="settings-hint">规则配置需在服务器配置文件中修改，此处为只读概览。</p>
                <div class="rules-overview">
                  <div class="rules-group">
                    <strong>步兵队</strong>
                    <div v-for="(rule, i) in stepwiseFullState.settings.rules.infantry" :key="`inf-${i}`" class="rule-row">
                      <span>{{ rule.startSeconds }}–{{ rule.endSeconds }}s</span>
                      <span>&gt; {{ rule.minHoursExclusive }}h</span>
                    </div>
                    <div v-if="!stepwiseFullState.settings.rules.infantry?.length" class="no-rules">无规则</div>
                  </div>
                  <div class="rules-group">
                    <strong>载具队</strong>
                    <div v-for="(rule, i) in stepwiseFullState.settings.rules.vehicle" :key="`veh-${i}`" class="rule-row">
                      <span>{{ rule.startSeconds }}–{{ rule.endSeconds }}s</span>
                      <span>&gt; {{ rule.minHoursExclusive }}h</span>
                    </div>
                    <div v-if="!stepwiseFullState.settings.rules.vehicle?.length" class="no-rules">无规则</div>
                  </div>
                </div>
              </section>

              <section v-if="!stepwiseFullState" class="settings-section">
                <p class="settings-hint">{{ settingsLoading ? "正在加载插件状态..." : "点击刷新按钮以加载插件详细状态。" }}</p>
                <button type="button" class="btn ghost" :disabled="settingsLoading" @click="loadSettingsData">
                  {{ settingsLoading ? "加载中..." : "加载插件状态" }}
                </button>
              </section>
            </div>

            <!-- ===== Fair settings ===== -->
            <div v-else-if="pageMode === 'fair'" class="sidebar-body">
              <section class="settings-section">
                <h4>插件开关</h4>
                <div class="toggle-row">
                  <div>
                    <strong>公平建队守卫</strong>
                    <p>管控开局窗口期的建队：禁建、仅步兵、人数阈值。</p>
                  </div>
                  <button
                    type="button"
                    :class="['toggle-btn', fairState?.enabled ? 'on' : 'off']"
                    :disabled="settingsSaving"
                    @click="togglePlugin('fair-squad-guard', !fairState?.enabled)"
                  >
                    {{ fairState?.enabled ? "运行中" : "已关闭" }}
                  </button>
                </div>
              </section>

              <section v-if="fairGuardFullStatus" class="settings-section">
                <h4>当前阶段</h4>
                <div class="status-row">
                  <span>阶段</span>
                  <span class="pill" data-tone="muted">{{ fairGuardFullStatus.phase?.label || fairGuardFullStatus.phase?.phase || "-" }}</span>
                </div>
                <div class="status-row">
                  <span>在线人数</span>
                  <span>{{ fairGuardFullStatus.population?.count ?? "-" }}</span>
                </div>
                <div class="status-row">
                  <span>时钟 (秒)</span>
                  <span>{{ fairGuardFullStatus.clock?.seconds ?? "-" }}s</span>
                </div>
                <div class="status-row">
                  <span>时钟来源</span>
                  <span>{{ fairGuardFullStatus.clock?.trusted ? "可信" : "不可信" }}</span>
                </div>
              </section>

              <section v-if="fairGuardFullStatus?.settings" class="settings-section">
                <h4>时间窗口配置</h4>

                <label class="number-field">
                  <span>触发人数阈值</span>
                  <input
                    v-model.number="fairDraft.enforcementPlayerThreshold"
                    type="number"
                    min="1"
                    max="200"
                    :disabled="settingsSaving"
                    class="settings-input"
                  />
                  <em>人数达到此值后才激活管控</em>
                </label>

                <label class="number-field">
                  <span>禁建窗口 (秒)</span>
                  <input
                    v-model.number="fairDraft.noSquadCreationSeconds"
                    type="number"
                    min="0"
                    max="300"
                    :disabled="settingsSaving"
                    class="settings-input"
                  />
                  <em>开局后此段时间内禁止建队</em>
                </label>

                <label class="number-field">
                  <span>仅步兵窗口 (秒)</span>
                  <input
                    v-model.number="fairDraft.infantryOnlyUntilSeconds"
                    type="number"
                    min="0"
                    max="600"
                    :disabled="settingsSaving"
                    class="settings-input"
                  />
                  <em>此时间点之前只允许步兵队</em>
                </label>
              </section>

              <section v-if="fairGuardFullStatus?.settings" class="settings-section">
                <h4>处置配置</h4>

                <label class="number-field">
                  <span>触发踢出的违规次数</span>
                  <input
                    v-model.number="fairDraft.maxViolationCountBeforeKick"
                    type="number"
                    min="1"
                    max="50"
                    :disabled="settingsSaving"
                    class="settings-input"
                  />
                  <em>同一玩家违规达到此次数后踢出</em>
                </label>

                <h4 style="margin-top: 14px;">广播设置</h4>
                <label class="checkbox-field">
                  <input
                    type="checkbox"
                    :checked="fairDraft.broadcastOnApproved"
                    :disabled="settingsSaving"
                    @change="fairDraft.broadcastOnApproved = ($event.target as HTMLInputElement).checked"
                  />
                  <div>
                    <strong>通过时广播</strong>
                    <span>建队被允许时向频道广播提示</span>
                  </div>
                </label>
                <label class="checkbox-field">
                  <input
                    type="checkbox"
                    :checked="fairDraft.broadcastOnViolation"
                    :disabled="settingsSaving"
                    @change="fairDraft.broadcastOnViolation = ($event.target as HTMLInputElement).checked"
                  />
                  <div>
                    <strong>违规时广播</strong>
                    <span>建队被拒绝时向频道广播警告</span>
                  </div>
                </label>

                <button
                  type="button"
                  class="btn primary settings-save-btn"
                  :disabled="settingsSaving"
                  @click="saveFairSettings"
                >
                  {{ settingsSaving ? "保存中..." : "保存设置" }}
                </button>
              </section>

              <section v-if="fairGuardFullStatus?.summary" class="settings-section">
                <h4>本局统计</h4>
                <div class="status-row">
                  <span>总判定</span>
                  <span>{{ fairGuardFullStatus.summary.total }}</span>
                </div>
                <div class="status-row">
                  <span>已批准</span>
                  <span class="pass-text">{{ fairGuardFullStatus.summary.approved }}</span>
                </div>
                <div class="status-row">
                  <span>违规</span>
                  <span class="danger-text">{{ fairGuardFullStatus.summary.violations }}</span>
                </div>
                <div class="status-row">
                  <span>解散</span>
                  <span>{{ fairGuardFullStatus.summary.disbanded }}</span>
                </div>
                <div class="status-row">
                  <span>踢出</span>
                  <span>{{ fairGuardFullStatus.summary.kicked }}</span>
                </div>
              </section>

              <section v-if="fairGuardFullStatus" class="settings-section">
                <h4>操作</h4>
                <div class="action-buttons">
                  <button
                    type="button"
                    class="btn ghost"
                    :disabled="settingsSaving"
                    @click="doUnlockFairRound"
                  >
                    解锁当局
                  </button>
                  <button
                    type="button"
                    class="btn ghost danger-btn"
                    :disabled="settingsSaving"
                    @click="doResetFairSession"
                  >
                    重置会话
                  </button>
                </div>
                <p class="settings-hint" style="margin-top: 8px;">解锁当局：允许本局继续建载具队。重置会话：清空本局所有记录，谨慎操作。</p>
              </section>

              <section v-if="!fairGuardFullStatus" class="settings-section">
                <p class="settings-hint">{{ settingsLoading ? "正在加载插件状态..." : "点击加载以显示详细配置。" }}</p>
                <button type="button" class="btn ghost" :disabled="settingsLoading" @click="loadSettingsData">
                  {{ settingsLoading ? "加载中..." : "加载插件状态" }}
                </button>
              </section>
            </div>

          </aside>
        </transition>
      </div>

    </template>

    <!-- Whitelist Modal -->
    <Teleport to="body">
      <div
        v-if="whitelistModalOpen"
        class="whitelist-modal-backdrop"
        @click="closeWhitelistDialog"
        v-backdrop-close="closeWhitelistDialog"
      >
        <aside class="whitelist-modal" role="dialog" aria-modal="true" aria-label="加入白名单" @click.stop>
          <header class="whitelist-modal-head">
            <div>
              <h2>加入队名白名单</h2>
              <p>选择这个小队应归入的性质，保存后会写入队名白名单规则。</p>
            </div>
            <button type="button" class="btn ghost btn-sm" @click="closeWhitelistDialog">关闭</button>
          </header>

          <div class="whitelist-modal-body">
            <label class="modal-field">
              <span>小队名称</span>
              <input v-model.trim="whitelistDraft.squadName" type="text" class="modal-input" />
            </label>

            <label class="modal-field">
              <span>队伍性质</span>
              <select v-model="whitelistDraft.nature" class="modal-input">
                <option v-for="option in whitelistNatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
              </select>
            </label>

            <div class="modal-summary">
              <span>当前白名单状态</span>
              <strong>{{ whitelistCurrentNatureLabel }}</strong>
              <small>重复加入会自动去重；改选性质会把队名移动到新的分类。</small>
            </div>

            <div v-if="whitelistError" class="modal-error">{{ whitelistError }}</div>
          </div>

          <footer class="whitelist-modal-actions">
            <button type="button" class="btn ghost" @click="closeWhitelistDialog">取消</button>
            <button type="button" class="btn primary" :disabled="whitelistSaving" @click="saveWhitelistEntry">
              {{ whitelistSaving ? "保存中..." : "确认加入" }}
            </button>
          </footer>
        </aside>
      </div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { apiGet, apiPost } from "../app/apiClient";
import { canAutoRefreshNow } from "../composables/useAutoRefreshGate";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import PageCard from "../components/common/PageCard.vue";
import { useUiStore } from "../stores/ui.store";
import {
  fetchFairSquadGuardStatus,
  unlockFairSquadGuardRound,
  resetFairSquadGuardSession,
} from "../app/fairSquadGuardApi";
// Plugin enable/disable uses dedicated endpoints (not generic plugin service)
async function patchPluginEnabled(urlSlug: string, enabled: boolean) {
  const resp = await fetch(`/api/plugins/${urlSlug}/enabled`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed: ${resp.status}`);
  }
  return resp.json();
}

async function patchPluginConfig(urlSlug: string, config: Record<string, unknown>) {
  const resp = await fetch(`/api/plugins/${urlSlug}/config`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(text || `Request failed: ${resp.status}`);
  }
  return resp.json();
}
import type { FairSquadGuardStatus } from "../app/fairSquadGuardApi";

type SquadRuleNature = "infantry" | "vehicle" | "support" | "logistics";
type FlowMode = "overview" | "squad-name" | "stepwise" | "fair";

const whitelistNatureOptions: Array<{ value: SquadRuleNature; label: string }> = [
  { value: "logistics", label: "后勤" },
  { value: "infantry", label: "普通步兵" },
  { value: "vehicle", label: "载具" },
  { value: "support", label: "支援" },
];

type LifecycleRecord = {
  key: string;
  slotKey?: string;
  serverId?: string;
  matchId?: string | null;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  creationSource?: string;
  sourceLabel?: string;
  createdAt?: string | null;
  createdAtMs?: number;
  createdAtLabel?: string;
  createdDisplayText?: string;
  squadNature?: string;
  squadNatureLabel?: string;
};

type GuardAction = { type?: string };

type GuardRecord = {
  id: string;
  source?: string;
  status?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  event?: {
    teamId?: number | null;
    squadId?: number | null;
    squadName?: string;
    creatorName?: string;
  };
  actions?: GuardAction[];
};

type GuardState = {
  enabled: boolean;
  detectLogCreated?: boolean;
  action?: string;
  stats?: Record<string, unknown>;
  recent: GuardRecord[];
};

type PatrolRecord = {
  id: string;
  source?: string;
  status?: string;
  violation?: boolean;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
  event?: {
    teamId?: number | null;
    squadId?: number | null;
    squadName?: string;
  };
};

type PatrolState = {
  enabled: boolean;
  recent: PatrolRecord[];
};

type LifecycleState = {
  serverId?: string;
  matchId?: string | null;
  updatedAt?: string;
  list: LifecycleRecord[];
};

type ActiveViolation = {
  key: string;
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  squadNature?: string;
  squadNatureLabel?: string;
  createdAt?: string | null;
  createdAtLabel?: string;
  creationSourceLabel: string;
  sourceLabel: string;
  reason: string;
};

type BuildDecisionRecord = {
  id: string;
  source: TrackingRecord["source"];
  teamId?: number | null;
  squadId?: number | null;
  squadName?: string;
  creatorName?: string;
  squadNature?: string;
  squadNatureLabel?: string;
  sourceLabel: string;
  decisionLabel: string;
  decisionTone: "ok" | "warning" | "danger" | "muted";
  reason: string;
  createdAt?: string;
  updatedAt?: string;
  actionLabels: string[];
  canWhitelist: boolean;
};

type TrackingRecord = {
  id: string;
  serverId: string;
  matchId: string;
  teamId: number | null;
  squadId: number | null;
  squadName: string;
  creatorName: string;
  creatorSteamId: string;
  createdAt: string;
  updatedAt: string;
  stage: "squad_name" | "stepwise" | "fair" | "final";
  status: "allowed" | "violation" | "passed" | "skipped";
  source: "squad_name_rule" | "tiered_squad_time" | "fair_squad_creation" | "final_allowed";
  decisionLabel: string;
  decisionTone: "ok" | "warning" | "danger" | "muted";
  reason: string;
  squadNature: string;
  squadNatureLabel: string;
  actions: string[];
  canWhitelist?: boolean;
};

type SquadNameTrackingState = {
  lifecycle: LifecycleState;
  guard: GuardState;
  patrol: PatrolState;
  ruleChain: {
    recent: unknown[];
    stats: Record<string, unknown>;
  };
  stepwise: {
    enabled?: boolean;
    active?: boolean;
    settings?: Record<string, unknown>;
    recentRecords: unknown[];
    summary?: Record<string, unknown>;
  };
  fair: {
    enabled?: boolean;
    active?: boolean;
    settings?: Record<string, unknown>;
    phase?: {
      label?: string;
      phase?: string;
    };
    population?: {
      count?: number;
    };
    clock?: {
      seconds?: number;
    };
    recentRecords: unknown[];
    summary?: Record<string, unknown>;
  };
  records: TrackingRecord[];
};

type StepwiseFullState = {
  enabled?: boolean;
  subscribed?: boolean;
  settings?: {
    broadcastOnApproved?: boolean;
    broadcastOnViolation?: boolean;
    warnOnMissingPlaytime?: boolean;
    liveLookupWhenMissing?: boolean;
    rules?: {
      infantry?: Array<{ startSeconds: number; endSeconds: number; minHoursExclusive: number }>;
      vehicle?: Array<{ startSeconds: number; endSeconds: number; minHoursExclusive: number }>;
    };
  };
  summary?: {
    total?: number;
    violations?: number;
    allowed?: number;
  };
};

type WhitelistRulesResponse = {
  updatedAt?: string | null;
  exactRules?: Record<SquadRuleNature, string[]>;
};

type WhitelistSource = {
  squadName?: string;
  squadNature?: string;
  squadNatureLabel?: string;
};

// --- Main state ---
const loading = ref(false);
const error = ref("");
const autoRefresh = ref(true);
const lifecycle = ref<LifecycleState | null>(null);
const guardState = ref<GuardState | null>(null);
const patrolState = ref<PatrolState | null>(null);
const stepwiseState = ref<SquadNameTrackingState["stepwise"] | null>(null);
const fairState = ref<SquadNameTrackingState["fair"] | null>(null);
const trackingRecords = ref<TrackingRecord[]>([]);
const whitelistRules = ref<Record<SquadRuleNature, string[]> | null>(null);
const whitelistModalOpen = ref(false);
const whitelistSaving = ref(false);
const whitelistError = ref("");
const whitelistDraft = reactive({
  squadName: "",
  nature: "infantry" as SquadRuleNature,
});

// --- Settings sidebar state ---
const showSettings = ref(false);
const settingsLoading = ref(false);
const settingsSaving = ref(false);
const settingsError = ref("");
const fairGuardFullStatus = ref<FairSquadGuardStatus | null>(null);
const stepwiseFullState = ref<StepwiseFullState | null>(null);

const fairDraft = reactive({
  enforcementPlayerThreshold: 50,
  noSquadCreationSeconds: 20,
  infantryOnlyUntilSeconds: 50,
  maxViolationCountBeforeKick: 15,
  broadcastOnApproved: false,
  broadcastOnViolation: true,
});

const stepwiseDraft = reactive({
  broadcastOnApproved: false,
  broadcastOnViolation: true,
  warnOnMissingPlaytime: false,
});

const ui = useUiStore();
const route = useRoute();
let autoRefreshTimer: number | null = null;

// --- Page mode ---
const pageMode = computed<FlowMode>(() => {
  const path = String(route.fullPath || route.path || "");
  if (path.includes("/squad-rule-chain/stepwise") || path.includes("stepwise-squad-playtime-guard")) return "stepwise";
  if (path.includes("/squad-rule-chain/fair") || path.includes("fair-squad-guard")) return "fair";
  if (path.includes("/squad-rule-chain/squad-name") || path.includes("squad-name-policy")) return "squad-name";
  return "overview";
});

const isOverviewPage = computed(() => pageMode.value === "overview");
const isSquadNamePage = computed(() => pageMode.value === "squad-name");

const flowTabs = [
  { mode: "overview", path: "/squad-rule-chain", title: "主统计", caption: "全链路概览" },
  { mode: "squad-name", path: "/squad-rule-chain/squad-name", title: "队名规范", caption: "命名与白名单" },
  { mode: "stepwise", path: "/squad-rule-chain/stepwise", title: "阶梯建队", caption: "时长门槛" },
  { mode: "fair", path: "/squad-rule-chain/fair", title: "公平建队", caption: "开局窗口" },
] satisfies Array<{ mode: FlowMode; path: string; title: string; caption: string }>;

const currentSubPageTitle = computed(() => {
  if (pageMode.value === "squad-name") return "队名规范";
  if (pageMode.value === "stepwise") return "阶梯建队";
  if (pageMode.value === "fair") return "公平建队";
  return "";
});

const currentSubPageSettingsDesc = computed(() => {
  if (pageMode.value === "squad-name") return "查看模块状态，管理命名规则。";
  if (pageMode.value === "stepwise") return "启用/禁用插件，调整广播行为。";
  if (pageMode.value === "fair") return "启用/禁用插件，配置时间窗口与处置参数。";
  return "";
});

const currentFlowTitle = computed(() => {
  if (pageMode.value === "squad-name") return "队名规范判定";
  if (pageMode.value === "stepwise") return "阶梯式建队判定";
  if (pageMode.value === "fair") return "公平建队判定";
  return "建队判定流水";
});

const currentFlowDescription = computed(() => {
  if (pageMode.value === "squad-name") return "检查默认名、白名单、载具命名规范和疑似违规队名。";
  if (pageMode.value === "stepwise") return "队名通过后，按开局时间段、小队性质和队长游戏时长放行或拦截。";
  if (pageMode.value === "fair") return "最后检查开局禁建、仅步兵窗口和当前人数阈值。";
  return "按队名规范、阶梯式时长、公平建队汇总后的最终链路结果。";
});

const currentSnapshotDescription = computed(() => {
  if (pageMode.value === "stepwise") return "结合内存快照，辅助核对阶梯式建队通过后仍在场的小队。";
  if (pageMode.value === "fair") return "结合内存快照，辅助核对公平建队通过后仍在场的小队。";
  return "结合内存快照，仅展示最终通过建队规则链的在场小队。";
});

// --- Derived records ---
const finalAllowedKeys = computed(() => {
  const keys = new Set<string>();
  for (const record of trackingRecords.value) {
    if (record.status !== "allowed") continue;
    const key = buildSlotKey(record.teamId, record.squadId);
    if (key) keys.add(key);
  }
  return keys;
});

const orderedLifecycle = computed(() => {
  const list = Array.isArray(lifecycle.value?.list) ? lifecycle.value!.list : [];
  return list
    .filter((item) => finalAllowedKeys.value.has(buildSlotKey(item.teamId, item.squadId)))
    .slice()
    .sort((left, right) => Number(right.createdAtMs ?? 0) - Number(left.createdAtMs ?? 0));
});

const guardViolations = computed(() => {
  const list = Array.isArray(guardState.value?.recent) ? guardState.value!.recent : [];
  return list.filter((item) => item.status === "violation" || item.status === "handled" || item.status === "error");
});

const buildDecisionRecords = computed<BuildDecisionRecord[]>(() => {
  return trackingRecords.value.map((record) => {
    let sourceLabel: string = record.source || "-";
    if (record.source === "squad_name_rule") sourceLabel = "队名规范";
    else if (record.source === "tiered_squad_time") sourceLabel = "阶梯建队";
    else if (record.source === "fair_squad_creation") sourceLabel = "公平建队";
    else if (record.source === "final_allowed") sourceLabel = "最终通过";

    return {
      id: record.id,
      source: record.source,
      teamId: record.teamId,
      squadId: record.squadId,
      squadName: record.squadName,
      creatorName: record.creatorName,
      squadNature: record.squadNature,
      squadNatureLabel: record.squadNatureLabel,
      sourceLabel,
      decisionLabel: record.decisionLabel || buildDecisionLabel(record.status),
      decisionTone: record.decisionTone || buildDecisionTone(record.status),
      reason: record.reason || "",
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      actionLabels: Array.isArray(record.actions) ? record.actions : [],
      canWhitelist: Boolean(record.canWhitelist),
    };
  });
});

const currentDecisionRecords = computed(() => {
  if (pageMode.value === "squad-name") return buildDecisionRecords.value.filter((item) => item.source === "squad_name_rule");
  if (pageMode.value === "stepwise") return buildDecisionRecords.value.filter((item) => item.source === "tiered_squad_time");
  if (pageMode.value === "fair") return buildDecisionRecords.value.filter((item) => item.source === "fair_squad_creation");
  return buildDecisionRecords.value;
});

const patrolRecords = computed(() => {
  return Array.isArray(patrolState.value?.recent) ? patrolState.value!.recent : [];
});

const allowedDecisionCount = computed(() => buildDecisionRecords.value.filter((item) => item.decisionTone === "ok").length);
const violationDecisionCount = computed(() => buildDecisionRecords.value.filter((item) => item.decisionTone === "danger").length);
const skippedDecisionCount = computed(() => buildDecisionRecords.value.filter((item) => item.decisionTone === "muted").length);

const disbandedCount = computed(() => {
  return guardViolations.value.reduce((count, record) => {
    return count + (record.actions?.filter((action) => action.type === "disbanded").length ?? 0);
  }, 0);
});

const warnedCount = computed(() => {
  return guardViolations.value.reduce((count, record) => {
    return count + (record.actions?.filter((action) => action.type === "warned").length ?? 0);
  }, 0);
});

const patrolViolationCount = computed(() => patrolRecords.value.filter((item) => item.violation).length);
const riskTotal = computed(() => violationDecisionCount.value + activeViolations.value.length);
const enabledFlowCount = computed(() => [guardState.value?.enabled, stepwiseState.value?.enabled, fairState.value?.enabled].filter(Boolean).length);
const passRateText = computed(() => {
  const total = buildDecisionRecords.value.length;
  if (!total) return "0%";
  return `${Math.round((allowedDecisionCount.value / total) * 100)}%`;
});
const healthTone = computed(() => {
  if (riskTotal.value > 0) return "danger";
  if (enabledFlowCount.value < 3) return "warning";
  return "ok";
});
const healthLabel = computed(() => {
  if (riskTotal.value > 0) return "需要关注";
  if (enabledFlowCount.value < 3) return "部分运行";
  return "运行正常";
});

// --- NEW: Per-flow stats ---
function buildFlowStats(source: TrackingRecord["source"]) {
  const records = buildDecisionRecords.value.filter((item) => item.source === source);
  const total = records.length;
  const violations = records.filter((item) => item.decisionTone === "danger" || item.decisionTone === "warning").length;
  const allowed = records.filter((item) => item.decisionTone === "ok").length;
  const passRate = total > 0 ? `${Math.round((allowed / total) * 100)}%` : "—";
  return { total, violations, allowed, passRate };
}

const squadNameFlowStats = computed(() => buildFlowStats("squad_name_rule"));
const stepwiseFlowStats = computed(() => buildFlowStats("tiered_squad_time"));
const fairFlowStats = computed(() => buildFlowStats("fair_squad_creation"));

// --- NEW: Lifecycle composition ---
const lifecycleComposition = computed(() => {
  const list = orderedLifecycle.value;
  let infantry = 0, vehicle = 0, support = 0, other = 0;
  for (const item of list) {
    const nature = String(item.squadNature ?? "").toLowerCase();
    if (nature === "infantry") infantry++;
    else if (nature === "vehicle") vehicle++;
    else if (nature === "support") support++;
    else other++;
  }
  return { infantry, vehicle, support, other };
});

// --- NEW: Fair phase / clock labels ---
const fairPhaseLabel = computed(() => {
  const phase = fairState.value?.phase;
  return phase?.label || phase?.phase || "未同步";
});

const fairPopulationCount = computed(() => {
  return fairState.value?.population?.count ?? "—";
});

const fairClockLabel = computed(() => {
  const seconds = fairState.value?.clock?.seconds;
  if (seconds == null) return "—";
  return `${seconds}s`;
});

// --- Flow summaries (with pass rate) ---
const flowSummaries = computed(() => {
  const makeEntry = (
    mode: FlowMode,
    title: string,
    description: string,
    path: string,
    source: TrackingRecord["source"],
  ) => {
    const records = buildDecisionRecords.value.filter((item) => item.source === source);
    const total = records.length;
    const violations = records.filter((item) => item.decisionTone === "danger" || item.decisionTone === "warning").length;
    const allowed = records.filter((item) => item.decisionTone === "ok").length;
    const passRatePct = total > 0 ? Math.round((allowed / total) * 100) : 0;
    const passRate = total > 0 ? `${passRatePct}% 通过` : "—";
    return { mode, title, description, path, total, violations, allowed, passRatePct, passRate };
  };

  return [
    makeEntry("squad-name", "队名规范", "命名、白名单、巡逻识别", "/squad-rule-chain/squad-name", "squad_name_rule"),
    makeEntry("stepwise", "阶梯式建队", "时间段与时长门槛", "/squad-rule-chain/stepwise", "tiered_squad_time"),
    makeEntry("fair", "公平建队", "开局禁建与人数阈值", "/squad-rule-chain/fair", "fair_squad_creation"),
  ];
});

const overviewRiskRecords = computed(() => {
  return buildDecisionRecords.value
    .filter((item) => item.decisionTone === "danger" || item.decisionTone === "warning")
    .slice(0, 10);
});

const ruleStages = computed(() => {
  const guardStats = guardState.value?.stats ?? {} as Record<string, unknown>;
  const stepwiseSummary = stepwiseState.value?.summary ?? {} as Record<string, unknown>;
  const fairSummary = fairState.value?.summary ?? {} as Record<string, unknown>;
  const fairPhase = fairState.value?.phase?.label || fairState.value?.phase?.phase || "未同步";
  const fairPopulation = numberText(fairState.value?.population?.count);

  return [
    {
      key: "squad-name",
      index: "01",
      path: "/squad-rule-chain/squad-name",
      title: "队名规范",
      status: guardState.value?.enabled ? "运行中" : "关闭",
      tone: guardState.value?.enabled ? "ok" : "danger",
      description: "先校验默认名、白名单、载具命名规范和疑似违规队名。",
      primaryMetric: `已判定 ${numberText(guardStats.evaluated)} 次`,
      secondaryMetric: `违规 ${numberText(guardStats.violations)} 次`,
      tertiaryMetric: squadNameFlowStats.value.total > 0 ? `${squadNameFlowStats.value.passRate} 通过` : null,
    },
    {
      key: "stepwise",
      index: "02",
      path: "/squad-rule-chain/stepwise",
      title: "阶梯式建队",
      status: stepwiseState.value?.enabled ? "运行中" : "关闭",
      tone: stepwiseState.value?.enabled ? "ok" : "danger",
      description: "队名通过后，再按开局时间段、小队性质和队长游戏时长放行或拦截。",
      primaryMetric: `已判定 ${numberText(stepwiseSummary.total ?? stepwiseState.value?.recentRecords?.length)} 次`,
      secondaryMetric: `违规 ${numberText(stepwiseSummary.violations)} 次`,
      tertiaryMetric: stepwiseFlowStats.value.total > 0 ? `${stepwiseFlowStats.value.passRate} 通过` : null,
    },
    {
      key: "fair",
      index: "03",
      path: "/squad-rule-chain/fair",
      title: "公平建队",
      status: fairState.value?.enabled ? "运行中" : "关闭",
      tone: fairState.value?.enabled ? "ok" : "danger",
      description: "最后检查开局禁建、仅步兵窗口和当前人数阈值。",
      primaryMetric: `阶段 ${fairPhase}`,
      secondaryMetric: `人数 ${fairPopulation} / 违规 ${numberText(fairSummary.violations)}`,
      tertiaryMetric: fairFlowStats.value.total > 0 ? `${fairFlowStats.value.passRate} 通过` : null,
    },
  ] as const;
});

const activeViolations = computed<ActiveViolation[]>(() => {
  const current = orderedLifecycle.value;
  if (!current.length) return [];

  const latestPatrolByKey = new Map<string, PatrolRecord>();
  for (const record of patrolRecords.value) {
    const key = buildSlotKey(record.event?.teamId, record.event?.squadId);
    if (!key) continue;
    if (!latestPatrolByKey.has(key)) latestPatrolByKey.set(key, record);
  }

  return current
    .map((item) => {
      const key = buildSlotKey(item.teamId, item.squadId);
      const patrol = latestPatrolByKey.get(key);
      if (!patrol?.violation) return null;

      const patrolName = String(patrol.event?.squadName ?? "").trim().toLowerCase();
      const currentName = String(item.squadName ?? "").trim().toLowerCase();
      if (patrolName !== currentName) return null;

      return {
        key: item.key,
        teamId: item.teamId,
        squadId: item.squadId,
        squadName: item.squadName,
        creatorName: item.creatorName,
        squadNature: item.squadNature,
        squadNatureLabel: item.squadNatureLabel,
        createdAt: item.createdAt,
        createdAtLabel: item.createdAtLabel,
        creationSourceLabel: item.sourceLabel || item.creationSource || "-",
        sourceLabel: "巡逻识别",
        reason: patrol.reason || "巡逻识别为违规队名",
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
});

// --- Guard stats display ---
const guardStateStatsDisplay = computed(() => {
  const stats = guardState.value?.stats;
  if (!stats) return {};
  const labelMap: Record<string, string> = {
    evaluated: "已评估",
    violations: "违规次数",
    handled: "已处置",
    passed: "已通过",
    broadcasts: "广播次数",
    whitelist: "白名单命中",
  };
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(stats)) {
    result[labelMap[key] ?? key] = val;
  }
  return result;
});

// --- Lifecycle ---
onMounted(() => {
  void loadAll();
  setupAutoRefresh();
});

onUnmounted(() => {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
});

// Close settings when switching pages
watch(pageMode, () => {
  showSettings.value = false;
  fairGuardFullStatus.value = null;
  stepwiseFullState.value = null;
});

function setupAutoRefresh() {
  if (autoRefreshTimer != null) {
    window.clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
  if (!autoRefresh.value) return;
  autoRefreshTimer = window.setInterval(() => {
    if (canAutoRefreshNow()) void loadAll(false);
  }, 2500);
}

function toggleAutoRefresh() {
  autoRefresh.value = !autoRefresh.value;
  setupAutoRefresh();
}

function refreshNow() {
  void loadAll();
}

async function loadAll(showSpinner = true) {
  if (showSpinner) loading.value = true;
  error.value = "";

  try {
    const [trackingResponse, whitelistResponse] = await Promise.all([
      apiGet<{ ok: boolean; data: SquadNameTrackingState }>("/api/squad-name-tracking/state"),
      apiGet<WhitelistRulesResponse>("/api/squad-name/rules").catch(() => null),
    ]);
    const data = trackingResponse.data;
    lifecycle.value = data.lifecycle ?? { list: [] };
    guardState.value = data.guard ?? { enabled: false, recent: [] };
    patrolState.value = data.patrol ?? { enabled: false, recent: [] };
    stepwiseState.value = data.stepwise ?? { enabled: false, recentRecords: [] };
    fairState.value = data.fair ?? { enabled: false, recentRecords: [] };
    trackingRecords.value = data.records ?? [];
    whitelistRules.value = normalizeWhitelistRules(whitelistResponse?.exactRules);
  } catch (err) {
    error.value = err instanceof Error ? err.message : "加载建队追踪失败。";
  } finally {
    if (showSpinner) loading.value = false;
  }
}

// --- Settings panel ---
function toggleSettings() {
  showSettings.value = !showSettings.value;
  if (showSettings.value) {
    void loadSettingsData();
  }
}

async function loadSettingsData() {
  settingsLoading.value = true;
  settingsError.value = "";
  try {
    if (pageMode.value === "fair") {
      const status = await fetchFairSquadGuardStatus();
      fairGuardFullStatus.value = status;
      // Populate draft from loaded settings
      const s = status.settings;
      fairDraft.enforcementPlayerThreshold = s.enforcementPlayerThreshold ?? 50;
      fairDraft.noSquadCreationSeconds = s.noSquadCreationSeconds ?? 20;
      fairDraft.infantryOnlyUntilSeconds = s.infantryOnlyUntilSeconds ?? 50;
      fairDraft.maxViolationCountBeforeKick = s.maxViolationCountBeforeKick ?? 15;
      fairDraft.broadcastOnApproved = s.broadcastOnApproved ?? false;
      fairDraft.broadcastOnViolation = s.broadcastOnViolation ?? true;
    } else if (pageMode.value === "stepwise") {
      const resp = await apiGet<{ ok: boolean; data: StepwiseFullState }>("/api/plugins/stepwise-squad-playtime-guard/state");
      stepwiseFullState.value = resp.data;
      const s = resp.data.settings;
      if (s) {
        stepwiseDraft.broadcastOnApproved = Boolean(s.broadcastOnApproved);
        stepwiseDraft.broadcastOnViolation = Boolean(s.broadcastOnViolation);
        stepwiseDraft.warnOnMissingPlaytime = Boolean(s.warnOnMissingPlaytime);
      }
    }
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : "加载插件状态失败。";
  } finally {
    settingsLoading.value = false;
  }
}

async function togglePlugin(urlSlug: string, enabled: boolean) {
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    await patchPluginEnabled(urlSlug, enabled);
    ui.pushToast({
      title: enabled ? "插件已启用" : "插件已禁用",
      message: `${currentSubPageTitle.value}守卫已${enabled ? "开启" : "关闭"}。`,
      tone: enabled ? "ok" : "warn",
    });
    // Reload main data to refresh enabled states
    await loadAll(false);
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : "操作失败";
    ui.pushToast({ title: "操作失败", message: settingsError.value, tone: "error" });
  } finally {
    settingsSaving.value = false;
  }
}

async function saveFairSettings() {
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    await patchPluginConfig("fair-squad-guard", {
      enforcementPlayerThreshold: fairDraft.enforcementPlayerThreshold,
      noSquadCreationSeconds: fairDraft.noSquadCreationSeconds,
      infantryOnlyUntilSeconds: fairDraft.infantryOnlyUntilSeconds,
      maxViolationCountBeforeKick: fairDraft.maxViolationCountBeforeKick,
      broadcastOnApproved: fairDraft.broadcastOnApproved,
      broadcastOnViolation: fairDraft.broadcastOnViolation,
    });
    ui.pushToast({ title: "配置已保存", message: "公平建队插件参数已更新。", tone: "ok" });
    // Refresh status
    fairGuardFullStatus.value = await fetchFairSquadGuardStatus();
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : "保存失败";
    ui.pushToast({ title: "保存失败", message: settingsError.value, tone: "error" });
  } finally {
    settingsSaving.value = false;
  }
}

async function saveStepwiseSettings() {
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    await patchPluginConfig("stepwise-squad-playtime-guard", {
      broadcastOnApproved: stepwiseDraft.broadcastOnApproved,
      broadcastOnViolation: stepwiseDraft.broadcastOnViolation,
      warnOnMissingPlaytime: stepwiseDraft.warnOnMissingPlaytime,
    });
    ui.pushToast({ title: "配置已保存", message: "阶梯建队插件参数已更新。", tone: "ok" });
    // Reload
    const resp = await apiGet<{ ok: boolean; data: StepwiseFullState }>("/api/plugins/stepwise-squad-playtime-guard/state");
    stepwiseFullState.value = resp.data;
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : "保存失败";
    ui.pushToast({ title: "保存失败", message: settingsError.value, tone: "error" });
  } finally {
    settingsSaving.value = false;
  }
}

async function doUnlockFairRound() {
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    await unlockFairSquadGuardRound();
    fairGuardFullStatus.value = await fetchFairSquadGuardStatus();
    ui.pushToast({ title: "当局已解锁", message: "本局建队管控已解除，可继续建载具队。", tone: "ok" });
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : "操作失败";
    ui.pushToast({ title: "操作失败", message: settingsError.value, tone: "error" });
  } finally {
    settingsSaving.value = false;
  }
}

async function doResetFairSession() {
  settingsSaving.value = true;
  settingsError.value = "";
  try {
    await resetFairSquadGuardSession();
    fairGuardFullStatus.value = await fetchFairSquadGuardStatus();
    ui.pushToast({ title: "会话已重置", message: "公平建队本局记录已清空。", tone: "warn" });
  } catch (err) {
    settingsError.value = err instanceof Error ? err.message : "操作失败";
    ui.pushToast({ title: "操作失败", message: settingsError.value, tone: "error" });
  } finally {
    settingsSaving.value = false;
  }
}

// --- Slot key helpers ---
function buildSlotKey(teamId: unknown, squadId: unknown) {
  const team = Number(teamId);
  const squad = Number(squadId);
  if (!Number.isFinite(team) || !Number.isFinite(squad)) return "";
  return `${team}:${squad}`;
}

function formatTime(value: unknown) {
  if (!value) return "-";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function numberText(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return String(Math.max(0, Math.floor(number)));
}

function buildDecisionLabel(status: string) {
  if (status === "allowed") return "合法";
  if (status === "handled" || status === "violation" || status === "error") return "违规";
  if (status === "skipped") return "跳过";
  return status || "未知";
}

function buildDecisionTone(status: string): "ok" | "warning" | "danger" | "muted" {
  if (status === "allowed") return "ok";
  if (status === "handled" || status === "error") return "danger";
  if (status === "violation") return "warning";
  return "muted";
}

function canWhitelistRecord(item: BuildDecisionRecord | ActiveViolation | LifecycleRecord) {
  const source = String((item as any).source ?? (item as any).sourceLabel ?? "").trim();
  return Boolean((item as any).squadName)
    && (
      source === "squad_name_rule"
      || source === "Patrol"
      || source === "巡逻识别"
      || source === "队名规范"
    );
}

async function openWhitelistDialog(source: WhitelistSource) {
  const squadName = String(source.squadName ?? "").trim();
  if (!squadName) {
    ui.pushToast({ title: "无法加入白名单", message: "缺少小队名称。", tone: "warn" });
    return;
  }

  whitelistError.value = "";
  try {
    whitelistDraft.squadName = squadName;
    whitelistDraft.nature = getWhitelistNature(squadName)
      ?? normalizeNature(source.squadNature)
      ?? "infantry";
    whitelistModalOpen.value = true;
  } catch (err) {
    whitelistError.value = err instanceof Error ? err.message : "加载白名单失败。";
    ui.pushToast({ title: "加载失败", message: whitelistError.value, tone: "error" });
  }
}

function closeWhitelistDialog() {
  if (whitelistSaving.value) return;
  whitelistModalOpen.value = false;
  whitelistError.value = "";
}

async function ensureWhitelistRulesLoaded() {
  if (whitelistRules.value) return whitelistRules.value;
  const payload = await apiGet<WhitelistRulesResponse>("/api/squad-name/rules");
  whitelistRules.value = normalizeWhitelistRules(payload.exactRules);
  return whitelistRules.value;
}

async function saveWhitelistEntry() {
  const squadName = String(whitelistDraft.squadName ?? "").trim();
  if (!squadName) {
    whitelistError.value = "请输入小队名称。";
    return;
  }

  whitelistSaving.value = true;
  whitelistError.value = "";

  try {
    const payload = await apiPost<{
      ok: boolean;
      policyRevision: number;
      evaluation?: { valid?: boolean };
    }>("/api/squad-name-policy/whitelist", {
      name: squadName,
      nature: whitelistDraft.nature,
      allowSquadSuffix: true,
    });
    if (!payload.ok || payload.evaluation?.valid !== true) {
      throw new Error("保存后回验失败，队名规范尚未识别该名称。");
    }

    whitelistModalOpen.value = false;
    ui.pushToast({
      title: "白名单已更新",
      message: `${squadName} 已加入 ${getNatureLabel(whitelistDraft.nature)} 白名单。`,
      tone: "ok",
    });
  } catch (err) {
    whitelistError.value = err instanceof Error ? err.message : "保存白名单失败。";
    ui.pushToast({
      title: "保存失败",
      message: whitelistError.value,
      tone: "error",
    });
  } finally {
    whitelistSaving.value = false;
  }
}

function normalizeWhitelistRules(exactRules?: Partial<Record<SquadRuleNature, string[]>> | null) {
  return {
    infantry: normalizeWhitelistNames(exactRules?.infantry),
    vehicle: normalizeWhitelistNames(exactRules?.vehicle),
    support: normalizeWhitelistNames(exactRules?.support),
    logistics: normalizeWhitelistNames(exactRules?.logistics),
  };
}

function normalizeWhitelistNames(values: unknown) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(values) ? values : []) {
    const name = String(item ?? "").trim();
    if (!name) continue;
    const key = normalizeSquadNameKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(name);
  }
  return result;
}

function removeWhitelistName(rules: Record<SquadRuleNature, string[]>, squadName: string) {
  const target = normalizeSquadNameKey(squadName);
  for (const nature of whitelistNatureOptions) {
    rules[nature.value] = rules[nature.value].filter((item) => normalizeSquadNameKey(item) !== target);
  }
}

function getWhitelistNature(squadName: string) {
  const target = normalizeSquadNameKey(squadName);
  if (!target || !whitelistRules.value) return null;

  for (const nature of whitelistNatureOptions) {
    if (whitelistRules.value[nature.value].some((item) => normalizeSquadNameKey(item) === target)) {
      return nature.value;
    }
  }
  return null;
}

function normalizeSquadNameKey(value: string) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeNature(value?: string) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "infantry" || normalized === "vehicle" || normalized === "support" || normalized === "logistics") return normalized;
  return null;
}

function getNatureLabel(nature?: string) {
  if (nature === "infantry") return "普通步兵";
  if (nature === "vehicle") return "载具";
  if (nature === "support") return "支援";
  if (nature === "logistics") return "后勤";
  return "未知";
}

const whitelistCurrentNatureLabel = computed(() => {
  const current = getWhitelistNature(whitelistDraft.squadName);
  if (current) return `当前已在 ${getNatureLabel(current)} 白名单`;
  return "当前未在白名单中";
});
</script>

<style scoped>
.tracking-page {
  display: grid;
  gap: 14px;
  padding: 14px;
  min-height: 100%;
}

.toolbar-main {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}

.page-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-right: 8px;
}

.btn {
  min-height: 34px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  cursor: pointer;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  font-size: 13px;
  gap: 6px;
  transition: background 0.15s, border-color 0.15s;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn.primary {
  border-color: rgba(69, 214, 148, 0.42);
  background: rgba(69, 214, 148, 0.16);
}

.btn.ghost {
  background: rgba(255, 255, 255, 0.03);
}

.btn.ghost:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.07);
}

.btn-sm {
  min-height: 28px;
  padding: 0 9px;
  font-size: 12px;
}

.danger-btn {
  border-color: rgba(255, 92, 92, 0.34);
  color: #ffadad;
}

.banner {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 13px;
}

.banner.error {
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.14);
  color: #ffb3b3;
}

/* ===== Tabs ===== */
.flow-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.flow-tab {
  min-width: 0;
  min-height: 54px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  padding: 9px 11px;
  background: rgba(255, 255, 255, 0.028);
  display: grid;
  gap: 3px;
  color: var(--color-text-primary);
  text-decoration: none;
  transition: background 0.15s, border-color 0.15s;
}

.flow-tab:hover {
  background: rgba(255, 255, 255, 0.05);
}

.flow-tab.active {
  border-color: rgba(82, 145, 255, 0.42);
  background: rgba(82, 145, 255, 0.12);
}

.flow-tab strong,
.flow-tab span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.flow-tab strong {
  font-size: 13px;
}

.flow-tab span {
  color: var(--color-text-muted);
  font-size: 11px;
}

/* ===== Overview hero (primary row) ===== */
.overview-hero {
  display: grid;
  grid-template-columns: minmax(260px, 1.3fr) repeat(4, minmax(140px, 1fr));
  gap: 10px;
}

.health-panel,
.hero-metric,
.ops-card {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.032);
  display: grid;
  gap: 4px;
}

.health-panel {
  padding: 14px;
}

.health-panel[data-tone="ok"] {
  border-color: rgba(69, 214, 148, 0.34);
  background: rgba(69, 214, 148, 0.08);
}

.health-panel[data-tone="warning"] {
  border-color: rgba(245, 190, 80, 0.34);
  background: rgba(245, 190, 80, 0.08);
}

.health-panel[data-tone="danger"],
.hero-metric.danger,
.ops-card.danger {
  border-color: rgba(255, 92, 92, 0.3);
  background: rgba(255, 92, 92, 0.055);
}

.hero-metric.warning,
.ops-card.warning {
  border-color: rgba(245, 190, 80, 0.28);
}

.health-panel span,
.health-panel em,
.hero-metric span,
.hero-metric em,
.ops-card span,
.ops-card em {
  color: var(--color-text-muted);
  font-size: 11px;
  font-style: normal;
  line-height: 1.35;
}

.health-panel strong {
  font-size: 30px;
  color: var(--color-text-primary);
  line-height: 1.05;
}

.hero-metric strong,
.ops-card strong {
  font-size: 26px;
  color: var(--color-text-primary);
  line-height: 1.05;
}

/* ===== Overview secondary band ===== */
.overview-secondary-band {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

.sec-metric {
  min-width: 0;
  border: 1px solid rgba(148, 163, 184, 0.13);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.022);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sec-metric.has-danger {
  border-color: rgba(255, 92, 92, 0.22);
  background: rgba(255, 92, 92, 0.04);
}

.sec-metric-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
}

.sec-metric-header span {
  color: var(--color-text-muted);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sec-metric-header strong {
  font-size: 22px;
  color: var(--color-text-primary);
  line-height: 1;
  flex-shrink: 0;
}

.sec-metric-header strong.phase-label {
  font-size: 14px;
}

.sec-metric-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.sec-metric-row span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.sec-tag {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(148, 163, 184, 0.14);
  color: var(--color-text-muted);
}

.sec-tag.infantry {
  background: rgba(69, 214, 148, 0.07);
  border-color: rgba(69, 214, 148, 0.18);
  color: #83f0bb;
}

.sec-tag.vehicle {
  background: rgba(82, 145, 255, 0.07);
  border-color: rgba(82, 145, 255, 0.2);
  color: #93b8ff;
}

.sec-tag.support {
  background: rgba(245, 190, 80, 0.07);
  border-color: rgba(245, 190, 80, 0.18);
  color: #ffd27a;
}

/* ===== Ops band (sub-pages) ===== */
.ops-band {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 10px;
}

.ops-card.primary {
  border-color: rgba(82, 145, 255, 0.34);
  background: rgba(82, 145, 255, 0.11);
}

/* ===== Overview grid ===== */
.overview-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(360px, 0.9fr);
  grid-auto-rows: minmax(280px, 42vh);
  gap: 12px;
  min-height: 0;
}

.flow-stack,
.flow-compare,
.record-list,
.squad-table {
  display: grid;
  gap: 8px;
}

.flow-stage {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  min-height: 96px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 8px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.024);
}

.flow-stage[data-tone="ok"] {
  border-color: rgba(69, 214, 148, 0.22);
}

.flow-stage[data-tone="danger"] {
  border-color: rgba(255, 92, 92, 0.24);
}

.flow-stage-index {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(148, 163, 184, 0.22);
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.flow-stage-body {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.flow-stage-head,
.flow-stage-meta,
.compare-row,
.compare-stats,
.record-head,
.record-meta,
.tag-row,
.record-actions,
.whitelist-modal-head,
.whitelist-modal-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}

.flow-stage-head strong,
.compare-row strong,
.record-head strong {
  color: var(--color-text-primary);
}

.flow-stage-body p,
.reason {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
  line-height: 1.5;
}

.flow-stage-meta span,
.compare-row span,
.record-head span,
.record-meta span,
.action-hint {
  color: var(--color-text-muted);
  font-size: 12px;
}

/* Improved compare-row with rate bar */
.compare-row {
  min-height: 72px;
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.024);
}

.compare-row > div:first-child {
  min-width: 140px;
  display: grid;
  gap: 3px;
}

.compare-stats-block {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
  min-width: 160px;
}

.compare-stats {
  justify-content: flex-start;
}

.compare-rate-bar {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compare-rate-bar-track {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: rgba(255, 255, 255, 0.06);
  overflow: hidden;
  position: relative;
}

.rate-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.rate-fill.rate-ok {
  background: rgba(69, 214, 148, 0.6);
}

.rate-fill.rate-warn {
  background: rgba(245, 190, 80, 0.5);
}

.rate-label {
  font-size: 11px;
  color: var(--color-text-muted);
  white-space: nowrap;
  min-width: 52px;
  text-align: right;
}

/* Nature badges */
.nature-badge {
  font-size: 11px;
  color: var(--color-text-muted);
}

.nature-badge[data-nature="infantry"] {
  color: #83f0bb;
}

.nature-badge[data-nature="vehicle"] {
  color: #93b8ff;
}

.nature-badge[data-nature="support"] {
  color: #ffd27a;
}

.nature-summary {
  display: flex;
  gap: 4px;
  align-items: center;
}

/* ===== Sub-page workspace ===== */
.sub-page-workspace {
  display: flex;
  gap: 12px;
  min-height: 0;
  align-items: flex-start;
}

.content-grid {
  flex: 1;
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1.14fr) minmax(360px, 0.86fr);
  grid-auto-rows: minmax(360px, 46vh);
  gap: 12px;
  min-height: 0;
}

.records-panel {
  grid-row: span 2;
}

/* ===== Settings sidebar ===== */
.flow-settings-sidebar {
  width: 320px;
  flex-shrink: 0;
  border: 1px solid rgba(148, 163, 184, 0.16);
  border-radius: 10px;
  background: var(--color-bg-panel, rgba(15, 23, 42, 0.9));
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  max-height: calc(var(--app-viewport-height) - 200px);
  overflow: hidden;
  align-self: flex-start;
  position: sticky;
  top: 14px;
}

.sidebar-head {
  padding: 14px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.sidebar-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.sidebar-subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.sidebar-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.settings-section {
  border: 1px solid rgba(148, 163, 184, 0.1);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.018);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-section h4 {
  margin: 0 0 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 6px;
}

.settings-hint {
  font-size: 11px;
  color: var(--color-text-disabled, var(--color-text-muted));
  line-height: 1.5;
  margin: 0;
}

.settings-link-btn {
  align-self: flex-start;
  margin-top: 4px;
  font-size: 12px;
}

.settings-error-banner {
  margin: 8px 12px 0;
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.1);
  color: #ffb3b3;
  font-size: 12px;
}

.settings-save-btn {
  align-self: flex-start;
  margin-top: 4px;
}

/* Plugin enable toggle */
.toggle-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.toggle-row div {
  flex: 1;
  min-width: 0;
}

.toggle-row strong {
  display: block;
  font-size: 13px;
  color: var(--color-text-primary);
  margin-bottom: 3px;
}

.toggle-row p {
  font-size: 11px;
  color: var(--color-text-muted);
  margin: 0;
  line-height: 1.4;
}

.toggle-btn {
  flex-shrink: 0;
  height: 30px;
  min-width: 72px;
  border-radius: 6px;
  border: 1px solid;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  padding: 0 10px;
  transition: all 0.2s;
}

.toggle-btn.on {
  border-color: rgba(69, 214, 148, 0.42);
  background: rgba(69, 214, 148, 0.16);
  color: #83f0bb;
}

.toggle-btn.off {
  border-color: rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.1);
  color: #ffadad;
}

.toggle-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* Status rows */
.status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  min-height: 26px;
}

.status-row > span:first-child {
  color: var(--color-text-muted);
}

/* Number + checkbox fields */
.number-field {
  display: grid;
  gap: 5px;
  font-size: 12px;
}

.number-field > span {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.number-field > em {
  font-style: normal;
  font-size: 10px;
  color: var(--color-text-disabled, var(--color-text-muted));
  line-height: 1.4;
}

.settings-input {
  height: 32px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-text-primary);
  padding: 0 8px;
  font-size: 12px;
  width: 100%;
  outline: none;
}

.settings-input:focus {
  border-color: rgba(82, 145, 255, 0.5);
  box-shadow: 0 0 0 2px rgba(82, 145, 255, 0.12);
}

.settings-input:disabled {
  opacity: 0.5;
}

.checkbox-field {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  cursor: pointer;
  padding: 6px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.checkbox-field:last-of-type {
  border-bottom: none;
}

.checkbox-field input[type="checkbox"] {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  margin-top: 2px;
  accent-color: var(--color-brand-primary, #45d694);
}

.checkbox-field > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.checkbox-field strong {
  font-size: 12px;
  color: var(--color-text-primary);
  font-weight: 500;
}

.checkbox-field span {
  font-size: 10px;
  color: var(--color-text-muted);
  line-height: 1.4;
}

/* Action buttons row */
.action-buttons {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

/* Rules overview */
.rules-overview {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.rules-group strong {
  display: block;
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.rule-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
  padding: 3px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
}

.no-rules {
  font-size: 11px;
  color: var(--color-text-disabled, var(--color-text-muted));
  font-style: italic;
}

/* ===== Record cards ===== */
.record-card {
  border: 1px solid rgba(148, 163, 184, 0.14);
  border-radius: 8px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.024);
  display: grid;
  gap: 8px;
}

.record-card.danger {
  border-color: rgba(255, 92, 92, 0.28);
  background: rgba(255, 92, 92, 0.045);
}

.record-head strong,
.record-head span,
.record-meta span {
  display: block;
}

.record-head strong {
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--color-text-primary);
}

.reason {
  white-space: pre-line;
  margin: 0;
}

.squad-row {
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(160px, 1.2fr) minmax(90px, 0.8fr) minmax(70px, 0.5fr) auto auto;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid rgba(148, 163, 184, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.022);
}

.squad-row strong,
.squad-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.squad-row strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 13px;
}

.squad-row span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.empty-state {
  display: grid;
  place-items: center;
  min-height: 160px;
  color: var(--color-text-muted);
  text-align: center;
}

.empty-state.compact {
  min-height: 100px;
}

/* ===== Pills & tags ===== */
.pill,
.tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 8px;
  border-radius: 999px;
  border: 1px solid rgba(148, 163, 184, 0.2);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  font-size: 11px;
  white-space: nowrap;
}

.pill[data-tone="ok"] {
  border-color: rgba(69, 214, 148, 0.38);
  color: #83f0bb;
}

.pill[data-tone="warning"] {
  border-color: rgba(245, 190, 80, 0.42);
  color: #ffd27a;
}

.pill[data-tone="danger"],
.pill.danger {
  border-color: rgba(255, 92, 92, 0.38);
  color: #ffadad;
}

.pill[data-tone="muted"] {
  color: var(--color-text-muted);
}

.tag {
  color: var(--color-text-muted);
}

.danger-text {
  color: #ffadad !important;
}

.pass-text {
  color: #83f0bb !important;
}

/* ===== Whitelist modal ===== */
.whitelist-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: grid;
  place-items: center;
  padding: 16px;
  background: rgba(3, 7, 18, 0.72);
  backdrop-filter: blur(12px);
}

.whitelist-modal {
  width: min(560px, 100%);
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 8px;
  background: linear-gradient(180deg, rgba(15, 23, 42, 0.98), rgba(10, 15, 28, 0.98));
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.36);
  display: grid;
  gap: 16px;
  padding: 18px;
}

.whitelist-modal-head h2 {
  margin: 0;
  font-size: 18px;
  color: var(--color-text-primary);
}

.whitelist-modal-head p {
  margin: 6px 0 0;
  color: var(--color-text-muted);
  font-size: 12px;
  line-height: 1.5;
}

.whitelist-modal-body {
  display: grid;
  gap: 12px;
}

.modal-field {
  display: grid;
  gap: 8px;
}

.modal-field span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.modal-input {
  width: 100%;
  min-height: 40px;
  border-radius: 8px;
  border: 1px solid rgba(148, 163, 184, 0.22);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  padding: 0 12px;
  outline: none;
}

.modal-summary {
  display: grid;
  gap: 4px;
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(148, 163, 184, 0.16);
  background: rgba(255, 255, 255, 0.03);
}

.modal-summary span,
.modal-summary small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.modal-summary strong {
  color: var(--color-text-primary);
  font-size: 14px;
}

.modal-error {
  border-radius: 8px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 92, 92, 0.34);
  background: rgba(255, 92, 92, 0.12);
  color: #ffb3b3;
  font-size: 12px;
}

/* ===== Transitions ===== */
.slide-right-enter-active,
.slide-right-leave-active {
  transition: all 0.25s ease;
}

.slide-right-enter-from,
.slide-right-leave-to {
  transform: translateX(24px);
  opacity: 0;
}

/* ===== Responsive ===== */
@media (max-width: 1400px) {
  .overview-secondary-band {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 1320px) {
  .overview-hero {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .health-panel {
    grid-column: span 2;
  }

  .ops-band {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .flow-settings-sidebar {
    width: 290px;
  }
}

@media (max-width: 1180px) {
  .overview-grid,
  .content-grid {
    grid-template-columns: 1fr;
    grid-auto-rows: minmax(280px, auto);
  }

  .records-panel {
    grid-row: auto;
  }

  .flow-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sub-page-workspace {
    flex-direction: column;
  }

  .flow-settings-sidebar {
    width: 100%;
    max-height: none;
    position: static;
  }
}

@media (max-width: 900px) {
  .overview-hero,
  .ops-band,
  .overview-secondary-band {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .health-panel {
    grid-column: 1 / -1;
  }

  .flow-stage,
  .squad-row {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .tracking-page {
    padding: 10px;
  }

  .overview-hero,
  .ops-band,
  .overview-secondary-band,
  .flow-tabs {
    grid-template-columns: 1fr;
  }

  .whitelist-modal {
    max-height: calc(var(--app-viewport-height) - 24px);
    overflow: auto;
  }
}
</style>
