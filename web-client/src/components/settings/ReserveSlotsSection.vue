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

        <div class="reserve-workspace">
          <section class="reserve-list-panel">
            <div class="reserve-section-head">
              <div>
                <h4>预留位名单</h4>
                <p>左侧筛选，右侧查看详情并直接续期。</p>
              </div>
              <span class="reserve-section-stat">{{ filteredMemberRows.length }} / {{ memberRows.length }}</span>
            </div>

            <div class="reserve-filter-row">
              <input v-model.trim="filterText" class="reserve-input" type="search" placeholder="搜索玩家 / Steam64 / 预留位组">
              <select v-model="statusFilter" class="reserve-select">
                <option value="all">全部状态</option>
                <option value="active">仅有效</option>
                <option value="expired">仅过期</option>
              </select>
            </div>

            <div class="reserve-meta-strip">
              <span>本地文件：{{ state?.localReserveFileExists ? "已存在" : "不存在" }}</span>
              <span>上次同步：{{ formatDate(state?.lastImportedAt) }}</span>
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
                  <div class="reserve-cell selectable">{{ member.expireAt ?? "未设置" }}</div>
                  <div class="reserve-cell reserve-state-cell">
                    <span class="reserve-pill" :class="member.isExpired ? 'expired' : 'active'">
                      {{ member.isExpired ? "已过期" : "有效" }}
                    </span>
                    <small>{{ getRemainingText(member) }}</small>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <aside class="reserve-side">
            <section class="reserve-ops-panel">
              <div class="reserve-section-head">
                <div>
                  <h4>批量操作</h4>
                  <p>仅删除已过期预留位，不影响仍有效的记录。</p>
                </div>
              </div>
              <button type="button" class="reserve-btn danger full" :disabled="!canEdit || deletingExpired" @click="confirmRemoveExpiredMembers">
                {{ deletingExpired ? "删除中..." : "一键删除过期" }}
              </button>
            </section>

            <section class="reserve-edit-panel quick-renew-panel">
              <div class="reserve-section-head">
                <div>
                  <h4>快捷续期</h4>
                  <p>选中左侧玩家后，直接点击天数即可续期，不需要重复填写表单。</p>
                </div>
              </div>

              <template v-if="selectedMember">
                <div class="reserve-save-preview">
                  <span>当前到期</span>
                  <strong>{{ selectedMember.expireAt ?? "未设置 / 已过期从现在算" }}</strong>
                </div>

                <div class="quick-renew-grid">
                  <button
                    v-for="days in quickDays"
                    :key="`selected-${days}`"
                    type="button"
                    class="reserve-btn primary"
                    :disabled="!canEdit || saving"
                    @click="extendSelectedMember(days)"
                  >
                    {{ saving && pendingExtendDays === days ? `续期中...` : `+${days} 天` }}
                  </button>
                </div>

                <div class="reserve-search-row">
                  <label class="reserve-field reserve-field-compact">
                    <span>自定义天数</span>
                    <input v-model.number="selectedCustomDays" class="reserve-input" type="number" min="1" step="1">
                  </label>
                  <button type="button" class="reserve-btn" :disabled="!canEdit || saving || !selectedCustomDaysValid" @click="extendSelectedMember(selectedCustomDays)">
                    自定义续期
                  </button>
                </div>
              </template>

              <div v-else class="reserve-detail-empty">
                <strong>先选中一个玩家</strong>
                <p>高频操作建议直接在这里续期，避免重复填写。</p>
              </div>
            </section>

            <form class="reserve-edit-panel manual-form-panel" @submit.prevent="saveMember">
              <div class="reserve-section-head">
                <div>
                  <h4>新增玩家 / 手动指定</h4>
                  <p>这里只用于新增预留位，或需要精确覆盖到期时间时使用。</p>
                </div>
              </div>

              <label class="reserve-field">
                <span>玩家搜索</span>
                <div class="reserve-search-row">
                  <input v-model.trim="playerKeyword" class="reserve-input" type="search" placeholder="玩家名或 Steam64">
                  <button type="button" class="reserve-mini-btn" :disabled="searchingPlayers || !playerKeyword" @click="searchPlayerDatabase">
                    {{ searchingPlayers ? "搜索中..." : "搜索" }}
                  </button>
                </div>
              </label>

              <div v-if="playerResults.length" class="reserve-player-results">
                <button
                  v-for="player in playerResults"
                  :key="player.steamId || player.eosId || player.name"
                  type="button"
                  class="reserve-player-result"
                  :disabled="!player.steamId"
                  @click="selectPlayer(player)"
                >
                  <strong>{{ player.name }}</strong>
                  <span class="mono">{{ player.steamId || "无 Steam64" }}</span>
                </button>
              </div>

              <div class="reserve-form-grid">
                <label class="reserve-field">
                  <span>Steam64</span>
                  <input v-model.trim="form.steamId" class="reserve-input mono" type="text" placeholder="7656119..." required>
                </label>

                <label class="reserve-field">
                  <span>玩家名</span>
                  <input v-model.trim="form.name" class="reserve-input" type="text" placeholder="建议填写，便于识别">
                </label>
              </div>

              <label class="reserve-field">
                <span>预留位组</span>
                <select v-model="form.group" class="reserve-select" required>
                  <option v-for="group in groupOptions" :key="group" :value="group">{{ group }}</option>
                </select>
              </label>

              <div class="reserve-expire-tabs">
                <button type="button" :class="{ active: expireMode === 'extend' }" @click="expireMode = 'extend'">续期天数</button>
                <button type="button" :class="{ active: expireMode === 'exact' }" @click="expireMode = 'exact'">精确到期时间</button>
              </div>

              <div v-if="expireMode === 'extend'" class="reserve-duration-row">
                <button v-for="days in quickDays" :key="days" type="button" class="reserve-duration-btn" :class="{ active: form.durationDays === days }" @click="setDurationDays(days)">
                  +{{ days }} 天
                </button>
                <label class="reserve-field reserve-field-compact">
                  <span>自定义天数</span>
                  <input v-model.number="form.durationDays" class="reserve-input" type="number" min="1" step="1">
                </label>
              </div>

              <label v-else class="reserve-field">
                <span>到期时间</span>
                <input v-model="form.exactExpireAt" class="reserve-input" type="datetime-local" required>
              </label>

              <label class="reserve-field">
                <span>原因</span>
                <input v-model.trim="form.reason" class="reserve-input" type="text" placeholder="可选，例如活动补偿 / 手动续期">
              </label>

              <div class="reserve-save-preview">
                <span>当前到期</span>
                <strong>{{ currentExpireText }}</strong>
              </div>
              <div class="reserve-save-preview">
                <span>{{ expireMode === "extend" ? "续期后到期" : "将覆盖为" }}</span>
                <strong>{{ computedExpireAt || "请选择有效时间" }}</strong>
              </div>

              <button type="submit" class="reserve-btn primary full" :disabled="!canEdit || saving || !canSubmit">
                {{ saving ? "提交中..." : (expireMode === "extend" ? "添加 / 续期预留位时间" : "保存精确到期时间") }}
              </button>
            </form>

            <section class="reserve-detail-panel">
              <template v-if="selectedMember">
                <div class="reserve-section-head">
                  <div>
                    <h4>{{ selectedMember.name || "未命名玩家" }}</h4>
                    <p>当前选中的预留位详情。</p>
                  </div>
                  <div class="reserve-detail-actions">
                    <button type="button" class="reserve-mini-btn" @click="openPlayerDatabase(selectedMember.name || selectedMember.steamId)">玩家库</button>
                    <button type="button" class="reserve-mini-btn" :disabled="!canEdit" @click="fillFromSelectedMember">带入下方表单</button>
                  </div>
                </div>

                <div class="reserve-detail-sheet">
                  <div class="reserve-detail-row">
                    <span>玩家名</span>
                    <strong class="selectable">{{ selectedMember.name || "未命名玩家" }}</strong>
                  </div>
                  <div class="reserve-detail-row">
                    <span>Steam64</span>
                    <strong class="mono selectable">{{ selectedMember.steamId }}</strong>
                  </div>
                  <div class="reserve-detail-row">
                    <span>预留位组</span>
                    <strong class="selectable">{{ selectedMember.group }}</strong>
                  </div>
                  <div class="reserve-detail-row">
                    <span>到期时间</span>
                    <strong class="selectable">{{ selectedMember.expireAt ?? "未设置" }}</strong>
                  </div>
                  <div class="reserve-detail-row">
                    <span>剩余时间</span>
                    <strong>{{ getRemainingText(selectedMember) }}</strong>
                  </div>
                </div>

                <div class="reserve-detail-actions">
                  <button type="button" class="reserve-mini-btn danger" :disabled="!canEdit || deletingSteamId === selectedMember.steamId" @click="confirmRemoveMember(selectedMember)">
                    {{ deletingSteamId === selectedMember.steamId ? "删除中..." : "删除该玩家预留位" }}
                  </button>
                </div>
              </template>

              <div v-else class="reserve-detail-empty">
                <strong>未选择条目</strong>
                <p>从左侧名单选择一个玩家后，这里会显示详情和续期入口。</p>
              </div>
            </section>
          </aside>
        </div>
      </section>

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

        <div class="cdk-toolbar">
          <div>
            <h4>CDK 批次列表</h4>
            <p class="subtitle">左侧直接展示每批次 CDK，右侧固定用于新增预留位 CDK 批次。</p>
          </div>
        </div>

        <div class="batch-workspace batch-workspace-split">
          <section class="batch-list-panel">
            <div class="reserve-section-head">
              <div>
                <h4>已有批次</h4>
                <p>每个批次直接展开可复制的 CDK。</p>
              </div>
              <span class="reserve-section-stat">{{ cdkBatches.length }}</span>
            </div>

            <div v-if="!cdkBatches.length" class="reserve-empty card-empty batch-empty">暂无有效 CDK 批次。</div>
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
          </section>

          <form class="reserve-edit-panel batch-create-panel" @submit.prevent="submitBatchCreate">
            <div class="reserve-section-head">
              <div>
                <h4>新增预留位 CDK 批次</h4>
                <p>右侧固定窗口专门用于创建批次。</p>
              </div>
            </div>

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

            <div class="reserve-save-preview">
              <span>批次预览</span>
              <strong>{{ batchForm.codeType || "CDK" }} / {{ Number(batchForm.quantity) || 0 }} 个 / {{ Number(batchForm.durationDays) || 0 }} 天</strong>
            </div>

            <button type="submit" class="reserve-btn primary full" :disabled="!canEdit || batchCreating">
              {{ batchCreating ? "创建中..." : "创建批次" }}
            </button>
          </form>
        </div>
      </section>

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

        <div class="reserve-filter-row activation-filters">
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

        <div v-if="!filteredActivations.length" class="reserve-empty card-empty">暂无匹配的激活记录。</div>
        <div v-else class="activation-table-wrap">
          <table class="activation-table">
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
          </table>
        </div>
      </section>
    </template>

    <div v-if="batchModalOpen" class="modal-backdrop" @click.self="closeBatchCreateModal">
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

    <div v-if="recordsModal.open" class="modal-backdrop" @click.self="closeBatchRecords">
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

        <div v-if="recordsModal.loading" class="reserve-empty card-empty">正在加载激活记录...</div>
        <div v-else-if="!recordsModal.records.length" class="reserve-empty card-empty">该批次暂无激活记录。</div>
        <div v-else class="activation-table-wrap">
          <table class="activation-table">
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
          </table>
        </div>
      </section>
    </div>

    <div v-if="detailModal.open" class="modal-backdrop" @click.self="closeBatchDetail">
      <section class="modal-panel records-modal">
        <header>
          <div>
            <h2>CDK 批次概览</h2>
            <p class="subtitle">{{ detailModal.batch?.codeType }} / {{ detailModal.batch?.id }}</p>
          </div>
          <button class="icon-button" type="button" @click="closeBatchDetail">脳</button>
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
        <div v-else class="reserve-empty card-empty">该批次没有可展示的 CDK。</div>
      </section>
    </div>

    <div v-if="batchWindow.open" class="modal-backdrop" @click.self="closeBatchWindow">
      <section class="modal-panel batch-window-modal">
        <header>
          <div>
            <h2>CDK 批次窗口</h2>
            <p class="subtitle">专门查看、创建、复制和报销 CDK 批次。</p>
          </div>
          <button class="icon-button" type="button" @click="closeBatchWindow">脳</button>
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

        <div v-if="!cdkBatches.length" class="reserve-empty card-empty">暂无有效 CDK 批次。</div>
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
const searchingPlayers = ref(false);
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
const playerKeyword = ref("");
const playerResults = ref<SearchablePlayer[]>([]);
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

async function searchPlayerDatabase() {
  const query = playerKeyword.value.trim();
  if (!query || searchingPlayers.value) return;
  searchingPlayers.value = true;
  error.value = null;

  try {
    playerResults.value = await searchPlayers(query);
  } catch (err) {
    error.value = renderError(err);
  } finally {
    searchingPlayers.value = false;
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

function selectPlayer(player: SearchablePlayer) {
  if (!player.steamId) return;
  form.steamId = player.steamId;
  form.name = player.name;
  playerKeyword.value = player.name || player.steamId;
  if (currentMember.value?.group) {
    form.group = currentMember.value.group;
  }
}

function fillFromSelectedMember() {
  if (!selectedMember.value) return;
  form.steamId = selectedMember.value.steamId;
  form.group = selectedMember.value.group || groupOptions.value[0] || "BZSSVIP";
  form.name = selectedMember.value.name || "";
  playerKeyword.value = selectedMember.value.name || selectedMember.value.steamId;
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
  display: grid;
  grid-template-rows: auto auto auto minmax(0, 1fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.reserve-head,
.reserve-section-head,
.reserve-actions,
.reserve-filter-row,
.reserve-search-row,
.reserve-duration-row,
.reserve-detail-actions,
.cdk-toolbar,
.cdk-batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.reserve-head,
.reserve-section-head,
.cdk-toolbar {
  justify-content: space-between;
  align-items: flex-start;
}

.reserve-head-copy,
.reserve-section-head > div:first-child {
  display: grid;
  gap: 4px;
}

.reserve-head h3,
.reserve-section-head h4,
.modal-panel h2 {
  margin: 0;
}

.reserve-head p,
.reserve-section-head p,
.reserve-meta-strip,
.reserve-section-stat,
.cdk-batch-meta,
.cdk-batch-details,
.subtitle {
  margin: 0;
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-tabs {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

.reserve-tab {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.05);
  color: var(--color-text-secondary);
  border-radius: 999px;
  padding: 9px 14px;
  cursor: pointer;
}

.reserve-tab.active {
  border-color: rgba(96, 165, 250, 0.42);
  background: #1d4ed830;
  color: var(--color-text-primary);
}

.reserve-tab-panel {
  display: grid;
  gap: 14px;
  min-height: 0;
  overflow: hidden;
}

.reserve-tab-panel-fixed {
  grid-template-rows: auto auto minmax(0, 1fr);
}

.reserve-btn,
.reserve-mini-btn,
.reserve-duration-btn,
.ghost-button,
.primary-button,
.icon-button {
  border: 1px solid var(--color-border-soft);
  background: #ffffff08;
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 12px;
  cursor: pointer;
}

.reserve-btn.primary,
.reserve-duration-btn.active,
.primary-button,
.primary-like {
  border-color: rgba(96, 165, 250, 0.42);
  background: #1d4ed830;
}

.reserve-btn.danger,
.reserve-mini-btn.danger {
  border-color: rgba(248, 113, 113, 0.34);
  background: #7f1d1d24;
}

.reserve-btn.full {
  width: 100%;
}

.reserve-btn:disabled,
.reserve-mini-btn:disabled,
.reserve-duration-btn:disabled,
.primary-button:disabled,
.ghost-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.reserve-mini-btn,
.icon-button {
  padding: 7px 10px;
}

.hidden-input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.reserve-state-box,
.reserve-notice,
.reserve-summary-card,
.reserve-list-panel,
.reserve-ops-panel,
.reserve-edit-panel,
.reserve-detail-panel,
.cdk-batch-card,
.card-empty,
.modal-panel {
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02)),
    rgba(255, 255, 255, 0.03);
  border-radius: 10px;
}

.reserve-state-box,
.reserve-notice,
.reserve-list-panel,
.reserve-ops-panel,
.reserve-edit-panel,
.reserve-detail-panel,
.cdk-batch-card,
.card-empty,
.modal-panel {
  padding: 12px;
}

.reserve-state-box.error {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  color: #ffc4c4;
}

.reserve-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.reserve-summary-card {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
}

.reserve-summary-card span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-summary-card strong {
  font-size: 22px;
  line-height: 1;
}

.reserve-summary-card.active strong {
  color: #b7f1c9;
}

.reserve-summary-card.expired strong {
  color: #ffb5ae;
}

.reserve-summary-card.subtle strong {
  font-size: 16px;
}

.reserve-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(360px, 0.95fr);
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.batch-workspace,
.activation-workspace {
  min-height: 0;
  overflow: hidden;
}

.batch-workspace {
  display: grid;
}

.batch-workspace-split {
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.85fr);
  gap: 14px;
  height: 100%;
}

.batch-list-panel,
.batch-create-panel {
  min-height: 0;
}

.batch-list-panel {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  gap: 12px;
}

.activation-workspace {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
}

.reserve-list-panel,
.reserve-side,
.reserve-ops-panel,
.reserve-edit-panel,
.reserve-detail-panel {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
}

.reserve-list-panel {
  grid-template-rows: auto auto auto minmax(0, 1fr);
}

.reserve-side {
  grid-template-rows: auto minmax(0, 0.9fr) minmax(0, 1.15fr) minmax(0, 0.95fr);
}

.quick-renew-panel {
  align-content: start;
}

.manual-form-panel {
  align-content: start;
}

.reserve-edit-panel,
.reserve-detail-panel {
  align-content: start;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}

.reserve-meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 10px 16px;
  padding-bottom: 2px;
}

.reserve-input,
.reserve-select {
  min-width: 0;
  border: 1px solid var(--color-border-soft);
  background: #05081066;
  color: var(--color-text-primary);
  border-radius: 8px;
  padding: 8px 10px;
}

.reserve-filter-row .reserve-input,
.reserve-search-row .reserve-input {
  flex: 1 1 220px;
}

.reserve-list-scroll {
  height: 100%;
  min-height: 0;
  overflow: auto;
  display: grid;
  gap: 6px;
  padding-right: 2px;
}

.reserve-list-grid {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(180px, 1.15fr) minmax(96px, 0.7fr) minmax(170px, 1fr) minmax(110px, 0.8fr);
  gap: 12px;
  align-items: center;
}

.reserve-list-grid-head {
  padding: 0 6px 6px;
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
}

.reserve-row {
  border: 1px solid var(--color-border-soft);
  background:
    linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01)),
    rgba(255,255,255,0.02);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
}

.reserve-row:hover {
  border-color: #60a5fa5c;
}

.reserve-row.active {
  border-color: #60a5fa9a;
  background:
    linear-gradient(180deg, rgba(37, 99, 235, 0.18), rgba(37, 99, 235, 0.08)),
    rgba(255,255,255,0.02);
}

.reserve-row.expired,
.cdk-batch-card.deactivated {
  opacity: 0.88;
}

.reserve-cell {
  min-width: 0;
  color: var(--color-text-secondary);
  font-size: 12px;
}

.reserve-player-cell strong {
  display: block;
  color: var(--color-text-primary);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.reserve-state-cell {
  display: grid;
  gap: 4px;
}

.reserve-state-cell small {
  color: var(--color-text-muted);
  font-size: 11px;
}

.reserve-pill {
  display: inline-flex;
  align-items: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
}

.reserve-pill.active {
  border: 1px solid rgba(74, 222, 128, 0.28);
  background: #4ade801a;
  color: #b9f5cc;
}

.reserve-pill.expired {
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: #f871711a;
  color: #ffc7c2;
}

.reserve-player-results {
  display: grid;
  gap: 6px;
  max-height: 168px;
  overflow: auto;
}

.reserve-player-result {
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  border-radius: 8px;
  padding: 8px 10px;
  display: grid;
  gap: 4px;
  text-align: left;
}

.reserve-player-result span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-player-result:disabled {
  opacity: 0.55;
}

.reserve-form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.reserve-field {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.reserve-field span,
.reserve-save-preview span {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-field-compact {
  flex: 1 1 140px;
}

.reserve-expire-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border: 1px solid var(--color-border-soft);
  border-radius: 8px;
  overflow: hidden;
}

.reserve-expire-tabs button {
  border: 0;
  background: transparent;
  color: var(--color-text-secondary);
  padding: 8px 10px;
}

.reserve-expire-tabs button.active {
  background: #2563eb2b;
  color: var(--color-text-primary);
}

.reserve-save-preview {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  border: 1px dashed var(--color-border-soft);
  border-radius: 8px;
  padding: 10px;
}

.quick-renew-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.reserve-detail-sheet {
  display: grid;
  gap: 10px;
}

.reserve-detail-row {
  display: grid;
  grid-template-columns: 96px minmax(0, 1fr);
  gap: 14px;
  align-items: center;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.03);
  border-radius: 8px;
}

.reserve-detail-row span {
  color: var(--color-text-muted);
  font-size: 11px;
  text-transform: uppercase;
}

.reserve-detail-row strong {
  color: var(--color-text-primary);
  min-width: 0;
  overflow-wrap: anywhere;
}

.reserve-detail-empty,
.reserve-empty {
  color: var(--color-text-muted);
  font-size: 12px;
}

.reserve-detail-empty,
.card-empty {
  border: 1px dashed var(--color-border-soft);
  border-radius: 8px;
  padding: 16px;
  display: grid;
  gap: 6px;
}

.selectable {
  user-select: text;
  cursor: text;
}

.mono,
.created-code-list code,
.activation-table .mono,
.cdk-batch-meta {
  font-family: ui-monospace, SFMono-Regular, Consolas, Liberation Mono, monospace;
}

.cdk-batch-grid {
  display: grid;
  gap: 6px;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
  align-content: start;
}

.cdk-batch-card {
  display: grid;
  gap: 6px;
  cursor: pointer;
}

.cdk-batch-card.compact {
  gap: 8px;
}

.cdk-batch-card.active {
  border-color: #60a5fa9a;
  background:
    linear-gradient(180deg, rgba(37, 99, 235, 0.18), rgba(37, 99, 235, 0.08)),
    rgba(255,255,255,0.02);
}

.batch-create-card {
  align-content: start;
}

.cdk-batch-head {
  display: flex;
  justify-content: space-between;
  gap: 6px;
  align-items: flex-start;
}

.cdk-batch-title-row {
  display: flex;
  gap: 4px;
  align-items: center;
  flex-wrap: wrap;
}

.cdk-batch-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
}

.compact-metrics {
  grid-template-columns: repeat(5, minmax(72px, 1fr));
}

.cdk-metric {
  display: grid;
  gap: 1px;
  padding: 5px 6px;
  border-radius: 5px;
  border: 1px solid rgba(255,255,255,0.06);
  background: rgba(255,255,255,0.03);
}

.cdk-metric span {
  color: var(--color-text-muted);
  font-size: 10px;
}

.cdk-metric strong {
  font-size: 15px;
  line-height: 1.1;
}

.cdk-batch-details {
  display: grid;
  gap: 1px;
  font-size: 10px;
  line-height: 1.35;
}

.compact-details {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 10px;
}

.created-code-list {
  display: grid;
  gap: 4px;
  max-height: 220px;
  overflow: auto;
}

.inline-code-list {
  max-height: 136px;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
}

.created-code-list code {
  display: block;
  padding: 6px 8px;
  border-radius: 6px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.06);
  font-size: 12px;
  line-height: 1.25;
}

.activation-table-wrap {
  height: 100%;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
}

.batch-empty,
.activation-empty {
  align-content: start;
}

.activation-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 980px;
}

.activation-table th,
.activation-table td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  vertical-align: top;
}

.activation-table thead th {
  position: sticky;
  top: 0;
  background: rgba(17, 24, 39, 0.94);
  z-index: 1;
  color: var(--color-text-muted);
  font-size: 12px;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-confirm-dialog);
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(4, 10, 18, 0.7);
  backdrop-filter: blur(4px);
}

.modal-panel {
  width: min(720px, 100%);
  display: grid;
  gap: 12px;
}

.modal-panel.compact {
  width: min(520px, 100%);
}

.modal-panel header,
.modal-panel footer {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
}

.modal-actions-row {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.compact-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.detail-stack {
  gap: 3px;
}

.cdk-batch-actions .reserve-mini-btn {
  padding: 6px 8px;
  font-size: 12px;
}

.cdk-batch-meta {
  font-size: 11px;
  line-height: 1.2;
}

.records-modal {
  max-height: min(80vh, 900px);
}

.checkbox-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: var(--color-text-secondary);
}

@media (max-width: 1100px) {
  .reserve-workspace {
    grid-template-columns: 1fr;
  }

  .batch-workspace-split {
    grid-template-columns: 1fr;
  }

  .reserve-side {
    grid-template-rows: auto auto auto auto;
  }
}

@media (max-width: 800px) {
  .reserve-summary-grid,
  .cdk-batch-metrics,
  .reserve-form-grid,
  .quick-renew-grid {
    grid-template-columns: 1fr 1fr;
  }

  .reserve-list-grid {
    grid-template-columns: 1fr;
    gap: 6px;
  }

  .reserve-list-grid-head {
    display: none;
  }
}

@media (max-width: 560px) {
  .reserve-summary-grid,
  .cdk-batch-metrics,
  .reserve-form-grid,
  .quick-renew-grid {
    grid-template-columns: 1fr;
  }
}
</style>
