<template>
  <AppPage class="squad-name-policy-page" full-bleed>
    <!-- Top toolbar of the workspace -->
    <WorkspaceToolbar>
      <div class="toolbar-left">
        <span class="page-title">队名规范工作区</span>
        <div v-if="state" class="toolbar-badges">
          <AppStatusBadge tone="idle">载具: {{ state.stats.entries }}</AppStatusBadge>
          <AppStatusBadge tone="idle">别名: {{ state.stats.aliases }}</AppStatusBadge>
          <AppStatusBadge tone="idle">关键字: {{ state.stats.keywordCells }}</AppStatusBadge>
          <AppStatusBadge tone="idle">步兵白名单: {{ state.stats.infantryNames + state.stats.specialInfantryNames }}</AppStatusBadge>
        </div>
        <div v-if="guardState" class="toolbar-badges">
          <AppStatusBadge :tone="guardState.enabled ? 'ok' : 'idle'">
            Guard: {{ guardState.enabled ? "开启" : "关闭" }}
          </AppStatusBadge>
          <AppStatusBadge :tone="guardState.detectLogCreated ? 'ok' : 'idle'">
            日志建队: {{ guardState.detectLogCreated ? "开启" : "关闭" }}
          </AppStatusBadge>
          <AppStatusBadge :tone="patrolState?.enabled ? 'warn' : 'idle'">
            RCON 巡逻: {{ patrolState?.enabled ? "开启" : "关闭" }}
          </AppStatusBadge>
        </div>
      </div>
      <template #actions>
        <button type="button" class="toolbar-btn" :disabled="loading" @click="loadState">
          {{ loading ? "刷新中.." : "刷新" }}
        </button>
        <router-link to="/debug/squad-name-policy/rules" class="toolbar-btn primary">
          {{ canSave ? "规则维护 (Excel)" : "查看规则 (Excel)" }}
        </router-link>
      </template>
    </WorkspaceToolbar>

    <!-- Error Banner -->
    <div v-if="error" class="banner error-banner">{{ error }}</div>

    <!-- Main split layout workspace -->
    <div class="workspace-body">
      <AppSplitLayout :right-fixed="true">
        <!-- Left Pane: Interactive Test + Rule Browser -->
        <template #left>
          <!-- Test Input & Presets -->
          <AppCard title="队名合规性校验" description="独立测试载具队或步兵队的队名规范，实时展示匹配机制与推演路径。">
            <div class="test-workspace">
              <!-- Search/Test Input Field -->
              <div class="test-input-row">
                <div class="input-wrapper">
                  <input
                    v-model.trim="testName"
                    type="text"
                    placeholder="输入待测队名 (例如 BMP队 / BTR1 / 96b / 步兵)..."
                    @keyup.enter="runTest"
                    class="policy-input"
                  />
                  <button
                    v-if="testName"
                    type="button"
                    class="clear-input-btn"
                    @click="testName = ''; testResult = null"
                  >
                    ✕
                  </button>
                </div>
                <button
                  type="button"
                  class="test-run-btn"
                  :disabled="testing || !testName"
                  @click="runTest"
                >
                  {{ testing ? "分析中..." : "开始分析" }}
                </button>
              </div>

              <!-- Quick Presets -->
              <div class="presets-section">
                <div class="presets-label">快速预设测试点：</div>
                <div class="presets-groups">
                  <div class="preset-group">
                    <span class="group-tag">载具队:</span>
                    <button
                      v-for="name in ['BMP', 'BTR-80', '96b', 'T72', 'MATV', 'BMP1队', '99a坦克']"
                      :key="name"
                      type="button"
                      class="preset-pill"
                      @click="triggerPresetTest(name)"
                    >
                      {{ name }}
                    </button>
                  </div>
                  <div class="preset-group">
                    <span class="group-tag">步兵/特种:</span>
                    <button
                      v-for="name in ['步兵一队', '步兵', '防空队', '哈特', '后勤队', 'squad 1']"
                      :key="name"
                      type="button"
                      class="preset-pill preset-pill--info"
                      @click="triggerPresetTest(name)"
                    >
                      {{ name }}
                    </button>
                  </div>
                  <div class="preset-group">
                    <span class="group-tag">违规/偏僻:</span>
                    <button
                      v-for="name in ['1', '12345', 'BPM', 'BMP队123', '哈哈哈哈']"
                      :key="name"
                      type="button"
                      class="preset-pill preset-pill--warn"
                      @click="triggerPresetTest(name)"
                    >
                      {{ name }}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Pipeline Visualizer -->
            <div v-if="testResult" class="pipeline-section">
              <div class="section-title">规范决策流水线 (Pipeline Visualizer)</div>

              <div class="pipeline-wrapper">
                <!-- Step 1: Input Clean -->
                <div class="pipeline-node node-done">
                  <div class="node-icon">✨</div>
                  <div class="node-content">
                    <div class="node-title">1. 输入预处理</div>
                    <div class="node-meta-grid">
                      <div>
                        <span>原始队名</span>
                        <strong>{{ testResult.input }}</strong>
                      </div>
                      <div>
                        <span>标准化</span>
                        <strong>{{ testResult.normalizedInput || "-" }}</strong>
                      </div>
                      <div>
                        <span>剥离建议名</span>
                        <strong>{{ testResult.normalizedStrippedInput || "-" }}</strong>
                      </div>
                      <div>
                        <span>剥离后缀</span>
                        <span class="badge" :class="testResult.suffixStripped ? 'badge--info' : 'badge--neutral'">
                          {{ testResult.suffixStripped ? "已剥离" : "未剥离" }}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Step 2: Classifier -->
                <div class="pipeline-node node-done">
                  <div class="node-icon">🏷️</div>
                  <div class="node-content">
                    <div class="node-title">2. 决策树分类</div>
                    <div class="node-meta-grid">
                      <div class="wide-col">
                        <span>性质划分</span>
                        <strong v-if="testResult.classification">
                          <span class="nature-pill" :data-nature="testResult.classification.nature">
                            {{ natureLabel(testResult.classification.nature) }}
                          </span>
                        </strong>
                        <strong v-else-if="testResult.valid && testResult.matched">
                          <span class="nature-pill" data-nature="vehicle">载具队</span>
                        </strong>
                        <strong v-else>
                          <span class="nature-pill" data-nature="other">未知/疑似载具</span>
                        </strong>
                      </div>
                      <div class="wide-col">
                        <span>决策依据</span>
                        <span class="reason-text">
                          {{ testResult.classification?.reason || testResult.reason || "未命中步兵或默认规则，进入相似度匹配流程。" }}
                        </span>
                      </div>
                      <div v-if="testResult.classification">
                        <span>细分类型</span>
                        <strong>{{ testResult.classification.typeLabel || testResult.classification.label || "-" }}（{{ testResult.classification.typeId || "-" }}）</strong>
                      </div>
                      <div v-if="testResult.classification">
                        <span>命中规则</span>
                        <strong>{{ testResult.classification.ruleId || "启发式回退" }}</strong>
                      </div>
                      <div v-if="testResult.classification">
                        <span>人数上限</span>
                        <strong>{{ testResult.classification.effectiveMaxPlayers ?? "不限" }} · {{ maxPlayersSourceLabel(testResult.classification.maxPlayersSource) }}</strong>
                      </div>
                      <div v-if="testResult.classification" class="wide-col">
                        <span>资产路径</span>
                        <strong class="reason-text">{{ testResult.classification.assetPath || "无" }}</strong>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Step 3: Result Banner -->
                <div class="pipeline-node" :class="decisionBannerValid ? 'node-success' : 'node-warning'">
                  <div class="node-icon">{{ decisionBannerValid ? "✓" : "✕" }}</div>
                  <div class="node-content">
                    <div class="node-title">3. 规范判定判定</div>
                    <div class="decision-banner" :data-valid="decisionBannerValid">
                      <div class="decision-title">
                        {{ decisionBannerValid ? "符合运行时规范" : "会触发运行时处置" }}
                      </div>
                      <div class="decision-desc">
                        {{ decisionBannerReason }}
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Step 4: Details & Suggestions -->
                <div v-if="testResult.matched || testResult.suggestions.length || displayedWarningMessages.length || guardPreview" class="pipeline-node node-done">
                  <div class="node-icon">🔍</div>
                  <div class="node-content">
                    <div class="node-title">4. 实体解析与建议</div>
                    
                    <!-- Matched details -->
                    <div v-if="testResult.matched" class="matched-box">
                      <div class="matched-header">
                        <span class="box-label">已命中标准配置载具</span>
                        <span class="matched-kind-tag" :data-kind="testResult.matched.matchedKind">
                          方式: {{ translateMatchedKind(testResult.matched.matchedKind) }} ({{ testResult.matched.matchedValue }})
                        </span>
                      </div>
                      <div class="matched-body">
                        <div class="vehicle-canonical-name">{{ testResult.matched.name }}</div>
                        <div class="vehicle-specs">
                          <span class="spec-tag">{{ testResult.matched.faction || "通用" }}</span>
                          <span class="spec-tag type-tag">{{ testResult.classification?.typeLabel || testResult.matched.typeLabel || testResult.matched.vehicleType || "未定义类型" }}</span>
                          <span v-if="testResult.matched.asset" class="spec-tag asset-tag mono">{{ testResult.matched.asset }}</span>
                        </div>
                      </div>
                    </div>

                    <!-- Suggestion Deck -->
                    <div v-if="testResult.suggestions.length" class="suggestions-deck">
                      <div class="deck-title">候选建议载具 (按匹配度排序)：</div>
                      <div class="suggestion-grid">
                        <div
                          v-for="item in testResult.suggestions"
                          :key="`${item.source}:${item.id}`"
                          class="suggestion-item"
                        >
                          <div class="suggestion-top">
                            <span class="score-badge" :class="getScoreClass(item.score)">
                              {{ formatScore(item.score) }}
                            </span>
                            <span class="source-tag" :class="item.source">
                              {{ item.source === 'keyword' ? '关键字' : '相似算法' }}
                            </span>
                          </div>
                          <div class="suggestion-name">{{ item.name }}</div>
                          <div class="suggestion-footer">
                            <span>{{ item.faction || "通用" }} · {{ item.vehicleType }}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- Warning Info -->
                    <div
                      v-for="(message, index) in displayedWarningMessages"
                      :key="`warning-${index}`"
                      class="warning-alert"
                    >
                      <span class="alert-icon">⚠</span>
                      <span class="alert-text">{{ message }}</span>
                    </div>

                    <div v-if="guardPreview" class="guard-preview-card">
                      <div class="guard-preview-header">
                        <span class="box-label">运行时处置预览</span>
                        <span class="badge" :class="guardPreview.violation ? 'badge--warn' : 'badge--success'">
                          {{ guardPreview.violation ? "会判定违规" : "不会触发处置" }}
                        </span>
                      </div>
                      <div class="guard-preview-grid">
                        <div>
                          <span>动作</span>
                          <strong>{{ guardPreview.action || "-" }}</strong>
                        </div>
                        <div>
                          <span>建议消息数</span>
                          <strong>{{ guardPreview.warningMessages.length }}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </AppCard>

          <!-- Rules Browser -->
          <AppCard title="规范规则浏览器" description="快速检索当前加载的所有合法队名与规则。">
            <!-- Tabs Toolbar -->
            <div class="browser-toolbar">
              <div class="tabs-buttons">
                <button
                  v-for="tab in [
                    { id: 'vehicles', label: '载具队名 (Excel)' },
                    { id: 'infantry', label: '普通步兵白名单' },
                    { id: 'special', label: '特种步兵白名单' },
                    { id: 'regex', label: '默认命名正则' }
                  ]"
                  :key="tab.id"
                  type="button"
                  class="tab-btn"
                  :class="{ active: activeTab === tab.id }"
                  @click="activeTab = tab.id; rulesLimit = 50"
                >
                  {{ tab.label }}
                </button>
              </div>

              <!-- Search input -->
              <div class="tab-search-box">
                <input
                  v-model="ruleSearchQuery"
                  type="text"
                  placeholder="搜索规则内容/别名/关键字..."
                  class="search-input"
                />
              </div>
            </div>

            <!-- Tab content: Vehicles -->
            <div v-if="activeTab === 'vehicles'" class="tab-panel">
              <!-- Filter Selectors -->
              <div class="filters-row">
                <div class="filter-field">
                  <span>阵营筛选:</span>
                  <select v-model="factionFilter">
                    <option v-for="f in factionOptions" :key="f" :value="f">{{ f }}</option>
                  </select>
                </div>
                <div class="filter-field">
                  <span>载具类型:</span>
                  <select v-model="vehicleTypeFilter">
                    <option v-for="t in typeOptions" :key="t" :value="t">{{ t }}</option>
                  </select>
                </div>
                <div class="filter-stats">
                  已匹配 <strong>{{ filteredEntries.length }}</strong> 条记录
                </div>
              </div>

              <!-- Table -->
              <AppTable v-if="filteredEntries.length" compact class="rules-table-container">
                <thead>
                  <tr>
                    <th style="width: 80px;">阵营</th>
                    <th style="width: 100px;">类型</th>
                    <th style="width: 140px;">标准名</th>
                    <th>允许别名 (Aliases)</th>
                    <th>匹配关键字 (Keywords)</th>
                    <th style="width: 120px;">资产代码</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="entry in visibleFilteredEntries" :key="entry.id">
                    <td>
                      <span class="badge badge--faction">{{ entry.faction || "通用" }}</span>
                    </td>
                    <td>
                      <span class="badge badge--type">{{ entry.vehicleType || "未定义" }}</span>
                    </td>
                    <td>
                      <strong class="entry-canonical">{{ entry.name }}</strong>
                    </td>
                    <td>
                      <div class="tags-wrap">
                        <span v-if="!entry.aliases?.length" class="empty-text">-</span>
                        <span v-for="alias in entry.aliases" :key="alias" class="tag alias-tag">
                          {{ alias }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="tags-wrap">
                        <span v-if="!entry.keywords?.length" class="empty-text">-</span>
                        <span v-for="kw in entry.keywords" :key="kw" class="tag keyword-tag">
                          {{ kw }}
                        </span>
                      </div>
                    </td>
                    <td class="mono font-sm text-muted">
                      {{ entry.asset || "-" }}
                    </td>
                  </tr>
                </tbody>
              </AppTable>
              <div v-else class="empty-rules-block">
                无匹配的载具规则。
              </div>

              <!-- Load more -->
              <div v-if="filteredEntries.length > visibleFilteredEntries.length" class="load-more-row">
                <button type="button" class="load-more-btn" @click="loadMoreRules">
                  显示更多 (当前 {{ visibleFilteredEntries.length }} / {{ filteredEntries.length }})
                </button>
              </div>
            </div>

            <!-- Tab content: Infantry Whitelist -->
            <div v-if="activeTab === 'infantry'" class="tab-panel">
              <div class="chips-container-desc">
                当玩家创建此类小队时，直接判定为符合规范的“普通步兵小队”，系统不会发送任何警告，也不会拆分命名。
              </div>
              <div v-if="filteredInfantryNames.length" class="chips-grid">
                <span
                  v-for="name in filteredInfantryNames"
                  :key="name"
                  class="chip-tag chip-tag--success"
                  @click="triggerPresetTest(name)"
                  title="点击测试此队名"
                >
                  {{ name }} <span class="tag-hover-icon">🔍</span>
                </span>
              </div>
              <div v-else class="empty-rules-block">
                未配置普通步兵白名单。
              </div>
            </div>

            <!-- Tab content: Special Infantry Whitelist -->
            <div v-if="activeTab === 'special'" class="tab-panel">
              <div class="chips-container-desc">
                当玩家创建此类小队时，判定为合规的“特种职能步兵队”（如防空、工兵等），跳过载具名匹配。
              </div>
              <div v-if="filteredSpecialInfantryNames.length" class="chips-grid">
                <span
                  v-for="name in filteredSpecialInfantryNames"
                  :key="name"
                  class="chip-tag chip-tag--primary"
                  @click="triggerPresetTest(name)"
                  title="点击测试此队名"
                >
                  {{ name }} <span class="tag-hover-icon">🔍</span>
                </span>
              </div>
              <div v-else class="empty-rules-block">
                未配置特种步兵白名单。
              </div>
            </div>

            <!-- Tab content: Default patterns -->
            <div v-if="activeTab === 'regex'" class="tab-panel">
              <div class="chips-container-desc">
                系统内置默认生成的战局队伍命名正则表达式，匹配成功即视为系统默认步兵队。
              </div>
              <div v-if="filteredDefaultNamePatterns.length" class="regex-patterns-list">
                <div
                  v-for="pattern in filteredDefaultNamePatterns"
                  :key="pattern"
                  class="regex-item"
                >
                  <span class="regex-tag">REGEX</span>
                  <code>{{ pattern }}</code>
                </div>
              </div>
              <div v-else class="empty-rules-block">
                无默认正则样式。
              </div>
            </div>
          </AppCard>
        </template>

        <!-- Right Pane: Stats, Meta & Policy Guidelines -->
        <template #right>
          <!-- Stats Panel -->
          <AppCard title="规则运行指标">
            <div class="stats-panel-content">
              <div class="dashboard-stats-grid">
                <div class="dashboard-stat-card">
                  <span class="stat-label">载具模板</span>
                  <strong class="stat-value">{{ state?.stats.entries ?? 0 }}</strong>
                </div>
                <div class="dashboard-stat-card">
                  <span class="stat-label">匹配别名</span>
                  <strong class="stat-value">{{ state?.stats.aliases ?? 0 }}</strong>
                </div>
                <div class="dashboard-stat-card">
                  <span class="stat-label">匹配关键字</span>
                  <strong class="stat-value">{{ state?.stats.keywordCells ?? 0 }}</strong>
                </div>
                <div class="dashboard-stat-card">
                  <span class="stat-label">阵营/载具类型</span>
                  <strong class="stat-value text-sm">
                    {{ state?.stats.factions ?? 0 }} 阵营 / {{ state?.stats.vehicleTypes ?? 0 }} 类型
                  </strong>
                </div>
              </div>
            </div>
          </AppCard>

          <AppCard title="运行时 Guard">
            <div v-if="guardState" class="meta-details-list">
              <div class="meta-row">
                <span class="lbl">模块状态</span>
                <span class="val text-right font-semibold">{{ guardState.enabled ? "启用" : "停用" }}</span>
              </div>
              <div class="meta-row">
                <span class="lbl">日志建队检测</span>
                <span class="val text-right font-semibold">{{ guardState.detectLogCreated ? "开启" : "关闭" }}</span>
              </div>
              <div class="meta-row">
                <span class="lbl">RCON 巡逻</span>
                <span class="val text-right font-semibold">
                  {{ patrolState?.enabled ? `开启 / ${patrolState.intervalMs}ms` : "默认关闭" }}
                </span>
              </div>
              <div class="meta-row">
                <span class="lbl">动作策略</span>
                <span class="val text-right mono font-semibold">{{ guardState.action }}</span>
              </div>
              <div class="meta-row">
                <span class="lbl">最近判定/违规</span>
                <span class="val text-right font-semibold">
                  {{ guardState.stats.evaluated }} / {{ guardState.stats.violations }}
                </span>
              </div>
              <div class="meta-row">
                <span class="lbl">解散/警告</span>
                <span class="val text-right font-semibold">
                  {{ guardState.stats.disbanded }} / {{ guardState.stats.warningsSent }}
                </span>
              </div>
              <div class="meta-row">
                <span class="lbl">去重跳过/错误</span>
                <span class="val text-right font-semibold">
                  {{ guardState.stats.duplicatesSkipped }} / {{ guardState.stats.errors }}
                </span>
              </div>
              <div class="guard-actions-row">
                <button type="button" class="toolbar-btn" :disabled="loading" @click="loadState">
                  刷新 Guard
                </button>
                <button
                  v-if="canSave"
                  type="button"
                  class="toolbar-btn"
                  :disabled="clearingGuard"
                  @click="clearGuardRecent"
                >
                  {{ clearingGuard ? "清空中..." : "清空最近记录" }}
                </button>
              </div>
            </div>
            <div v-else class="empty-rules-block">
              运行时 Guard 状态暂不可用。
            </div>
          </AppCard>

          <!-- File Metadata Card -->
          <AppCard title="源文件与同步信息">
            <div class="meta-details-list">
              <div class="meta-row">
                <span class="lbl">规范文件</span>
                <span class="val font-sm font-semibold text-right" :title="state?.policyPath">
                  {{ state?.source.fileName || "-" }}
                </span>
              </div>
              <div class="meta-row">
                <span class="lbl">存储类型</span>
                <span class="val font-sm font-semibold capitalize text-right">
                  {{ state?.source.type || "unknown" }}
                </span>
              </div>
              <div class="meta-row" v-if="state?.source.sheetName">
                <span class="lbl">工作表 (Sheet)</span>
                <span class="val text-right font-semibold">{{ state.source.sheetName }}</span>
              </div>
              <div class="meta-row">
                <span class="lbl">版本号</span>
                <span class="val text-right mono font-semibold">{{ state?.version ?? 0 }}</span>
              </div>
              <div class="meta-row">
                <span class="lbl">同步于</span>
                <span class="val text-right font-sm font-semibold">{{ formatTime(state?.importedAt) }}</span>
              </div>
              <div class="meta-row">
                <span class="lbl">最新保存</span>
                <span class="val text-right font-sm font-semibold">{{ formatTime(state?.updatedAt) }}</span>
              </div>
            </div>
          </AppCard>

          <!-- Guidelines -->
          <AppCard title="队名规范处理逻辑说明">
            <div class="guidelines-text">
              <p>为了维护载具专队秩序，当游戏内玩家建立小队时，系统将遵循以下匹配层级进行拦截验证：</p>
              <ol class="workflow-ol">
                <li>
                  <strong class="workflow-highlight workflow-highlight--default">默认命名匹配：</strong>
                  如果小队名完全命中 <code>Squad 1</code>、<code>小队 2</code> 等默认分配名，直接通过。
                </li>
                <li>
                  <strong class="workflow-highlight workflow-highlight--admin">管理员小队：</strong>
                  如果小队名为 <code>Admin</code> 或 <code>OP</code>，直接通过。
                </li>
                <li>
                  <strong class="workflow-highlight workflow-highlight--infantry">步兵白名单匹配：</strong>
                  如果小队名命中 <code>步兵</code> 或 <code>哈特</code> 等白名单名，标记为步兵小队通过。
                </li>
                <li>
                  <strong class="workflow-highlight workflow-highlight--canonical">载具别名精确匹配：</strong>
                  如果队名命中任意配置载具的“标准队名”或“允许别名”（如 <code>BMP</code>、<code>96B</code> 等，剥离 <code>队</code>/<code>SQUAD</code> 后缀后），直接通过。
                </li>
                <li>
                  <strong class="workflow-highlight workflow-highlight--keyword">非专队相似度检查：</strong>
                  若未命中以上任何规则，将使用关键字和文本相似度算法扫描载具库。如有高相似度载具，系统将发出提示：“<i>您可能想建立 [载具名] 队</i>”，并视为违规载具队名，游戏内会发送解散警告。
                </li>
              </ol>
            </div>
          </AppCard>
        </template>
      </AppSplitLayout>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { apiGet, apiPost, ApiError } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import AppSplitLayout from "../components/common/AppSplitLayout.vue";
import AppCard from "../components/common/AppCard.vue";
import AppTable from "../components/common/AppTable.vue";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

type PolicyEntry = {
  id: string;
  faction: string;
  vehicleType: string;
  typeId?: string;
  typeLabel?: string;
  nature?: string;
  asset: string;
  name: string;
  aliases: string[];
  keywords: string[];
  searchTokens?: string[];
};

type PolicyState = {
  ok: boolean;
  policyPath: string;
  version: number;
  source: { type: string; fileName: string; path: string; sheetName: string };
  importedAt: string | null;
  updatedAt: string | null;
  suggestionLimit: number;
  defaultNamePatterns: string[];
  infantryNames: string[];
  specialInfantryNames: string[];
  stats: {
    entries: number;
    infantryNames: number;
    specialInfantryNames: number;
    defaultNamePatterns: number;
    aliases: number;
    keywordCells: number;
    uniqueKeywords: number;
    factions: number;
    vehicleTypes: number;
  };
  entries: PolicyEntry[];
};

type PolicySuggestion = PolicyEntry & {
  source: "keyword" | "algorithm";
  score: number | null;
  reason: string;
  matchedValue: string | null;
  matchedKind: string | null;
};

type PolicyTestResult = {
  ok: boolean;
  input: string;
  normalizedInput: string;
  normalizedStrippedInput: string;
  suffixStripped: boolean;
  valid: boolean;
  reason: string;
  matched: (PolicyEntry & { matchedKind: string; matchedValue: string }) | null;
  suggestions: PolicySuggestion[];
  keywordSuggestions: PolicySuggestion[];
  algorithmSuggestions: PolicySuggestion[];
  warningMessage: string;
  warningMessages?: string[];
  classification?: {
    nature: string;
    label: string;
    typeId: string;
    typeLabel: string;
    ruleId: string;
    effectiveMaxPlayers: number | null;
    maxPlayersSource: string;
    assetPath: string;
    reason: string;
  } | null;
};

type GuardState = {
  enabled: boolean;
  detectLogCreated: boolean;
  action: string;
  dedupeTtlMs: number;
  stats: {
    evaluated: number;
    violations: number;
    disbanded: number;
    disbandFailed: number;
    warningsSent: number;
    warningsSkipped: number;
    duplicatesSkipped: number;
    errors: number;
  };
  recent: Array<Record<string, unknown>>;
};

type PatrolState = {
  enabled: boolean;
  intervalMs: number;
  dedupeTtlMs: number;
  stats: {
    evaluated: number;
    violations: number;
    allowed: number;
    duplicatesSkipped: number;
    errors: number;
  };
  recent: Array<Record<string, unknown>>;
};

type GuardSimulation = {
  event: Record<string, unknown>;
  evaluation: PolicyTestResult;
  violation: boolean;
  warningMessages: string[];
  action: string;
};

const auth = useAuthStore();
const ui = useUiStore();
const canSave = computed(() => Boolean(auth.user?.isSuperAdmin));

const loading = ref(false);
const testing = ref(false);
const clearingGuard = ref(false);
const error = ref("");
const state = ref<PolicyState | null>(null);
const guardState = ref<GuardState | null>(null);
const patrolState = ref<PatrolState | null>(null);
const testName = ref("BMP队");
const testResult = ref<PolicyTestResult | null>(null);
const guardPreview = ref<GuardSimulation | null>(null);

// Rules Browser state
const activeTab = ref("vehicles");
const ruleSearchQuery = ref("");
const factionFilter = ref("全部");
const vehicleTypeFilter = ref("全部");
const rulesLimit = ref(50);

onMounted(() => {
  void loadState();
});

async function loadState() {
  loading.value = true;
  error.value = "";
  try {
    const [policyState, runtimeGuard, runtimePatrol] = await Promise.all([
      apiGet<PolicyState>("/api/squad-name-policy/state"),
      apiGet<{ ok: boolean; data: GuardState }>("/api/modules/squad-name-policy-guard/state").catch(() => null),
      apiGet<{ ok: boolean; data: PatrolState }>("/api/modules/squad-name-policy-patrol/state").catch(() => null),
    ]);
    state.value = policyState;
    guardState.value = runtimeGuard?.data ?? null;
    patrolState.value = runtimePatrol?.data ?? null;
  } catch (err) {
    error.value = formatError(err);
  } finally {
    loading.value = false;
  }
}

async function runTest() {
  if (!testName.value) return;
  testing.value = true;
  try {
    const [policyResult, runtimePreview] = await Promise.all([
      apiPost<PolicyTestResult>("/api/squad-name-policy/test", { name: testName.value }),
      apiPost<{ ok: boolean; data: GuardSimulation }>("/api/modules/squad-name-policy-guard/simulate", {
        squadName: testName.value,
        creatorName: "Simulator",
        teamId: 1,
        squadId: 1,
      }).catch(() => null),
    ]);
    testResult.value = policyResult;
    guardPreview.value = runtimePreview?.data ?? null;
  } catch (err) {
    ui.pushToast({ title: "测试失败", message: formatError(err), tone: "error" });
  } finally {
    testing.value = false;
  }
}

async function clearGuardRecent() {
  if (!canSave.value) return;
  clearingGuard.value = true;
  try {
    await apiPost("/api/modules/squad-name-policy-guard/clear", {});
    await loadState();
    ui.pushToast({ title: "已清空", message: "队名 Guard 最近记录已清空。", tone: "ok" });
  } catch (err) {
    ui.pushToast({ title: "清空失败", message: formatError(err), tone: "error" });
  } finally {
    clearingGuard.value = false;
  }
}

function triggerPresetTest(name: string) {
  testName.value = name;
  void runTest();
}

function natureLabel(value: string) {
  return ({ infantry: "步兵", vehicle: "载具", support: "支援", logistics: "后勤", other: "其他" } as Record<string, string>)[value] || value || "未知";
}

function maxPlayersSourceLabel(value: string) {
  if (value === "rule_override") return "规则覆盖";
  if (value === "type_default") return "类型默认";
  return "无上限来源";
}

const displayedWarningMessages = computed(() => {
  if (guardPreview.value) {
    if (!guardPreview.value.violation) return [];
    return (guardPreview.value.warningMessages ?? []).filter((item) => String(item || "").trim());
  }
  const messages = testResult.value?.warningMessages?.length
    ? testResult.value.warningMessages
    : (testResult.value?.warningMessage ? [testResult.value.warningMessage] : []);
  return messages.filter((item) => String(item || "").trim());
});

const decisionBannerValid = computed(() => {
  if (guardPreview.value) return !guardPreview.value.violation;
  return Boolean(testResult.value?.valid);
});

const decisionBannerReason = computed(() => {
  if (guardPreview.value) {
    return guardPreview.value.evaluation?.reason
      || (guardPreview.value.violation ? "运行时会判定为违规并触发处置。" : "运行时不会触发处置。");
  }
  return testResult.value?.reason || "-";
});

function translateMatchedKind(kind?: string) {
  if (!kind) return "未知";
  const mapping: Record<string, string> = {
    canonical: "标准队名命中",
    alias: "别名匹配",
    keyword: "关键字推算",
    algorithm: "算法模糊匹配",
    default: "默认小队命名",
    admin: "管理员小队命名",
    infantry: "步兵白名单",
    special_infantry: "特种步兵白名单"
  };
  return mapping[kind] || kind;
}

function getScoreClass(score: number | null) {
  if (score == null) return "score-neutral";
  if (score >= 0.8) return "score-high";
  if (score >= 0.5) return "score-medium";
  return "score-low";
}

// Factions options computed
const factionOptions = computed(() => {
  if (!state.value?.entries) return ["全部"];
  const list = state.value.entries.map(e => e.faction).filter(Boolean);
  return ["全部", ...Array.from(new Set(list))];
});

// Vehicle Types options computed
const typeOptions = computed(() => {
  if (!state.value?.entries) return ["全部"];
  const list = state.value.entries.map(e => e.vehicleType).filter(Boolean);
  return ["全部", ...Array.from(new Set(list))];
});

// Filtered Entries for Tab 1
const filteredEntries = computed(() => {
  if (!state.value?.entries) return [];
  return state.value.entries.filter((e) => {
    const matchesFaction = factionFilter.value === "全部" || e.faction === factionFilter.value;
    const matchesType = vehicleTypeFilter.value === "全部" || e.vehicleType === vehicleTypeFilter.value;
    const matchesSearch = !ruleSearchQuery.value || [
      e.name,
      e.faction,
      e.vehicleType,
      e.asset,
      ...(e.aliases || []),
      ...(e.keywords || [])
    ].some((v) => String(v || "").toLowerCase().includes(ruleSearchQuery.value.toLowerCase()));
    return matchesFaction && matchesType && matchesSearch;
  });
});

const visibleFilteredEntries = computed(() => {
  return filteredEntries.value.slice(0, rulesLimit.value);
});

function loadMoreRules() {
  rulesLimit.value += 50;
}

// Whitelists filtered lists
const filteredInfantryNames = computed(() => {
  if (!state.value?.infantryNames) return [];
  if (!ruleSearchQuery.value) return state.value.infantryNames;
  return state.value.infantryNames.filter((name) =>
    name.toLowerCase().includes(ruleSearchQuery.value.toLowerCase())
  );
});

const filteredSpecialInfantryNames = computed(() => {
  if (!state.value?.specialInfantryNames) return [];
  if (!ruleSearchQuery.value) return state.value.specialInfantryNames;
  return state.value.specialInfantryNames.filter((name) =>
    name.toLowerCase().includes(ruleSearchQuery.value.toLowerCase())
  );
});

const filteredDefaultNamePatterns = computed(() => {
  if (!state.value?.defaultNamePatterns) return [];
  if (!ruleSearchQuery.value) return state.value.defaultNamePatterns;
  return state.value.defaultNamePatterns.filter((pattern) =>
    pattern.toLowerCase().includes(ruleSearchQuery.value.toLowerCase())
  );
});

function formatScore(value: number | null) {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? value : time.toLocaleString();
}

function formatError(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
</script>

<style scoped>
/* Page Layout */
.squad-name-policy-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--color-bg-page);
  overflow: hidden;
}

.workspace-body {
  flex: 1;
  min-height: 0;
  padding: 16px;
}

/* Toolbar Left */
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.toolbar-badges {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Toolbar Button styling */
.toolbar-btn {
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  padding: 0 12px;
  height: 32px;
  cursor: pointer;
  text-decoration: none;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  font-weight: 500;
}

.toolbar-btn:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.05));
  border-color: var(--color-text-secondary);
}

.toolbar-btn.primary {
  background: var(--color-brand-primary, #60a5fa);
  border-color: var(--color-brand-primary, #60a5fa);
  color: #040810;
  font-weight: 600;
}

.toolbar-btn.primary:hover {
  filter: brightness(1.1);
}

/* Error Banner */
.banner.error-banner {
  margin: 12px 16px 0;
  border: 1px solid color-mix(in srgb, var(--color-status-error) 40%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-error) 12%, transparent);
  color: var(--color-status-error);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
}

/* Interactive Test Area */
.test-workspace {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 8px;
}

.test-input-row {
  display: flex;
  gap: 10px;
}

.input-wrapper {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
}

.policy-input {
  width: 100%;
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  background: var(--color-bg-input, rgba(10, 14, 18, 0.72));
  color: var(--color-text-primary);
  padding: 10px 14px;
  padding-right: 36px;
  font-size: 14px;
  transition: all 0.2s;
}

.policy-input:focus {
  outline: none;
  border-color: var(--color-brand-primary, #60a5fa);
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.18);
}

.clear-input-btn {
  position: absolute;
  right: 10px;
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  padding: 4px;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.clear-input-btn:hover {
  color: var(--color-text-primary);
}

.test-run-btn {
  border: 1px solid var(--color-brand-primary, #60a5fa);
  background: color-mix(in srgb, var(--color-brand-primary, #60a5fa) 15%, var(--color-bg-card));
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 0 16px;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.test-run-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-brand-primary, #60a5fa) 25%, var(--color-bg-card));
}

.test-run-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  border-color: var(--color-border-default);
  background: var(--color-bg-selected, rgba(255, 255, 255, 0.02));
}

/* Presets style */
.presets-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px solid var(--color-border-subtle, rgba(255, 255, 255, 0.04));
  border-radius: 8px;
  padding: 10px 12px;
}

.presets-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 600;
}

.presets-groups {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preset-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}

.group-tag {
  font-size: 10px;
  color: var(--color-text-disabled, #66727f);
  min-width: 60px;
  font-weight: 500;
}

.preset-pill {
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: var(--color-text-secondary);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
  font-family: monospace;
  transition: all 0.15s;
}

.preset-pill:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--color-text-muted);
  color: var(--color-text-primary);
}

.preset-pill--info {
  background: rgba(96, 165, 250, 0.06);
  border-color: rgba(96, 165, 250, 0.15);
  color: #8bbefa;
}

.preset-pill--info:hover {
  background: rgba(96, 165, 250, 0.12);
  border-color: rgba(96, 165, 250, 0.3);
  color: #a3ccff;
}

.preset-pill--warn {
  background: rgba(245, 158, 11, 0.06);
  border-color: rgba(245, 158, 11, 0.15);
  color: #fad390;
}

.preset-pill--warn:hover {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
  color: #ffeaa7;
}

/* Pipeline visualizer style */
.pipeline-section {
  margin-top: 20px;
  border-top: 1px dashed var(--color-border-default);
  padding-top: 16px;
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-secondary);
  margin-bottom: 12px;
}

.pipeline-wrapper {
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
  padding-left: 10px;
}

.pipeline-wrapper::before {
  content: "";
  position: absolute;
  left: 21px;
  top: 10px;
  bottom: 24px;
  width: 2px;
  background: linear-gradient(180deg, var(--color-brand-primary, #60a5fa) 30%, var(--color-border-default) 80%);
}

.pipeline-node {
  position: relative;
  display: flex;
  gap: 16px;
  min-width: 0;
}

.node-icon {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--color-bg-card);
  border: 2px solid var(--color-border-default);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  z-index: 1;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.pipeline-node.node-done .node-icon {
  background: rgba(96, 165, 250, 0.1);
  border-color: var(--color-brand-primary, #60a5fa);
  color: var(--color-brand-primary, #60a5fa);
}

.pipeline-node.node-success .node-icon {
  background: rgba(52, 211, 153, 0.1);
  border-color: var(--color-status-online, #34d399);
  color: var(--color-status-online, #34d399);
}

.pipeline-node.node-warning .node-icon {
  background: rgba(248, 113, 113, 0.1);
  border-color: var(--color-status-error, #f87171);
  color: var(--color-status-error, #f87171);
}

.node-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.node-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-muted);
}

.node-meta-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  background: rgba(255, 255, 255, 0.012);
  border: 1px solid var(--color-border-subtle);
  border-radius: 6px;
  padding: 8px 12px;
}

.node-meta-grid div {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.node-meta-grid div span {
  font-size: 10px;
  color: var(--color-text-disabled, #66727f);
}

.node-meta-grid div strong {
  font-size: 12px;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-meta-grid .wide-col {
  grid-column: span 2;
}

.badge {
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  align-self: flex-start;
}

.badge--info {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.badge--success {
  background: rgba(52, 211, 153, 0.14);
  color: #86efac;
}

.badge--warn {
  background: rgba(245, 158, 11, 0.14);
  color: #fcd34d;
}

.badge--neutral {
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-muted);
}

/* Decision Banners */
.decision-banner {
  border: 1px solid var(--color-border-default);
  border-radius: 8px;
  padding: 12px 14px;
}

.decision-banner[data-valid="true"] {
  border-color: rgba(52, 211, 153, 0.35);
  background: rgba(52, 211, 153, 0.08);
}

.decision-banner[data-valid="false"] {
  border-color: rgba(245, 158, 11, 0.4);
  background: rgba(245, 158, 11, 0.08);
}

.decision-title {
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 2px;
}

.decision-banner[data-valid="true"] .decision-title {
  color: var(--color-status-online, #34d399);
}

.decision-banner[data-valid="false"] .decision-title {
  color: var(--color-status-warning, #f59e0b);
}

.decision-desc {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.4;
}

/* Entity details style */
.matched-box {
  background: rgba(96, 165, 250, 0.03);
  border: 1px solid rgba(96, 165, 250, 0.18);
  border-left: 3px solid var(--color-brand-primary, #60a5fa);
  border-radius: 8px;
  padding: 10px 14px;
}

.box-label {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 600;
}

.matched-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.matched-kind-tag {
  font-size: 10px;
  background: rgba(96, 165, 250, 0.1);
  color: var(--color-brand-primary, #60a5fa);
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.vehicle-canonical-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.vehicle-specs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.spec-tag {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.spec-tag.type-tag {
  background: rgba(167, 139, 250, 0.08);
  color: #a78bfa;
}

.spec-tag.asset-tag {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted);
  font-family: monospace;
}

/* Suggestion deck style */
.suggestions-deck {
  background: rgba(255, 255, 255, 0.01);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 12px;
}

.deck-title {
  font-size: 11px;
  color: var(--color-text-muted);
  font-weight: 600;
  margin-bottom: 8px;
}

.suggestion-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 8px;
}

.suggestion-item {
  border: 1px solid var(--color-border-soft, rgba(255, 255, 255, 0.06));
  background: rgba(255, 255, 255, 0.015);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.suggestion-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.score-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 4px;
  border-radius: 3px;
}

.score-high {
  background: rgba(52, 211, 153, 0.15);
  color: var(--color-status-online, #34d399);
}

.score-medium {
  background: rgba(245, 158, 11, 0.15);
  color: var(--color-status-warning, #f59e0b);
}

.score-low {
  background: rgba(255, 255, 255, 0.06);
  color: var(--color-text-muted);
}

.source-tag {
  font-size: 9px;
  color: var(--color-text-disabled);
}

.suggestion-name {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.suggestion-footer {
  font-size: 10px;
  color: var(--color-text-disabled);
}

/* Warnings and Alerts */
.warning-alert {
  background: rgba(245, 158, 11, 0.05);
  border: 1px solid rgba(245, 158, 11, 0.2);
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  gap: 8px;
  align-items: center;
}

.alert-icon {
  color: var(--color-status-warning, #f59e0b);
  font-weight: 700;
  flex-shrink: 0;
}

.alert-text {
  font-size: 12px;
  color: #fad390;
  line-height: 1.4;
  white-space: pre-line;
}

.guard-preview-card {
  margin-top: 12px;
  border: 1px solid rgba(96, 165, 250, 0.22);
  background: rgba(96, 165, 250, 0.06);
  border-radius: 8px;
  padding: 10px 12px;
}

.guard-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.guard-preview-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.guard-preview-grid span {
  display: block;
  font-size: 11px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}

.guard-preview-grid strong {
  font-size: 12px;
  color: var(--color-text-primary);
}

.guard-actions-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}

/* Guidelines Ol & Workflow styling */
.guidelines-text {
  font-size: 12px;
  line-height: 1.6;
  color: var(--color-text-secondary);
}

.workflow-ol {
  padding-left: 16px;
  margin-top: 8px;
  margin-bottom: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.workflow-ol li {
  color: var(--color-text-secondary);
}

.workflow-highlight {
  font-size: 12px;
  font-weight: 600;
}

.workflow-highlight--default { color: #8bbefa; }
.workflow-highlight--admin { color: #f59e0b; }
.workflow-highlight--infantry { color: #34d399; }
.workflow-highlight--canonical { color: #a78bfa; }
.workflow-highlight--keyword { color: #f87171; }

.nature-pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.nature-pill[data-nature="vehicle"] {
  background: rgba(96, 165, 250, 0.15);
  color: #60a5fa;
}

.nature-pill[data-nature="infantry"] {
  background: rgba(52, 211, 153, 0.15);
  color: var(--color-status-online, #34d399);
}

.nature-pill[data-nature="special_infantry"] {
  background: rgba(167, 139, 250, 0.15);
  color: #a78bfa;
}

.nature-pill[data-nature="admin"] {
  background: rgba(245, 158, 11, 0.15);
  color: #f59e0b;
}

.nature-pill[data-nature="default"] {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.nature-pill[data-nature="other"] {
  background: rgba(248, 113, 113, 0.15);
  color: var(--color-status-error, #f87171);
}

.reason-text {
  font-size: 11px;
  color: var(--color-text-muted);
  line-height: 1.45;
  display: inline-block;
}

/* Rules Browser Toolbar & Layout */
.browser-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  border-bottom: 1px solid var(--color-border-default);
  padding-bottom: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}

.tabs-buttons {
  display: flex;
  gap: 4px;
}

.tab-btn {
  background: transparent;
  border: 1px solid transparent;
  color: var(--color-text-muted);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  font-weight: 500;
}

.tab-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.03);
}

.tab-btn.active {
  background: var(--color-bg-selected, rgba(255, 255, 255, 0.05));
  border-color: var(--color-border-default);
  color: var(--color-brand-primary, #60a5fa);
  font-weight: 600;
}

.tab-search-box {
  width: 240px;
}

.search-input {
  width: 100%;
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-input, rgba(0, 0, 0, 0.2));
  color: var(--color-text-primary);
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 12px;
}

.search-input:focus {
  outline: none;
  border-color: var(--color-brand-primary, #60a5fa);
}

/* Rule table customisations */
.rules-table-container {
  max-height: 480px;
  overflow: auto;
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
}

.entry-canonical {
  font-size: 13px;
  color: var(--color-text-primary);
}

.tags-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
}

.alias-tag {
  background: rgba(96, 165, 250, 0.1);
  color: #60a5fa;
  border: 1px solid rgba(96, 165, 250, 0.18);
}

.keyword-tag {
  background: rgba(167, 139, 250, 0.1);
  color: #a78bfa;
  border: 1px solid rgba(167, 139, 250, 0.18);
}

.empty-text {
  font-size: 11px;
  color: var(--color-text-disabled);
}

.empty-rules-block {
  text-align: center;
  padding: 32px;
  color: var(--color-text-disabled);
  background: rgba(255, 255, 255, 0.005);
  border: 1px dashed var(--color-border-default);
  border-radius: 8px;
  font-size: 12px;
}

.load-more-row {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}

.load-more-btn {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-card);
  color: var(--color-text-secondary);
  border-radius: 6px;
  padding: 6px 16px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s;
}

.load-more-btn:hover {
  background: var(--color-bg-hover, rgba(255, 255, 255, 0.04));
  color: var(--color-text-primary);
}

/* Filters row */
.filters-row {
  display: flex;
  align-items: center;
  gap: 16px;
  background: rgba(255, 255, 255, 0.01);
  padding: 8px 12px;
  border-radius: 6px;
  margin-bottom: 10px;
  border: 1px solid var(--color-border-subtle);
  flex-wrap: wrap;
}

.filter-field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--color-text-muted);
}

.filter-field select {
  background: var(--color-bg-input, rgba(0, 0, 0, 0.2));
  color: var(--color-text-primary);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 11px;
  outline: none;
}

.filter-stats {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-text-muted);
}

.filter-stats strong {
  color: var(--color-brand-primary, #60a5fa);
}

/* Whitelists Chips list */
.chips-container-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin-bottom: 12px;
  line-height: 1.5;
}

.chips-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  background: rgba(255, 255, 255, 0.005);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 16px;
}

.chip-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: 1px solid transparent;
}

.chip-tag .tag-hover-icon {
  opacity: 0;
  font-size: 10px;
  transition: opacity 0.2s;
}

.chip-tag:hover .tag-hover-icon {
  opacity: 0.8;
}

.chip-tag--success {
  background: rgba(52, 211, 153, 0.08);
  border-color: rgba(52, 211, 153, 0.16);
  color: var(--color-status-online, #34d399);
}

.chip-tag--success:hover {
  background: rgba(52, 211, 153, 0.16);
  border-color: rgba(52, 211, 153, 0.35);
  box-shadow: 0 0 8px rgba(52, 211, 153, 0.15);
}

.chip-tag--primary {
  background: rgba(167, 139, 250, 0.08);
  border-color: rgba(167, 139, 250, 0.16);
  color: #a78bfa;
}

.chip-tag--primary:hover {
  background: rgba(167, 139, 250, 0.16);
  border-color: rgba(167, 139, 250, 0.35);
  box-shadow: 0 0 8px rgba(167, 139, 250, 0.15);
}

/* Regex patterns style */
.regex-patterns-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: rgba(255, 255, 255, 0.005);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 16px;
}

.regex-item {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 0, 0, 0.15);
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid var(--color-border-soft);
}

.regex-tag {
  font-size: 9px;
  font-weight: 700;
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-muted);
  padding: 1px 4px;
  border-radius: 3px;
}

.regex-item code {
  font-family: Consolas, monospace;
  font-size: 13px;
  color: #fad390;
}

/* Sidebar Analytics Stats Styles */
.stats-panel-content {
  display: flex;
  flex-direction: column;
}

.dashboard-stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.dashboard-stat-card {
  background: rgba(255, 255, 255, 0.012);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 10px;
  color: var(--color-text-disabled, #66727f);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
  line-height: 1.2;
}

.stat-value.text-sm {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
  padding-top: 4px;
}

/* Metadata list style */
.meta-details-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);
  padding-bottom: 8px;
}

.meta-row:last-child {
  border-bottom: none;
  padding-bottom: 0;
}

.meta-row .lbl {
  color: var(--color-text-muted);
}

.meta-row .val {
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

/* Font helpers */
.font-sm { font-size: 11px; }
.font-semibold { font-weight: 600; }
.mono { font-family: monospace; }
.text-right { text-align: right; }
.capitalize { text-transform: capitalize; }

@media (max-width: 1100px) {
  .workspace-body {
    overflow: auto;
  }

  .toolbar-left,
  .toolbar-badges {
    flex-wrap: wrap;
  }

  .node-meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 640px) {
  .workspace-body {
    padding: 10px;
  }

  .toolbar-left {
    width: 100%;
    align-items: flex-start;
    flex-direction: column;
    gap: 8px;
  }

  .toolbar-badges {
    gap: 6px;
  }

  .banner.error-banner {
    margin: 8px 10px 0;
    overflow-wrap: anywhere;
  }

  .test-input-row,
  .browser-toolbar,
  .matched-header,
  .guard-preview-header {
    align-items: stretch;
    flex-direction: column;
  }

  .test-run-btn,
  .tab-search-box,
  .tabs-buttons {
    width: 100%;
  }

  .tabs-buttons {
    overflow-x: auto;
  }

  .tab-btn {
    flex: 0 0 auto;
  }

  .node-meta-grid,
  .guard-preview-grid,
  .dashboard-stats-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .node-meta-grid .wide-col {
    grid-column: auto;
  }

  .node-meta-grid div strong,
  .meta-row .val {
    max-width: 100%;
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .pipeline-wrapper {
    padding-left: 0;
  }

  .pipeline-wrapper::before {
    left: 11px;
  }

  .pipeline-node {
    gap: 10px;
  }

  .suggestion-grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
