<template>
  <section class="settings-section reserve-slots-section">
    <div class="reserve-head">
      <div class="reserve-head-copy">
        <h3>预留位管理</h3>
        <p>手动续期、CDK 批次发放和激活记录都在这里处理。</p>
      </div>
      <div class="reserve-actions">
        <button type="button" class="reserve-btn primary" :disabled="!canEdit || importing" @click="syncFromAdmin">
          {{ importing ? "同步中..." : "从管理员文件同步" }}
        </button>
        <button type="button" class="reserve-btn" :disabled="loading || exporting" @click="exportCsv">
          导出 CSV
        </button>
        <button type="button" class="reserve-btn" :disabled="!canEdit || importing" @click="triggerImportFile">
          导入 CSV
        </button>
        <input ref="importInput" class="hidden-input" type="file" accept=".csv,text/csv" @change="onImportFileChange">
      </div>
    </div>

    <div v-if="loading" class="reserve-state-box">正在加载预留位数据...</div>
    <div v-else-if="error" class="reserve-state-box error">
      <span>{{ error }}</span>
      <button type="button" class="reserve-mini-btn" @click="loadAll(true)">重试</button>
    </div>

    <template v-else>
      <div v-if="notice" class="reserve-notice">{{ notice }}</div>

      <div class="reserve-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.key"
          type="button"
          class="reserve-tab"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
        >
          {{ tab.label }}
        </button>
      </div>

      <!-- 手动预留位 TAB -->
      <section v-if="activeTab === 'manual'" class="reserve-tab-panel">
        <div class="reserve-summary-grid">
          <div class="reserve-summary-card">
            <span>总人数</span>
            <strong>{{ state?.summary?.memberCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card active">
            <span>有效</span>
            <strong>{{ state?.summary?.activeCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card expired">
            <span>过期</span>
            <strong>{{ state?.summary?.expiredCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card subtle">
            <span>管理员文件</span>
            <strong>{{ state?.adminFilePath ? "已配置" : "未配置" }}</strong>
          </div>
        </div>

        <AppSplitLayout class="reserve-workspace" right-fixed>
          <template #left>
            <AppCard padding="sm" title="预留位名单" body-mode="scroll" overflow="auto">
              <template #actions>
                <div class="list-header-actions-row">
                  <span class="reserve-section-stat">{{ filteredMemberRows.length }} / {{ memberRows.length }}</span>
                  <button
                    v-if="canEdit"
                    type="button"
                    class="reserve-btn danger-btn sm"
                    :disabled="deletingExpired || !state?.summary?.expiredCount"
                    @click="confirmRemoveExpiredMembers"
                  >
                    🗑️ {{ deletingExpired ? "删除中..." : "清理过期预留位" }}
                  </button>
                </div>
              </template>

              <div class="reserve-list-header-sticky">
                <div class="reserve-filter-row">
                  <input v-model.trim="filterText" class="reserve-input search-input" type="search" placeholder="搜索玩家 / Steam64 / 预留位组">
                  <select v-model="statusFilter" class="reserve-select filter-select">
                    <option value="all">全部状态</option>
                    <option value="active">仅有效</option>
                    <option value="expired">仅过期</option>
                  </select>
                </div>

                <div class="reserve-meta-strip">
                  <span>本地文件：{{ state?.localReserveFileExists ? "已存在" : "不存在" }}</span>
                  <span>上次同步：{{ formatDate(state?.lastImportedAt) }}</span>
                </div>
              </div>

              <div v-if="!filteredMemberRows.length" class="reserve-empty">暂无匹配的预留位数据。</div>
              <div v-else class="reserve-list-scroll">
                <div class="reserve-list-grid reserve-list-grid-head">
                  <span>玩家</span>
                  <span>Steam64</span>
                  <span>预留位组</span>
                  <span>到期时间</span>
                  <span>状态</span>
                </div>

                <article
                  v-for="member in filteredMemberRows"
                  :key="member.rawLine || member.steamId"
                  class="reserve-row"
                  :class="{ active: selectedMember?.steamId === member.steamId, expired: member.isExpired }"
                  @click="selectedSteamId = member.steamId"
                >
                  <div class="reserve-list-grid">
                    <div class="reserve-cell reserve-player-cell">
                      <strong class="selectable">{{ member.name || "未命名玩家" }}</strong>
                    </div>
                    <div class="reserve-cell mono selectable">{{ member.steamId }}</div>
                    <div class="reserve-cell selectable">{{ member.group }}</div>
                    <div class="reserve-cell expiry-cell selectable">{{ member.expireAt ?? "未设置" }}</div>
                    <div class="reserve-cell reserve-state-cell">
                      <span class="reserve-pill" :class="member.isExpired ? 'expired' : 'active'">
                        {{ member.isExpired ? "已过期" : "有效" }}
                      </span>
                      <small class="remaining-text">{{ getRemainingText(member) }}</small>
                    </div>
                  </div>
                </article>
              </div>
            </AppCard>
          </template>

          <template #right>
            <div class="reserve-side-scroller">
              <!-- 合并后的详情与快捷续期 -->
              <AppCard title="预留位详情与快捷续期" class="selected-detail-card">
                <template #actions>
                  <div class="detail-header-actions" v-if="selectedMember">
                    <button type="button" class="reserve-mini-btn" @click="openPlayerDatabase(selectedMember.name || selectedMember.steamId)">🔍 玩家库</button>
                    <button type="button" class="reserve-mini-btn" :disabled="!canEdit" @click="fillFromSelectedMember">📥 带入表单</button>
                  </div>
                </template>

                <div v-if="selectedMember">
                  <div class="member-detail-header-status">
                    <span class="status-indicator-badge" :class="selectedMember.isExpired ? 'expired' : 'active'">
                      {{ selectedMember.isExpired ? "已过期" : "有效" }}
                    </span>
                    <span class="time-remaining-large" :class="{ 'expired-time': selectedMember.isExpired }">
                      {{ getRemainingText(selectedMember) }}
                    </span>
                  </div>

                  <div class="member-detail-grid">
                    <div class="detail-item">
                      <span class="detail-label">玩家名</span>
                      <strong class="detail-val selectable">{{ selectedMember.name || "未命名玩家" }}</strong>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">Steam64</span>
                      <div class="mono-copy-wrapper">
                        <strong class="detail-val mono selectable">{{ selectedMember.steamId }}</strong>
                        <button type="button" class="copy-id-btn" title="复制 Steam64" @click="copySteamId(selectedMember.steamId)">📋</button>
                      </div>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">预留位组</span>
                      <strong class="detail-val">{{ selectedMember.group }}</strong>
                    </div>
                    <div class="detail-item">
                      <span class="detail-label">到期时间</span>
                      <strong class="detail-val">{{ selectedMember.expireAt ?? "未设置" }}</strong>
                    </div>
                  </div>

                  <div class="divider-line"></div>

                  <div class="quick-renew-section">
                    <div class="sub-section-title">快捷续期 (直接点击天数续期)</div>
                    <p class="sub-section-desc">选中玩家后，直接点击天数即可快捷续期，无需重复填写表单。</p>
                    <div class="quick-renew-grid">
                      <button
                        v-for="days in quickDays"
                        :key="`selected-${days}`"
                        type="button"
                        class="renew-pill-btn"
                        :disabled="!canEdit || saving"
                        @click="extendSelectedMember(days)"
                      >
                        {{ saving && pendingExtendDays === days ? `续期中...` : `+${days} 天` }}
                      </button>
                    </div>

                    <div class="custom-renew-row">
                      <div class="custom-input-group">
                        <input v-model.number="selectedCustomDays" class="reserve-input custom-days-input" type="number" min="1" step="1">
                        <span class="unit-span">天</span>
                      </div>
                      <button type="button" class="reserve-btn primary-like" :disabled="!canEdit || saving || !selectedCustomDaysValid" @click="extendSelectedMember(selectedCustomDays)">
                        自定义续期
                      </button>
                    </div>
                  </div>

                  <div class="divider-line"></div>

                  <div class="card-footer-danger">
                    <button type="button" class="danger-outline-btn" :disabled="!canEdit || deletingSteamId === selectedMember.steamId" @click="confirmRemoveMember(selectedMember)">
                      {{ deletingSteamId === selectedMember.steamId ? "删除中..." : "🗑️ 删除该玩家预留位" }}
                    </button>
                  </div>
                </div>

                <div v-else class="reserve-detail-empty">
                  <strong>先选择一个玩家</strong>
                  <p>从左侧名单选择一个玩家后，这里会显示详情和续期快捷入口。</p>
                </div>
              </AppCard>

              <!-- 新增玩家 / 手动指定表单 -->
              <AppCard title="新增玩家 / 手动指定">
                <form class="manual-form" @submit.prevent="saveMember">
                  <p class="form-intro-desc">这里只用于新增预留位，或需要精确覆盖到期时间时使用。</p>

                  <label class="reserve-field">
                    <span class="field-title">玩家搜索与选择 (支持模糊搜索 / 数据库检索)</span>
                    <PlayerSelect
                      v-model:steamId="form.steamId"
                      v-model:playerName="form.name"
                      placeholder="搜索在线玩家 / 数据库玩家..."
                    />
                  </label>

                  <div class="reserve-form-grid">
                    <label class="reserve-field">
                      <span class="field-title">Steam64</span>
                      <input v-model.trim="form.steamId" class="reserve-input mono" type="text" placeholder="7656119..." required>
                    </label>

                    <label class="reserve-field">
                      <span class="field-title">玩家名</span>
                      <input v-model.trim="form.name" class="reserve-input" type="text" placeholder="建议填写，便于识别">
                    </label>
                  </div>

                  <label class="reserve-field">
                    <span class="field-title">预留位组</span>
                    <select v-model="form.group" class="reserve-select" required>
                      <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
                    </select>
                  </label>

                  <div class="reserve-expire-tabs">
                    <button type="button" :class="{ active: expireMode === 'extend' }" @click="expireMode = 'extend'">续期天数</button>
                    <button type="button" :class="{ active: expireMode === 'exact' }" @click="expireMode = 'exact'">精确到期时间</button>
                  </div>

                  <div v-if="expireMode === 'extend'" class="reserve-duration-row">
                    <div class="preset-duration-grid">
                      <button v-for="days in quickDays" :key="days" type="button" class="reserve-duration-btn" :class="{ active: form.durationDays === days }" @click="setDurationDays(days)">
                        +{{ days }} 天
                      </button>
                    </div>
                    <label class="reserve-field reserve-field-compact">
                      <span class="field-title">自定义天数</span>
                      <input v-model.number="form.durationDays" class="reserve-input" type="number" min="1" step="1">
                    </label>
                  </div>

                  <label v-else class="reserve-field">
                    <span class="field-title">到期时间</span>
                    <input v-model="form.exactExpireAt" class="reserve-input" type="datetime-local" required>
                  </label>

                  <label class="reserve-field">
                    <span class="field-title">原因</span>
                    <input v-model.trim="form.reason" class="reserve-input" type="text" placeholder="可选，例如活动补偿 / 手动续期">
                  </label>

                  <div class="expiry-comparison-preview">
                    <div class="preview-box">
                      <span class="preview-title">当前到期</span>
                      <strong class="preview-value">{{ currentExpireText }}</strong>
                    </div>
                    <div class="preview-arrow">➔</div>
                    <div class="preview-box highlight">
                      <span class="preview-title">{{ expireMode === "extend" ? "续期后到期" : "将覆盖为" }}</span>
                      <strong class="preview-value">{{ computedExpireAt || "请选择有效时间" }}</strong>
                    </div>
                  </div>

                  <button type="submit" class="submit-btn" :disabled="!canEdit || saving || !canSubmit">
                    {{ saving ? "提交中..." : (expireMode === "extend" ? "确认添加 / 续期预留位" : "保存精确到期时间") }}
                  </button>
                </form>
              </AppCard>
            </div>
          </template>
        </AppSplitLayout>
      </section>

      <!-- CDK批次 TAB -->
      <section v-else-if="activeTab === 'batches'" class="reserve-tab-panel reserve-tab-panel-fixed">
        <div class="reserve-summary-grid">
          <div class="reserve-summary-card">
            <span>有效批次</span>
            <strong>{{ cdkState?.summary.batchCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card active">
            <span>剩余 CDK</span>
            <strong>{{ cdkState?.summary.remainingCodeCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card expired">
            <span>已用 CDK</span>
            <strong>{{ cdkState?.summary.usedCodeCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card subtle">
            <span>停用批次</span>
            <strong>{{ cdkState?.summary.deactivatedBatchCount ?? 0 }}</strong>
          </div>
        </div>

        <AppSplitLayout class="batch-workspace" right-fixed>
          <template #left>
            <AppCard compact title="CDK 批次列表">
              <template #actions>
                <span class="reserve-section-stat">共 {{ cdkBatches.length }} 个批次</span>
              </template>

              <div v-if="!cdkBatches.length" class="reserve-empty">暂无有效 CDK 批次。</div>
              <div v-else class="cdk-batch-grid">
                <article
                  v-for="batch in cdkBatches"
                  :key="batch.id"
                  class="cdk-batch-card compact"
                  :class="{ active: selectedBatchId === batch.id }"
                  @click="selectedBatchId = batch.id"
                >
                  <div class="cdk-batch-head">
                    <div>
                      <div class="cdk-batch-title-row">
                        <strong>{{ batch.codeType }}</strong>
                        <span class="reserve-pill active">有效</span>
                      </div>
                      <p class="cdk-batch-meta mono">{{ batch.id }}</p>
                    </div>
                    <div class="cdk-batch-actions">
                      <button type="button" class="reserve-mini-btn" @click.stop="copyBatchCodes(batch)">复制 CDK</button>
                      <button type="button" class="reserve-mini-btn" @click.stop="openBatchRecords(batch)">激活记录</button>
                      <button type="button" class="reserve-mini-btn danger" :disabled="!canEdit || batchActionLoadingId === batch.id" @click.stop="confirmDeactivateBatch(batch)">
                        {{ batchActionLoadingId === batch.id ? "处理中..." : "报销" }}
                      </button>
                    </div>
                  </div>

                  <div class="cdk-batch-metrics compact-metrics">
                    <div class="cdk-metric">
                      <span>数量</span>
                      <strong>{{ batch.quantity }}</strong>
                    </div>
                    <div class="cdk-metric">
                      <span>已用</span>
                      <strong>{{ batch.usedCount }}</strong>
                    </div>
                    <div class="cdk-metric">
                      <span>剩余</span>
                      <strong>{{ batch.remainingCount }}</strong>
                    </div>
                    <div class="cdk-metric">
                      <span>天数</span>
                      <strong>{{ batch.durationDays }}</strong>
                    </div>
                    <div class="cdk-metric">
                      <span>记录</span>
                      <strong>{{ batch.activationCount ?? 0 }}</strong>
                    </div>
                  </div>

                  <div class="cdk-batch-details compact-details">
                    <span>同玩家：{{ batch.allowMultiActivation ? "允许多次" : "单次使用" }}</span>
                    <span>创建时间：{{ formatDate(batch.createdAt) }}</span>
                    <span>创建人：{{ batch.createdBy || "system" }}</span>
                  </div>

                  <div v-if="batch.codes?.length" class="created-code-list inline-code-list">
                    <code v-for="code in batch.codes" :key="code">{{ code }}</code>
                  </div>
                </article>
              </div>
            </AppCard>
          </template>

          <template #right>
            <AppCard compact title="新增预留位 CDK 批次" description="右侧窗口专门用于创建批次。">
              <form class="batch-create-form" @submit.prevent="submitBatchCreate">
                <label class="reserve-field">
                  <span class="field-title">CDK 类型</span>
                  <input v-model.trim="batchForm.codeType" class="reserve-input" type="text" placeholder="例如 VIP" required>
                </label>
                <label class="reserve-field">
                  <span class="field-title">该批次数量</span>
                  <input v-model.number="batchForm.quantity" class="reserve-input" type="number" min="1" step="1" required>
                </label>
                <label class="reserve-field">
                  <span class="field-title">激活天数</span>
                  <input v-model.number="batchForm.durationDays" class="reserve-input" type="number" min="1" step="1" required>
                </label>
                <label class="checkbox-row">
                  <input v-model="batchForm.allowMultiActivation" type="checkbox">
                  <span>允许同一玩家多次使用该批次中的不同 CDK</span>
                </label>

                <div class="reserve-save-preview">
                  <span>批次预览</span>
                  <strong>{{ batchForm.codeType || "CDK" }} / {{ Number(batchForm.quantity) || 0 }} 个 / {{ Number(batchForm.durationDays) || 0 }} 天</strong>
                </div>

                <button type="submit" class="submit-btn" :disabled="!canEdit || batchCreating">
                  {{ batchCreating ? "创建中..." : "创建批次" }}
                </button>
              </form>
            </AppCard>
          </template>
        </AppSplitLayout>
      </section>

      <!-- 激活记录 TAB -->
      <section v-else class="reserve-tab-panel reserve-tab-panel-fixed">
        <div class="reserve-summary-grid">
          <div class="reserve-summary-card">
            <span>激活总数</span>
            <strong>{{ cdkState?.summary.activationCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card active">
            <span>成功</span>
            <strong>{{ cdkState?.summary.successCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card expired">
            <span>失败</span>
            <strong>{{ cdkState?.summary.failureCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card subtle">
            <span>批次数</span>
            <strong>{{ cdkState?.summary.batchCount ?? 0 }}</strong>
          </div>
        </div>

        <AppCard compact title="激活记录" body-mode="fill" class="activation-card">
          <template #actions>
            <div class="activation-filters-row">
              <select v-model="activationFilters.batchId" class="reserve-select">
                <option value="">全部批次</option>
                <option v-for="batch in cdkBatches" :key="batch.id" :value="batch.id">
                  {{ batch.codeType }} / {{ batch.id }}
                </option>
              </select>
              <input v-model.trim="activationFilters.steamId" class="reserve-input mono" type="search" placeholder="按 Steam64 筛选">
              <select v-model="activationFilters.result" class="reserve-select">
                <option value="">全部结果</option>
                <option v-for="item in activationResultOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
              </select>
            </div>
          </template>

          <div v-if="!filteredActivations.length" class="reserve-empty">暂无匹配的激活记录。</div>
          <AppTable v-else compact>
            <thead>
              <tr>
                <th>时间</th>
                <th>玩家</th>
                <th>Steam64</th>
                <th>批次</th>
                <th>CDK</th>
                <th>结果</th>
                <th>到期时间</th>
                <th>失败原因</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="record in filteredActivations" :key="record.id">
                <td>{{ formatDate(record.createdAt) }}</td>
                <td>{{ record.playerName || "未知玩家" }}</td>
                <td class="mono">{{ record.steamId || "-" }}</td>
                <td>{{ resolveBatchLabel(record.batchId, record.codeType) }}</td>
                <td class="mono">{{ record.code || "-" }}</td>
                <td>
                  <span class="reserve-pill" :class="record.result === 'success' ? 'active' : 'expired'">
                    {{ activationResultLabel(record.result) }}
                  </span>
                </td>
                <td>{{ record.grantedExpireAt || "-" }}</td>
                <td>{{ record.failureReason || "-" }}</td>
              </tr>
            </tbody>
          </AppTable>
        </AppCard>
      </section>
    </template>

    <div v-if="batchModalOpen" class="modal-backdrop" v-backdrop-close="closeBatchCreateModal">
      <form class="modal-panel compact" @submit.prevent="submitBatchCreate">
        <header>
          <div>
            <h2>新建 CDK 批次</h2>
            <p class="subtitle">生成一批独立 CDK，批次内可直接复制。</p>
          </div>
          <button class="icon-button" type="button" @click="closeBatchCreateModal">×</button>
        </header>

        <label class="reserve-field">
          <span>CDK 类型</span>
          <input v-model.trim="batchForm.codeType" class="reserve-input" type="text" placeholder="例如 VIP" required>
        </label>
        <label class="reserve-field">
          <span>该批次数量</span>
          <input v-model.number="batchForm.quantity" class="reserve-input" type="number" min="1" step="1" required>
        </label>
        <label class="reserve-field">
          <span>激活天数</span>
          <input v-model.number="batchForm.durationDays" class="reserve-input" type="number" min="1" step="1" required>
        </label>
        <label class="checkbox-row">
          <input v-model="batchForm.allowMultiActivation" type="checkbox">
          <span>允许同一玩家多次使用该批次中的不同 CDK</span>
        </label>

        <footer>
          <button class="ghost-button" type="button" @click="closeBatchCreateModal">取消</button>
          <button class="primary-button" type="submit" :disabled="batchCreating">
            {{ batchCreating ? "创建中..." : "创建批次" }}
          </button>
        </footer>
      </form>
    </div>

    <div v-if="recordsModal.open" class="modal-backdrop" v-backdrop-close="closeBatchRecords">
      <section class="modal-panel records-modal">
        <header>
          <div>
            <h2>批次激活记录</h2>
            <p class="subtitle">{{ recordsModal.batch?.codeType }} / {{ recordsModal.batch?.id }}</p>
          </div>
          <button class="icon-button" type="button" @click="closeBatchRecords">×</button>
        </header>

        <div class="reserve-filter-row activation-filters">
          <input v-model.trim="recordsFilters.steamId" class="reserve-input mono" type="search" placeholder="按 Steam64 筛选">
          <select v-model="recordsFilters.result" class="reserve-select">
            <option value="">全部结果</option>
            <option v-for="item in activationResultOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
          </select>
        </div>

        <div v-if="recordsModal.loading" class="reserve-empty">正在加载激活记录...</div>
        <div v-else-if="!recordsModal.records.length" class="reserve-empty">该批次暂无激活记录。</div>
        <AppTable v-else compact>
          <thead>
            <tr>
              <th>时间</th>
              <th>玩家</th>
              <th>Steam64</th>
              <th>CDK</th>
              <th>结果</th>
              <th>到期时间</th>
              <th>失败原因</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="record in recordsModal.records" :key="record.id">
              <td>{{ formatDate(record.createdAt) }}</td>
              <td>{{ record.playerName || "未知玩家" }}</td>
              <td class="mono">{{ record.steamId || "-" }}</td>
              <td class="mono">{{ record.code || "-" }}</td>
              <td>{{ activationResultLabel(record.result) }}</td>
              <td>{{ record.grantedExpireAt || "-" }}</td>
              <td>{{ record.failureReason || "-" }}</td>
            </tr>
          </tbody>
        </AppTable>
      </section>
    </div>

    <div v-if="detailModal.open" class="modal-backdrop" v-backdrop-close="closeBatchDetail">
      <section class="modal-panel records-modal">
        <header>
          <div>
            <h2>CDK 批次概览</h2>
            <p class="subtitle">{{ detailModal.batch?.codeType }} / {{ detailModal.batch?.id }}</p>
          </div>
          <button class="icon-button" type="button" @click="closeBatchDetail">×</button>
        </header>

        <div v-if="detailModal.batch" class="reserve-summary-grid compact-grid">
          <div class="reserve-summary-card"><span>数量</span><strong>{{ detailModal.batch.quantity }}</strong></div>
          <div class="reserve-summary-card active"><span>已用</span><strong>{{ detailModal.batch.usedCount }}</strong></div>
          <div class="reserve-summary-card"><span>剩余</span><strong>{{ detailModal.batch.remainingCount }}</strong></div>
          <div class="reserve-summary-card subtle"><span>激活天数</span><strong>{{ detailModal.batch.durationDays }}</strong></div>
        </div>

        <div v-if="detailModal.batch" class="cdk-batch-details detail-stack">
          <span>同玩家可重复激活：{{ detailModal.batch.allowMultiActivation ? "允许" : "禁止" }}</span>
          <span>创建时间：{{ formatDate(detailModal.batch.createdAt) }}</span>
          <span>创建人：{{ detailModal.batch.createdBy || "system" }}</span>
          <span>激活记录：{{ detailModal.batch.activationCount ?? 0 }}</span>
          <span>格式说明：末尾 `A` 表示可直接激活，无前置条件。</span>
        </div>

        <div v-if="detailModal.batch?.codes?.length" class="modal-actions-row">
          <button type="button" class="reserve-btn" @click="copyBatchCodes(detailModal.batch)">复制该批次全部 CDK</button>
        </div>

        <div v-if="detailModal.batch?.codes?.length" class="created-code-list">
          <code v-for="code in detailModal.batch.codes" :key="code">{{ code }}</code>
        </div>
        <div v-else class="reserve-empty">该批次没有可展示的 CDK。</div>
      </section>
    </div>

    <div v-if="batchWindow.open" class="modal-backdrop" v-backdrop-close="closeBatchWindow">
      <section class="modal-panel batch-window-modal">
        <header>
          <div>
            <h2>CDK 批次窗口</h2>
            <p class="subtitle">专门查看、创建、复制和报销 CDK 批次。</p>
          </div>
          <button class="icon-button" type="button" @click="closeBatchWindow">×</button>
        </header>

        <div class="reserve-summary-grid compact-grid">
          <div class="reserve-summary-card">
            <span>有效批次</span>
            <strong>{{ cdkState?.summary.batchCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card active">
            <span>剩余 CDK</span>
            <strong>{{ cdkState?.summary.remainingCodeCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card expired">
            <span>已用 CDK</span>
            <strong>{{ cdkState?.summary.usedCodeCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card subtle">
            <span>停用批次</span>
            <strong>{{ cdkState?.summary.deactivatedBatchCount ?? 0 }}</strong>
          </div>
        </div>

        <div class="cdk-toolbar">
          <div>
            <h4>CDK 批次列表</h4>
            <p class="subtitle">窗口内集中处理，不再挤在主页面。</p>
          </div>
          <button type="button" class="reserve-btn primary" :disabled="!canEdit" @click="openBatchCreateModal">
            新增批次
          </button>
        </div>

        <div v-if="!cdkBatches.length" class="reserve-empty">暂无有效 CDK 批次。</div>
        <div v-else class="cdk-batch-grid batch-window-grid">
          <article
            v-for="batch in cdkBatches"
            :key="batch.id"
            class="cdk-batch-card"
            :class="{ active: selectedBatchId === batch.id }"
            @click="selectedBatchId = batch.id"
          >
            <div class="cdk-batch-head">
              <div>
                <div class="cdk-batch-title-row">
                  <strong>{{ batch.codeType }}</strong>
                  <span class="reserve-pill active">有效</span>
                </div>
                <p class="cdk-batch-meta mono">{{ batch.id }}</p>
              </div>
              <div class="cdk-batch-actions">
                <button type="button" class="reserve-mini-btn" @click.stop="openBatchDetail(batch)">查看概览</button>
                <button type="button" class="reserve-mini-btn" @click.stop="openBatchRecords(batch)">查看激活记录</button>
                <button type="button" class="reserve-mini-btn danger" :disabled="!canEdit || batchActionLoadingId === batch.id" @click.stop="confirmDeactivateBatch(batch)">
                  {{ batchActionLoadingId === batch.id ? "处理中..." : "报销" }}
                </button>
              </div>
            </div>

            <div class="cdk-batch-metrics">
              <div class="cdk-metric">
                <span>数量</span>
                <strong>{{ batch.quantity }}</strong>
              </div>
              <div class="cdk-metric">
                <span>已用</span>
                <strong>{{ batch.usedCount }}</strong>
              </div>
              <div class="cdk-metric">
                <span>剩余</span>
                <strong>{{ batch.remainingCount }}</strong>
              </div>
              <div class="cdk-metric">
                <span>激活天数</span>
                <strong>{{ batch.durationDays }}</strong>
              </div>
              <div class="cdk-metric">
                <span>激活记录</span>
                <strong>{{ batch.activationCount ?? 0 }}</strong>
              </div>
            </div>

            <div class="cdk-batch-details">
              <span>同玩家可重复激活：{{ batch.allowMultiActivation ? "允许" : "禁止" }}</span>
              <span>创建时间：{{ formatDate(batch.createdAt) }}</span>
              <span>创建人：{{ batch.createdBy || "system" }}</span>
              <span>格式：CDK{{ batch.codeType }}XXXXXXXXXXXXXXA</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ApiError } from "../../app/apiClient";
import {
  createReserveSlotCdkBatch,
  deactivateReserveSlotCdkBatch,
  deleteExpiredReserveSlotMembers,
  deleteReserveSlotMember,
  exportReserveSlotsCsv,
  fetchReserveSlotBatchActivations,
  fetchReserveSlotsCdkState,
  fetchReserveSlotsState,
  importReserveSlotsCsv,
  importReserveSlotsFromAdmin,
  upsertReserveSlotMember,
  type CreateReserveSlotCdkBatchPayload,
  type ReserveSlotCdkActivationRecord,
  type ReserveSlotCdkBatch,
  type ReserveSlotMember,
  type ReserveSlotsCdkState,
  type ReserveSlotsState,
} from "../../app/reserveSlotsApi";
import { searchPlayers, type SearchablePlayer } from "../../features/group-report/playerSearch";
import { useUiStore } from "../../stores/ui.store";
import { copyTextWithToast } from "../../utils/clipboard";
import { goToPlayerDatabaseSearch } from "../../utils/player-database";
import PlayerSelect from "../common/PlayerSelect.vue";

// Common UI Components
import AppCard from "../common/AppCard.vue";
import AppSplitLayout from "../common/AppSplitLayout.vue";
import AppTable from "../common/AppTable.vue";

type ActiveTab = "manual" | "batches" | "activations";
type ExpireMode = "extend" | "exact";

const props = defineProps<{
  canEdit: boolean;
}>();

const router = useRouter();
const ui = useUiStore();

const quickDays = [7, 30, 90, 180];
const tabs = [
  { key: "manual", label: "手动预留位" },
  { key: "batches", label: "CDK批次" },
  { key: "activations", label: "激活记录" },
] as const;
const activationResultOptions = [
  { value: "success", label: "成功" },
  { value: "code_not_found", label: "码不存在" },
  { value: "batch_deactivated", label: "预留位无效" },
  { value: "code_used", label: "码已使用" },
  { value: "duplicate_player_restricted", label: "同批次重复受限" },
  { value: "type_mismatch", label: "类型不匹配" },
  { value: "future_requirement_not_met", label: "未来门槛未达成" },
  { value: "invalid_player", label: "玩家无效" },
  { value: "internal_error", label: "内部错误" },
] as const;

const loading = ref(false);
const importing = ref(false);
const exporting = ref(false);
const saving = ref(false);
const deletingExpired = ref(false);
const deletingSteamId = ref("");

const batchCreating = ref(false);
const batchActionLoadingId = ref("");
const pendingExtendDays = ref<number | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const state = ref<ReserveSlotsState | null>(null);
const cdkState = ref<ReserveSlotsCdkState | null>(null);
const selectedSteamId = ref("");
const filterText = ref("");
const statusFilter = ref<"all" | "active" | "expired">("all");

const expireMode = ref<ExpireMode>("extend");
const activeTab = ref<ActiveTab>("manual");
const batchModalOpen = ref(false);
const importInput = ref<HTMLInputElement | null>(null);
const nowTick = ref(Date.now());
const selectedCustomDays = ref(30);

const activationFilters = reactive({
  batchId: "",
  steamId: "",
  result: "",
});

const recordsFilters = reactive({
  steamId: "",
  result: "",
});

const recordsModal = reactive<{
  open: boolean;
  loading: boolean;
  batch: ReserveSlotCdkBatch | null;
  records: ReserveSlotCdkActivationRecord[];
}>({
  open: false,
  loading: false,
  batch: null,
  records: [],
});

const detailModal = reactive<{
  open: boolean;
  batch: ReserveSlotCdkBatch | null;
}>({
  open: false,
  batch: null,
});

const batchWindow = reactive({
  open: false,
});

const form = reactive({
  steamId: "",
  group: "BZSSVIP",
  name: "",
  reason: "",
  durationDays: 30,
  exactExpireAt: toDatetimeLocal(addDays(new Date(), 30)),
});

const batchForm = reactive<CreateReserveSlotCdkBatchPayload>({
  codeType: "VIP",
  quantity: 10,
  durationDays: 30,
  allowMultiActivation: false,
});

const canEdit = computed(() => Boolean(props.canEdit));
const memberRows = computed(() => Array.isArray(state.value?.members) ? state.value.members : []);
const cdkBatches = computed(() => cdkState.value?.batches ?? []);
const selectedBatchId = ref("");
const groupOptions = computed(() => {
  const groups = (state.value?.groups ?? [])
    .filter((group) => group.permission === "reserve")
    .map((group) => group.name)
    .filter(Boolean);
  return groups.length ? [...new Set(groups)] : ["BZSSVIP"];
});

const filteredMemberRows = computed(() => {
  const query = filterText.value.trim().toLowerCase();
  return memberRows.value.filter((member) => {
    if (statusFilter.value === "active" && member.isExpired) return false;
    if (statusFilter.value === "expired" && !member.isExpired) return false;
    if (!query) return true;
    return [member.name, member.steamId, member.group, member.expireAt ?? ""]
      .some((value) => String(value ?? "").toLowerCase().includes(query));
  });
});

const selectedMember = computed(() => {
  if (!memberRows.value.length) return null;
  return memberRows.value.find((member) => member.steamId === selectedSteamId.value)
    ?? filteredMemberRows.value[0]
    ?? memberRows.value[0]
    ?? null;
});

const currentBatch = computed(() => {
  if (!cdkBatches.value.length) return null;
  return cdkBatches.value.find((batch) => batch.id === selectedBatchId.value)
    ?? cdkBatches.value[0]
    ?? null;
});

const currentMember = computed(() => {
  const steamId = form.steamId.trim();
  if (!steamId) return null;
  return memberRows.value.find((member) => member.steamId === steamId) ?? null;
});

const currentExpireText = computed(() => currentMember.value?.expireAt ?? "未设置 / 已过期从现在算");

const computedExpireAt = computed(() => {
  if (expireMode.value === "exact") {
    return fromDatetimeLocal(form.exactExpireAt);
  }

  const days = Number(form.durationDays);
  if (!Number.isFinite(days) || days <= 0) return "";
  const baseDate = pickGrantBaseDate(currentMember.value?.expireAt ?? null);
  return formatLocalDateTime(addDays(baseDate, days));
});

const canSubmit = computed(() => {
  if (!/^7656119\d{10}$/.test(form.steamId.trim())) return false;
  if (!form.group.trim()) return false;
  if (expireMode.value === "extend") {
    return Number.isFinite(Number(form.durationDays)) && Number(form.durationDays) > 0;
  }
  return Boolean(computedExpireAt.value);
});

const selectedCustomDaysValid = computed(() => Number.isFinite(Number(selectedCustomDays.value)) && Number(selectedCustomDays.value) > 0);

const filteredActivations = computed(() => {
  const batchId = activationFilters.batchId.trim();
  const steamId = activationFilters.steamId.trim().toLowerCase();
  const result = activationFilters.result.trim().toLowerCase();
  return (cdkState.value?.activations ?? []).filter((record) => {
    if (batchId && record.batchId !== batchId) return false;
    if (steamId && !String(record.steamId ?? "").toLowerCase().includes(steamId)) return false;
    if (result && String(record.result ?? "").toLowerCase() !== result) return false;
    return true;
  });
});

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  void loadAll();
  timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 30_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

watch(groupOptions, (groups) => {
  if (!groups.includes(form.group)) {
    form.group = groups[0] ?? "BZSSVIP";
  }
}, { immediate: true });

watch(cdkBatches, (batches) => {
  if (!batches.length) {
    selectedBatchId.value = "";
    return;
  }
  if (!batches.some((batch) => batch.id === selectedBatchId.value)) {
    selectedBatchId.value = batches[0].id;
  }
}, { immediate: true });

watch(() => [recordsModal.open, recordsModal.batch?.id, recordsFilters.steamId, recordsFilters.result] as const, () => {
  if (recordsModal.open && recordsModal.batch) {
    void reloadBatchRecords();
  }
});

async function loadAll(force = false) {
  if (loading.value && !force) return;
  loading.value = true;
  error.value = null;

  try {
    const [manualState, cdk] = await Promise.all([
      fetchReserveSlotsState(),
      fetchReserveSlotsCdkState(),
    ]);
    applyState(manualState);
    cdkState.value = cdk;
  } catch (err) {
    error.value = renderError(err);
  } finally {
    loading.value = false;
  }
}

async function syncFromAdmin() {
  if (!canEdit.value) return;
  importing.value = true;
  error.value = null;

  try {
    const next = await importReserveSlotsFromAdmin();
    applyState(next);
    cdkState.value = await fetchReserveSlotsCdkState();
    notice.value = next.message ?? "已从管理员文件同步预留位数据。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
  }
}

async function saveMember() {
  if (!canEdit.value || saving.value || !canSubmit.value) return;
  saving.value = true;
  error.value = null;

  try {
    const payload = expireMode.value === "extend"
      ? {
          steamId: form.steamId.trim(),
          group: form.group.trim(),
          durationDays: Number(form.durationDays),
          name: form.name.trim(),
          reason: form.reason.trim(),
        }
      : {
          steamId: form.steamId.trim(),
          group: form.group.trim(),
          expireAt: computedExpireAt.value,
          name: form.name.trim(),
          reason: form.reason.trim(),
        };

    const next = await upsertReserveSlotMember(payload);
    applyState(next);
    selectedSteamId.value = form.steamId.trim();
    notice.value = next.message ?? "预留位时间已更新。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    saving.value = false;
  }
}

async function extendSelectedMember(days: number) {
  if (!selectedMember.value || !canEdit.value || saving.value) return;
  const normalizedDays = Number(days);
  if (!Number.isFinite(normalizedDays) || normalizedDays <= 0) return;

  saving.value = true;
  pendingExtendDays.value = normalizedDays;
  error.value = null;

  try {
    const next = await upsertReserveSlotMember({
      steamId: selectedMember.value.steamId,
      group: selectedMember.value.group,
      durationDays: normalizedDays,
      name: selectedMember.value.name || form.name.trim(),
      reason: "manual_extend",
    });
    applyState(next);
    selectedSteamId.value = selectedMember.value.steamId;
    notice.value = next.message ?? "预留位时间已更新。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    pendingExtendDays.value = null;
    saving.value = false;
  }
}

async function confirmRemoveMember(member: ReserveSlotMember) {
  const confirmed = await ui.openConfirm({
    title: "删除预留位",
    message: `确认删除 ${member.name || member.steamId} 的预留位吗？`,
    confirmText: "确认删除",
    cancelText: "取消",
  });
  if (confirmed) {
    await removeMember(member);
  }
}

async function removeMember(member: ReserveSlotMember) {
  if (!canEdit.value || deletingSteamId.value) return;
  deletingSteamId.value = member.steamId;
  error.value = null;

  try {
    const next = await deleteReserveSlotMember(member.steamId);
    applyState(next);
    if (selectedSteamId.value === member.steamId) {
      selectedSteamId.value = next.members?.[0]?.steamId ?? "";
    }
    notice.value = next.message ?? "预留位已删除。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    deletingSteamId.value = "";
  }
}

async function confirmRemoveExpiredMembers() {
  const confirmed = await ui.openConfirm({
    title: "一键删除过期",
    message: "确认删除所有已过期预留位吗？",
    confirmText: "确认删除",
    cancelText: "取消",
  });
  if (confirmed) {
    await removeExpiredMembers();
  }
}

async function removeExpiredMembers() {
  if (!canEdit.value || deletingExpired.value) return;
  deletingExpired.value = true;
  error.value = null;

  try {
    const next = await deleteExpiredReserveSlotMembers();
    applyState(next);
    if (!next.members.some((member) => member.steamId === selectedSteamId.value)) {
      selectedSteamId.value = next.members?.[0]?.steamId ?? "";
    }
    notice.value = next.message ?? "过期预留位已删除。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    deletingExpired.value = false;
  }
}

async function exportCsv() {
  exporting.value = true;
  error.value = null;

  try {
    const result = await exportReserveSlotsCsv();
    const blob = new Blob([result.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "reserve-slots.csv";
    anchor.click();
    URL.revokeObjectURL(url);
    notice.value = "CSV 已导出。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    exporting.value = false;
  }
}

function triggerImportFile() {
  importInput.value?.click();
}

async function onImportFileChange(event: Event) {
  const input = event.target as HTMLInputElement | null;
  const file = input?.files?.[0] ?? null;
  if (!file) return;

  importing.value = true;
  error.value = null;

  try {
    const csvText = await file.text();
    const result = await importReserveSlotsCsv(csvText);
    applyState(result);
    notice.value = result.message ?? "CSV 导入完成。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    importing.value = false;
    if (input) input.value = "";
  }
}

function applyState(next: ReserveSlotsState) {
  state.value = next;
  if (!selectedSteamId.value && next.members.length) {
    selectedSteamId.value = next.members[0].steamId;
  }
}

function fillFromSelectedMember() {
  if (!selectedMember.value) return;
  form.steamId = selectedMember.value.steamId;
  form.group = selectedMember.value.group || groupOptions.value[0] || "BZSSVIP";
  form.name = selectedMember.value.name || "";
  
  expireMode.value = "extend";
  form.durationDays = 30;
}

function setDurationDays(days: number) {
  form.durationDays = days;
}

function openPlayerDatabase(value: string) {
  goToPlayerDatabaseSearch(router, value);
}

function openBatchWindow() {
  batchWindow.open = true;
}

function closeBatchWindow() {
  batchWindow.open = false;
}

function openBatchCreateModal() {
  batchWindow.open = true;
  batchModalOpen.value = true;
}

function closeBatchCreateModal() {
  batchModalOpen.value = false;
}

async function submitBatchCreate() {
  if (!canEdit.value || batchCreating.value) return;
  batchCreating.value = true;
  error.value = null;

  try {
    const result = await createReserveSlotCdkBatch(batchForm);
    cdkState.value = result;
    selectedBatchId.value = result.createdBatchId ?? result.batches?.[0]?.id ?? "";
    activeTab.value = "batches";
    notice.value = result.message ?? "CDK 批次已创建。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    batchCreating.value = false;
  }
}

async function confirmDeactivateBatch(batch: ReserveSlotCdkBatch) {
  const confirmed = await ui.openConfirm({
    title: "报销批次",
    message: `确认报销批次 ${batch.codeType} / ${batch.id} 吗？报销后该批次会从列表移除，未使用的 CDK 会显示为无效。`,
    confirmText: "确认报销",
    cancelText: "取消",
  });
  if (confirmed) {
    await deactivateBatch(batch);
  }
}

async function deactivateBatch(batch: ReserveSlotCdkBatch) {
  if (!canEdit.value) return;
  batchActionLoadingId.value = batch.id;
  error.value = null;

  try {
    const result = await deactivateReserveSlotCdkBatch(batch.id);
    cdkState.value = result;
    if (selectedBatchId.value === batch.id) {
      selectedBatchId.value = result.batches?.[0]?.id ?? "";
    }
    if (detailModal.batch?.id === batch.id) {
      closeBatchDetail();
    }
    notice.value = result.message ?? "该批次预留位已失效。";
  } catch (err) {
    error.value = renderError(err);
  } finally {
    batchActionLoadingId.value = "";
  }
}

async function openBatchRecords(batch: ReserveSlotCdkBatch) {
  recordsModal.open = true;
  recordsModal.batch = batch;
  await reloadBatchRecords();
}

function openBatchDetail(batch: ReserveSlotCdkBatch) {
  detailModal.batch = batch;
  detailModal.open = true;
}

function closeBatchDetail() {
  detailModal.open = false;
  detailModal.batch = null;
}

async function reloadBatchRecords() {
  if (!recordsModal.batch) return;
  recordsModal.loading = true;
  error.value = null;

  try {
    const result = await fetchReserveSlotBatchActivations(recordsModal.batch.id, {
      steamId: recordsFilters.steamId,
      result: recordsFilters.result,
    });
    recordsModal.records = result.records;
  } catch (err) {
    error.value = renderError(err);
  } finally {
    recordsModal.loading = false;
  }
}

function closeBatchRecords() {
  recordsModal.open = false;
  recordsModal.batch = null;
  recordsModal.records = [];
  recordsFilters.steamId = "";
  recordsFilters.result = "";
}

async function copyBatchCodes(batch: ReserveSlotCdkBatch) {
  const codes = (batch.codes ?? []).filter(Boolean);
  if (!codes.length) return;
  const copied = await copyTextWithToast(codes.join("\n"), ui, {
    label: `${batch.codeType} CDK`,
    successMessage: `Copied all CDK codes for batch ${batch.codeType} / ${batch.id}.`,
    errorMessage: "Copy failed. Please select and copy manually.",
  });
  if (copied) notice.value = `Copied all CDK codes for batch ${batch.codeType} / ${batch.id}.`;
}

async function copySteamId(steamId: string) {
  await copyTextWithToast(steamId, ui, {
    label: "Steam64",
    successMessage: `Steam64 ${steamId} 已成功复制到剪贴板。`,
    errorMessage: "复制失败，请手动选择复制。",
  });
}

function resolveBatchLabel(batchId: string | null, codeType: string | null) {
  if (!batchId) return codeType || "-";
  const batch = cdkBatches.value.find((item) => item.id === batchId);
  if (!batch) return codeType ? `${codeType} / ${batchId} / 无效` : `${batchId} / 无效`;
  return `${batch.codeType} / ${batch.id}`;
}

function activationResultLabel(value: string) {
  return activationResultOptions.find((item) => item.value === value)?.label ?? value;
}

function getRemainingText(member: ReserveSlotMember) {
  if (!member.expireAt) return "未设置";
  if (member.isExpired) return "已过期";
  const expireAt = Date.parse(member.expireAt.replace(" ", "T"));
  if (!Number.isFinite(expireAt)) return member.expireAt;

  const remaining = Math.max(0, expireAt - nowTick.value);
  const totalSeconds = Math.floor(remaining / 1000);
  if (totalSeconds <= 0) return "即将过期";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${Math.max(1, minutes)} 分钟`;
}

function renderError(err: unknown) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "预留位操作失败。";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "尚未记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}

function pickGrantBaseDate(currentExpireAt: string | null) {
  const currentExpire = parseReserveDate(currentExpireAt);
  const now = new Date();
  if (!currentExpire) return now;
  return currentExpire.getTime() > now.getTime() ? currentExpire : now;
}

function parseReserveDate(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text.includes(" ") ? text.replace(" ", "T") : text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function toDatetimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  return formatLocalDateTime(date);
}
</script>

<style scoped>
.reserve-slots-section {
  display: flex;
  flex-direction: column;
  gap: 16px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.reserve-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  padding: 8px 0;
}

.reserve-head-copy h3 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.02em;
  background: linear-gradient(135deg, var(--color-text-primary) 30%, var(--color-text-secondary));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.reserve-head-copy p {
  margin: 4px 0 0;
  color: var(--color-text-muted);
  font-size: 13px;
}

.reserve-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.reserve-btn,
.reserve-mini-btn,
.reserve-duration-btn,
.danger-outline-btn,
.submit-btn,
.renew-pill-btn {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.reserve-btn:hover,
.reserve-mini-btn:hover,
.reserve-duration-btn:hover,
.renew-pill-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  border-color: var(--color-border-hover);
  transform: translateY(-1px);
}

.reserve-btn:active,
.reserve-mini-btn:active,
.reserve-duration-btn:active,
.renew-pill-btn:active {
  transform: translateY(0);
}

.reserve-btn.primary,
.submit-btn,
.reserve-btn.primary-like {
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.reserve-btn.primary:hover,
.submit-btn:hover,
.reserve-btn.primary-like:hover {
  background: rgba(59, 130, 246, 0.25);
  border-color: #60a5fa;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.25);
}

.danger-btn {
  border-color: rgba(239, 68, 68, 0.4) !important;
  background: rgba(239, 68, 68, 0.12) !important;
  color: #f87171 !important;
}

.danger-btn:hover {
  background: rgba(239, 68, 68, 0.22) !important;
  border-color: #f87171 !important;
  box-shadow: 0 0 12px rgba(239, 68, 68, 0.2) !important;
}

.danger-outline-btn {
  border-color: rgba(239, 68, 68, 0.25);
  background: transparent;
  color: #f87171;
  width: 100%;
  padding: 10px;
}

.danger-outline-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #f87171;
}

.reserve-btn:disabled,
.reserve-mini-btn:disabled,
.reserve-duration-btn:disabled,
.danger-outline-btn:disabled,
.submit-btn:disabled,
.renew-pill-btn:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  transform: none !important;
  box-shadow: none !important;
}

.reserve-tabs {
  display: flex;
  gap: 8px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  padding: 4px;
  border-radius: 999px;
  align-self: flex-start;
}

.reserve-tab {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  border-radius: 999px;
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.reserve-tab:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.03);
}

.reserve-tab.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
  box-shadow: var(--shadow-sm);
}

.reserve-tab-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 0;
  flex: 1;
}

.reserve-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.reserve-summary-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--color-border-soft);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.03), rgba(255, 255, 255, 0.01));
  border-radius: 12px;
  box-shadow: var(--shadow-sm);
}

.reserve-summary-card span {
  color: var(--color-text-muted);
  font-size: 12px;
  font-weight: 500;
}

.reserve-summary-card strong {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.1;
  color: var(--color-text-primary);
}

.reserve-summary-card.active strong {
  color: #4ade80;
  text-shadow: 0 0 10px rgba(74, 222, 128, 0.15);
}

.reserve-summary-card.expired strong {
  color: #f87171;
  text-shadow: 0 0 10px rgba(248, 113, 113, 0.15);
}

.reserve-summary-card.subtle strong {
  font-size: 16px;
}

.reserve-workspace {
  flex: 1;
  min-height: 0;
}

/* Left list layout styling */
.list-header-actions-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.reserve-section-stat {
  font-size: 12px;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
  background: rgba(255, 255, 255, 0.04);
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--color-border-soft);
}

.reserve-list-header-sticky {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--color-bg-card);
  padding-bottom: 12px;
  border-bottom: 1px solid var(--color-border-soft);
  margin-bottom: 12px;
}

.reserve-filter-row {
  display: flex;
  gap: 10px;
  margin-bottom: 10px;
}

.reserve-input,
.reserve-select {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  transition: all 0.2s ease;
}

.reserve-input:focus,
.reserve-select:focus {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
  outline: none;
}

.filter-select {
  flex: 0 0 120px;
}

.reserve-meta-strip {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
}

.reserve-list-scroll {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.reserve-list-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 0.8fr 1.3fr 1.1fr;
  gap: 12px;
  align-items: center;
}

.reserve-list-grid-head {
  padding: 4px 12px;
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.reserve-row {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.015);
  border-radius: 10px;
  padding: 12px 14px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.reserve-row:hover {
  background: rgba(255, 255, 255, 0.04);
  border-color: rgba(96, 165, 250, 0.3);
  transform: translateX(2px);
}

.reserve-row.active {
  border-color: rgba(96, 165, 250, 0.6);
  background: linear-gradient(90deg, rgba(37, 99, 235, 0.1) 0%, rgba(37, 99, 235, 0.02) 100%);
  box-shadow: inset 3px 0 0 #3b82f6;
}

.reserve-row.expired {
  opacity: 0.75;
}

.reserve-cell {
  min-width: 0;
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reserve-player-cell strong {
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 600;
}

.mono {
  font-family: var(--font-mono, SFMono-Regular, Consolas, monospace);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.02em;
}

.reserve-state-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  align-items: flex-start;
}

.remaining-text {
  font-size: 10px;
  color: var(--color-text-muted);
}

.reserve-pill {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
}

.reserve-pill.active {
  background: rgba(74, 222, 128, 0.12);
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.2);
}

.reserve-pill.expired {
  background: rgba(248, 113, 113, 0.12);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.2);
}

/* Right-side scroller panel */
.reserve-side-scroller {
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
  height: 100%;
  scrollbar-gutter: stable;
  padding-right: 4px;
}

.selected-detail-card {
  border-left: 3px solid #60a5fa;
}

.detail-header-actions {
  display: flex;
  gap: 6px;
}

.member-detail-header-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  margin-bottom: 16px;
}

.status-indicator-badge {
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.status-indicator-badge.active {
  background: rgba(74, 222, 128, 0.15);
  color: #4ade80;
  border: 1px solid rgba(74, 222, 128, 0.25);
}

.status-indicator-badge.expired {
  background: rgba(248, 113, 113, 0.15);
  color: #f87171;
  border: 1px solid rgba(248, 113, 113, 0.25);
}

.time-remaining-large {
  font-size: 15px;
  font-weight: 800;
  color: #4ade80;
}

.time-remaining-large.expired-time {
  color: #f87171;
}

.member-detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 16px;
}

.detail-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 11px;
  color: var(--color-text-muted);
  text-transform: uppercase;
  font-weight: 500;
}

.detail-val {
  font-size: 13px;
  color: var(--color-text-primary);
  font-weight: 600;
  word-break: break-all;
}

.mono-copy-wrapper {
  display: flex;
  align-items: center;
  gap: 6px;
}

.copy-id-btn {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  opacity: 0.6;
  transition: opacity 0.2s;
  padding: 2px;
}

.copy-id-btn:hover {
  opacity: 1;
}

.divider-line {
  height: 1px;
  background: var(--color-border-soft);
  margin: 16px 0;
}

.quick-renew-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sub-section-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.sub-section-desc {
  font-size: 11px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.quick-renew-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.renew-pill-btn {
  padding: 8px 6px;
  font-size: 12px;
  border-radius: 8px;
}

.custom-renew-row {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 4px;
}

.custom-input-group {
  display: flex;
  align-items: center;
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding-right: 12px;
  flex: 1;
}

.custom-days-input {
  border: 0 !important;
  background: transparent !important;
  box-shadow: none !important;
  padding-right: 4px;
}

.unit-span {
  font-size: 12px;
  color: var(--color-text-muted);
}

.card-footer-danger {
  display: flex;
  justify-content: flex-end;
}

.reserve-detail-empty {
  text-align: center;
  padding: 32px 16px;
  color: var(--color-text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.reserve-detail-empty strong {
  font-size: 14px;
  color: var(--color-text-secondary);
}

.reserve-detail-empty p {
  margin: 0;
  font-size: 12px;
}

/* Manual Form */
.manual-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-intro-desc {
  font-size: 12px;
  color: var(--color-text-muted);
  margin: 0 0 4px;
}

.field-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.reserve-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.reserve-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.reserve-expire-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--color-border-soft);
  background: rgba(0, 0, 0, 0.15);
  border-radius: 8px;
  overflow: hidden;
  padding: 2px;
}

.reserve-expire-tabs button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 8px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
}

.reserve-expire-tabs button.active {
  background: rgba(255, 255, 255, 0.08);
  color: var(--color-text-primary);
}

.reserve-duration-row {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}

.preset-duration-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
  flex: 1;
}

.reserve-duration-btn {
  padding: 8px;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.02);
}

.reserve-duration-btn.active {
  border-color: #60a5fa;
  background: rgba(59, 130, 246, 0.1);
  color: #60a5fa;
}

.expiry-comparison-preview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.015);
  border: 1px dashed var(--color-border-soft);
  border-radius: 10px;
  margin-top: 4px;
}

.preview-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.preview-title {
  font-size: 10px;
  color: var(--color-text-muted);
}

.preview-value {
  font-size: 12px;
  color: var(--color-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-box.highlight .preview-value {
  color: #60a5fa;
  font-weight: 700;
}

.preview-arrow {
  color: var(--color-text-muted);
  font-size: 16px;
}

.submit-btn {
  width: 100%;
  padding: 10px;
  font-size: 13px;
  font-weight: 700;
  border-color: rgba(59, 130, 246, 0.4);
  background: rgba(59, 130, 246, 0.15);
  color: #60a5fa;
}

.submit-btn:hover {
  background: rgba(59, 130, 246, 0.25);
  border-color: #60a5fa;
  box-shadow: 0 0 12px rgba(59, 130, 246, 0.2);
}

.submit-btn:active {
  transform: none;
}

/* CDK tab styling */
.batch-workspace {
  flex: 1;
  min-height: 0;
}

.batch-create-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.checkbox-row input {
  margin-top: 2px;
}

.cdk-batch-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
  max-height: 100%;
}

.cdk-batch-card {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.015);
  border-radius: 10px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cdk-batch-card:hover {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(96, 165, 250, 0.35);
}

.cdk-batch-card.active {
  border-color: rgba(96, 165, 250, 0.6);
  background: linear-gradient(180deg, rgba(37, 99, 235, 0.04) 0%, rgba(255, 255, 255, 0.01) 100%);
}

.cdk-batch-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
}

.cdk-batch-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.cdk-batch-title-row strong {
  font-size: 15px;
  color: var(--color-text-primary);
}

.cdk-batch-meta {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}

.cdk-batch-actions {
  display: flex;
  gap: 6px;
}

.cdk-batch-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.cdk-metric {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--color-border-soft);
  border-radius: 6px;
}

.cdk-metric span {
  font-size: 9px;
  color: var(--color-text-muted);
  text-transform: uppercase;
}

.cdk-metric strong {
  font-size: 13px;
  color: var(--color-text-primary);
  margin-top: 2px;
}

.cdk-batch-details {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--color-text-muted);
  border-top: 1px solid var(--color-border-soft);
  padding-top: 8px;
}

.created-code-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 120px;
  overflow-y: auto;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid var(--color-border-soft);
  border-radius: 6px;
  padding: 8px;
}

.created-code-list code {
  font-size: 11px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-soft);
  padding: 2px 6px;
  border-radius: 4px;
  color: #60a5fa;
}

/* Activations tab */
.activation-filters-row {
  display: flex;
  gap: 8px;
}

.reserve-empty {
  padding: 32px;
  text-align: center;
  color: var(--color-text-muted);
  font-size: 13px;
  border: 1px dashed var(--color-border-soft);
  border-radius: 10px;
}

/* Modals */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(2, 6, 12, 0.8);
  backdrop-filter: blur(8px);
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.modal-panel {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  border-radius: 16px;
  width: 100%;
  max-width: 500px;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: modalEnter 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes modalEnter {
  from {
    opacity: 0;
    transform: scale(0.95) translateY(10px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.modal-panel header {
  padding: 16px 20px;
  border-bottom: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.modal-panel header h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
}

.modal-panel .subtitle {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--color-text-muted);
}

.icon-button {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  color: var(--color-text-muted);
  padding: 4px;
  transition: color 0.2s;
}

.icon-button:hover {
  color: var(--color-text-primary);
}

.modal-panel .reserve-field {
  padding: 12px 20px;
}

.modal-panel .checkbox-row {
  padding: 8px 20px;
}

.modal-panel footer {
  padding: 16px 20px;
  border-top: 1px solid var(--color-border-soft);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.ghost-button {
  background: transparent;
  border: 1px solid var(--color-border-soft);
  color: var(--color-text-secondary);
}

.ghost-button:hover {
  background: rgba(255, 255, 255, 0.04);
}

.primary-button {
  background: #3b82f6;
  border-color: #3b82f6;
  color: #fff;
}

.primary-button:hover {
  background: #2563eb;
  border-color: #2563eb;
}

/* Scrollbar styling */
.reserve-side-scroller::-webkit-scrollbar,
.reserve-list-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.reserve-side-scroller::-webkit-scrollbar-track,
.reserve-list-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.reserve-side-scroller::-webkit-scrollbar-thumb,
.reserve-list-scroll::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.08);
  border-radius: 3px;
}

.reserve-side-scroller::-webkit-scrollbar-thumb:hover,
.reserve-list-scroll::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}

/* Responsiveness */
@media (max-width: 1200px) {
  .reserve-list-grid {
    grid-template-columns: 1.2fr 1fr 0.8fr 1.2fr;
  }
  .expiry-cell {
    display: none;
  }
}

@media (max-width: 768px) {
  .reserve-summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.activation-card {
  flex: 1;
  min-height: 0;
}

.records-modal,
.batch-window-modal {
  max-width: 960px !important;
}
</style>
