<template>
  <AppPage class="squad-name-rules-page" full-bleed>
    <WorkspaceToolbar>
      <div class="toolbar-left-block">
        <button class="toolbar-button back-btn" type="button" @click="goBack">
          ← 返回建队规则链
        </button>
        <span class="page-title">规则维护 (Excel 表格)</span>
      </div>
      <div class="toolbar-status">
        <AppStatusBadge tone="idle">{{ filteredEntryCount }} 条记录</AppStatusBadge>
        <AppStatusBadge :tone="dirty ? 'warn' : 'ok'">
          {{ dirty ? "未保存" : "已同步" }}
        </AppStatusBadge>
      </div>
      <template #actions>
        <input
          v-model.trim="filterText"
          type="search"
          placeholder="搜索载具/别名/关键字..."
          class="toolbar-search"
        />
        <button class="toolbar-button" type="button" :disabled="loading" @click="loadState">
          刷新
        </button>
        <button v-if="canSave" class="toolbar-button primary" type="button" @click="addEntry">
          + 新增载具
        </button>
        <button
          v-if="canSave"
          class="toolbar-button success-btn"
          type="button"
          :disabled="saving || !dirty"
          @click="saveState"
        >
          {{ saving ? "保存中..." : "保存更改" }}
        </button>
        <button
          class="toolbar-button"
          type="button"
          :class="{ active: showSidebar }"
          @click="showSidebar = !showSidebar"
        >
          ⚙️ 配置与 JSON
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>

    <div class="workspace-content">
      <!-- Excel spreadsheet area -->
      <div class="excel-grid-container">
        <table class="excel-table">
          <thead>
            <tr>
              <th class="col-num">No.</th>
              <th class="col-faction">阵营</th>
              <th class="col-type">类型</th>
              <th class="col-name">标准队名</th>
              <th class="col-aliases">别名 (双击或按回车编辑)</th>
              <th class="col-keywords">关键字 (双击或按回车编辑)</th>
              <th class="col-asset">资产名</th>
              <th v-if="canSave" class="col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(entry, index) in visibleEntries" :key="entry.id" class="excel-row">
              <td class="cell-num">{{ index + 1 }}</td>
              
              <!-- Faction -->
              <td class="cell-input">
                <input
                  v-model="entry.faction"
                  :disabled="!canSave"
                  @input="markDirty"
                  placeholder="e.g. RU"
                  class="excel-input-field"
                />
              </td>

              <!-- Vehicle Type -->
              <td class="cell-input">
                <input
                  v-model="entry.vehicleType"
                  :disabled="!canSave"
                  @input="markDirty"
                  placeholder="e.g. Tank"
                  class="excel-input-field"
                />
              </td>

              <!-- Standard Name -->
              <td class="cell-input">
                <input
                  v-model="entry.name"
                  :disabled="!canSave"
                  @input="markDirty"
                  placeholder="标准名"
                  class="excel-input-field"
                />
              </td>

              <!-- Aliases -->
              <td
                class="cell-expandable"
                :class="{ 
                  'is-editing': activeCell === `${entry.id}-aliases`,
                  'readonly-cell': !canSave
                }"
                @dblclick="startEdit(entry.id, 'aliases')"
                @keydown.enter.prevent="startEdit(entry.id, 'aliases')"
                tabindex="0"
              >
                <textarea
                  v-if="canSave && activeCell === `${entry.id}-aliases`"
                  v-model="entry.aliasText"
                  v-focus
                  @blur="endEdit(entry, 'aliases')"
                  @keydown.esc="activeCell = null"
                  class="excel-textarea-field"
                  placeholder="每行一个别名"
                />
                <div v-else class="cell-tags-display">
                  <span v-if="!entry.aliases.length" class="empty-placeholder">-</span>
                  <span
                    v-for="alias in entry.aliases"
                    :key="alias"
                    class="excel-tag alias-tag"
                  >
                    {{ alias }}
                  </span>
                </div>
              </td>

              <!-- Keywords -->
              <td
                class="cell-expandable"
                :class="{ 
                  'is-editing': activeCell === `${entry.id}-keywords`,
                  'readonly-cell': !canSave
                }"
                @dblclick="startEdit(entry.id, 'keywords')"
                @keydown.enter.prevent="startEdit(entry.id, 'keywords')"
                tabindex="0"
              >
                <textarea
                  v-if="canSave && activeCell === `${entry.id}-keywords`"
                  v-model="entry.keywordText"
                  v-focus
                  @blur="endEdit(entry, 'keywords')"
                  @keydown.esc="activeCell = null"
                  class="excel-textarea-field"
                  placeholder="每行一个关键字"
                />
                <div v-else class="cell-tags-display">
                  <span v-if="!entry.keywords.length" class="empty-placeholder">-</span>
                  <span
                    v-for="kw in entry.keywords"
                    :key="kw"
                    class="excel-tag keyword-tag"
                  >
                    {{ kw }}
                  </span>
                </div>
              </td>

              <!-- Asset -->
              <td class="cell-input">
                <input
                  v-model="entry.asset"
                  :disabled="!canSave"
                  @input="markDirty"
                  placeholder="资产代码"
                  class="excel-input-field"
                />
              </td>

              <!-- Delete Action -->
              <td v-if="canSave" class="cell-actions">
                <button
                  type="button"
                  class="row-delete-btn"
                  @click="removeEntry(entry.id)"
                  title="删除此行"
                >
                  ✕
                </button>
              </td>
            </tr>
            <tr v-if="visibleEntries.length === 0">
              <td :colspan="canSave ? 8 : 7" class="excel-empty-row">
                暂无匹配的数据
              </td>
            </tr>
          </tbody>
        </table>
        
        <div v-if="filteredEntryCount > visibleEntries.length" class="load-more-container">
          <button type="button" class="load-more-btn" @click="showMoreEntries">
            显示更多 {{ visibleEntries.length }}/{{ filteredEntryCount }}
          </button>
        </div>
      </div>

      <!-- Right sidebar for configurations and JSON editing -->
      <transition name="slide">
        <aside v-if="showSidebar" class="rules-sidebar">
          <div class="sidebar-header">
            <h3>⚙️ 配置与高级维护</h3>
            <button class="close-sidebar-btn" type="button" @click="showSidebar = false">✕</button>
          </div>
          
          <div class="sidebar-content">
            <!-- Whitelist Configuration Form -->
            <section class="sidebar-section">
              <h4>白名单与匹配配置</h4>
              
              <label class="sidebar-field">
                <span>建议候选数量上限</span>
                <input
                  v-model.number="draft.suggestionLimit"
                  type="number"
                  min="1"
                  max="50"
                  :disabled="!canSave"
                  @input="markDirty"
                  class="sidebar-input"
                />
              </label>

              <label class="sidebar-field">
                <span>默认队名正则 (每行一个)</span>
                <textarea
                  v-model="draft.defaultNamePatternsText"
                  :disabled="!canSave"
                  @input="markDirty"
                  class="sidebar-textarea"
                />
              </label>

              <label class="sidebar-field">
                <span>步兵队白名单 (每行一个)</span>
                <textarea
                  v-model="draft.infantryNamesText"
                  :disabled="!canSave"
                  @input="markDirty"
                  class="sidebar-textarea"
                />
              </label>

              <label class="sidebar-field">
                <span>特种步兵队白名单 (每行一个)</span>
                <textarea
                  v-model="draft.specialInfantryNamesText"
                  :disabled="!canSave"
                  @input="markDirty"
                  class="sidebar-textarea"
                />
              </label>
            </section>

            <!-- JSON Editor -->
            <section class="sidebar-section">
              <div class="section-title-with-actions">
                <h4>JSON 原始数据编辑</h4>
                <button
                  v-if="canSave"
                  type="button"
                  class="sidebar-action-btn"
                  @click="syncJsonText"
                >
                  刷新 JSON
                </button>
              </div>
              <p class="section-help">保存前会按模块规则重新规范化，格式错误将无法保存。</p>
              
              <textarea
                v-model="jsonText"
                :disabled="!canSave"
                @input="onJsonEdited"
                class="json-sidebar-textarea"
                placeholder="原始 JSON 数据..."
              />
            </section>

            <!-- Metadata Info -->
            <section class="sidebar-section meta-section">
              <h4>规则统计</h4>
              <div class="meta-row">
                <span>规则文件路径</span>
                <span class="path-val" :title="state?.policyPath">{{ state?.source.fileName || "-" }}</span>
              </div>
              <div class="meta-row">
                <span>版本号</span>
                <span>{{ state?.version || 0 }}</span>
              </div>
              <div class="meta-row">
                <span>导入时间</span>
                <span>{{ formatTime(state?.importedAt) }}</span>
              </div>
              <div class="meta-row">
                <span>更新时间</span>
                <span>{{ formatTime(state?.updatedAt) }}</span>
              </div>
            </section>
          </div>
        </aside>
      </transition>
    </div>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, nextTick } from "vue";
import { useRouter } from "vue-router";

import { apiGet, apiPost, ApiError } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

type PolicyEntry = {
  id: string;
  faction: string;
  vehicleType: string;
  asset: string;
  name: string;
  aliases: string[];
  keywords: string[];
  searchTokens?: string[];
};

type EditableEntry = PolicyEntry & {
  aliasText: string;
  keywordText: string;
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

const auth = useAuthStore();
const ui = useUiStore();
const router = useRouter();

const canSave = computed(() => Boolean(auth.user?.isSuperAdmin));

const loading = ref(false);
const saving = ref(false);
const error = ref("");
const dirty = ref(false);
const state = ref<PolicyState | null>(null);
const entries = ref<EditableEntry[]>([]);
const jsonText = ref("");
const showSidebar = ref(false);
const filterText = ref("");
const activeCell = ref<string | null>(null);
const entryRenderLimit = ref(120);
const lastEditedSource = ref<'table' | 'json'>('table');

const draft = reactive({
  suggestionLimit: 5,
  defaultNamePatternsText: "",
  infantryNamesText: "",
  specialInfantryNamesText: "",
});

// Focus directive to focus cell textareas immediately
const vFocus = {
  mounted: (el: HTMLTextAreaElement) => {
    el.focus();
  },
};

const matchingEntries = computed(() => {
  const keyword = filterText.value.toLowerCase();
  const source = entries.value;
  if (!keyword) return source;
  return source.filter((entry) => [
    entry.faction,
    entry.vehicleType,
    entry.name,
    entry.aliasText,
    entry.keywordText,
    entry.asset,
  ].join(" ").toLowerCase().includes(keyword));
});

const filteredEntryCount = computed(() => matchingEntries.value.length);
const visibleEntries = computed(() => matchingEntries.value.slice(0, entryRenderLimit.value));

onMounted(() => {
  void loadState();
});

function goBack() {
  router.push("/squad-rule-chain");
}

async function loadState() {
  loading.value = true;
  error.value = "";
  try {
    const payload = await apiGet<PolicyState>("/api/squad-name-policy/state");
    applyState(payload);
  } catch (err) {
    error.value = formatError(err);
  } finally {
    loading.value = false;
  }
}

async function saveState() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    if (lastEditedSource.value === 'json') {
      if (!jsonText.value.trim()) {
        throw new Error("JSON 内容不能为空");
      }
      try {
        JSON.parse(jsonText.value);
      } catch (e) {
        throw new Error("JSON 格式错误，请核对后再保存: " + (e as Error).message);
      }
    }
    const payload = buildSavePayload();
    const saved = await apiPost<PolicyState>("/api/squad-name-policy/state", payload);
    applyState(saved);
    ui.pushToast({ title: "保存完成", message: "队名规范已保存。", tone: "ok" });
  } catch (err) {
    ui.pushToast({ title: "保存失败", message: formatError(err), tone: "error" });
  } finally {
    saving.value = false;
  }
}

function applyState(payload: PolicyState) {
  state.value = payload;
  draft.suggestionLimit = Number(payload.suggestionLimit || 5);
  draft.infantryNamesText = (payload.infantryNames ?? []).join("\n");
  draft.specialInfantryNamesText = (payload.specialInfantryNames ?? []).join("\n");
  draft.defaultNamePatternsText = (payload.defaultNamePatterns ?? []).join("\n");
  entries.value = payload.entries.map(toEditableEntry);
  entryRenderLimit.value = 120;
  jsonText.value = "";
  lastEditedSource.value = 'table';
  dirty.value = false;
}

function toEditableEntry(entry: PolicyEntry): EditableEntry {
  return {
    ...entry,
    aliases: Array.isArray(entry.aliases) ? entry.aliases : [],
    keywords: Array.isArray(entry.keywords) ? entry.keywords : [],
    aliasText: (entry.aliases ?? []).join("\n"),
    keywordText: (entry.keywords ?? []).join("\n"),
  };
}

function startEdit(id: string, field: 'aliases' | 'keywords') {
  if (!canSave.value) return;
  activeCell.value = `${id}-${field}`;
}

function endEdit(entry: EditableEntry, field: 'aliases' | 'keywords') {
  if (field === 'aliases') {
    entry.aliases = parseList(entry.aliasText);
  } else {
    entry.keywords = parseList(entry.keywordText);
  }
  activeCell.value = null;
  markDirty();
}

function buildSavePayload() {
  if (lastEditedSource.value === 'json') {
    const parsed = parseJsonText();
    if (parsed) return { ...parsed, suggestionLimit: draft.suggestionLimit };
  }
  return {
    version: state.value?.version ?? 1,
    source: state.value?.source ?? { type: "manual", fileName: "", path: "", sheetName: "" },
    importedAt: state.value?.importedAt ?? null,
    suggestionLimit: draft.suggestionLimit,
    defaultNamePatterns: parseList(draft.defaultNamePatternsText),
    infantryNames: parseList(draft.infantryNamesText),
    specialInfantryNames: parseList(draft.specialInfantryNamesText),
    entries: entries.value.map((entry) => ({
      id: entry.id,
      faction: entry.faction,
      vehicleType: entry.vehicleType,
      asset: entry.asset,
      name: entry.name,
      aliases: parseList(entry.aliasText),
      keywords: parseList(entry.keywordText),
      searchTokens: entry.searchTokens ?? [],
    })),
  };
}

function parseJsonText() {
  if (!jsonText.value) return null;
  try {
    const parsed = JSON.parse(jsonText.value);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.entries)) return parsed;
  } catch {
    return null;
  }
  return null;
}

function syncJsonText() {
  jsonText.value = JSON.stringify({
    version: state.value?.version ?? 1,
    source: state.value?.source ?? { type: "manual", fileName: "", path: "", sheetName: "" },
    importedAt: state.value?.importedAt ?? null,
    updatedAt: state.value?.updatedAt ?? null,
    suggestionLimit: draft.suggestionLimit,
    defaultNamePatterns: parseList(draft.defaultNamePatternsText),
    infantryNames: parseList(draft.infantryNamesText),
    specialInfantryNames: parseList(draft.specialInfantryNamesText),
    entries: entries.value.map((entry) => ({
      id: entry.id,
      faction: entry.faction,
      vehicleType: entry.vehicleType,
      asset: entry.asset,
      name: entry.name,
      aliases: parseList(entry.aliasText),
      keywords: parseList(entry.keywordText),
      searchTokens: entry.searchTokens ?? [],
    })),
  }, null, 2);
}

function addEntry() {
  entries.value.unshift(toEditableEntry({
    id: `manual:${Date.now().toString(36)}`,
    faction: "",
    vehicleType: "",
    asset: "",
    name: "New Vehicle",
    aliases: [],
    keywords: [],
    searchTokens: [],
  }));
  markDirty();
}

function removeEntry(id: string) {
  entries.value = entries.value.filter((entry) => entry.id !== id);
  markDirty();
}

function markDirty() {
  lastEditedSource.value = 'table';
  dirty.value = true;
}

function showMoreEntries() {
  entryRenderLimit.value = Math.min(filteredEntryCount.value, entryRenderLimit.value + 120);
}

function onJsonEdited() {
  lastEditedSource.value = 'json';
  dirty.value = true;
}

function parseList(text: string) {
  return Array.from(new Set(String(text ?? "").split(/[\r\n,，]+/).map((item) => item.trim()).filter(Boolean)));
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
.squad-name-rules-page {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.toolbar-left-block {
  display: flex;
  align-items: center;
  gap: 12px;
}

.back-btn {
  background: transparent;
  border-color: transparent;
  color: var(--color-text-secondary);
}

.back-btn:hover {
  color: var(--color-text-primary);
  background: rgba(255, 255, 255, 0.05);
}

.page-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.toolbar-search {
  width: 200px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  padding: 0 10px;
  font-size: 12px;
}

.toolbar-search:focus {
  border-color: var(--color-brand-primary);
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.15);
  outline: none;
}

.toolbar-button {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-card);
  color: var(--color-text-primary);
  border-radius: 6px;
  height: 32px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.toolbar-button:hover {
  background: var(--color-bg-hover);
  border-color: var(--color-text-secondary);
}

.toolbar-button.active {
  background: var(--color-bg-selected);
  border-color: var(--color-brand-primary);
  color: var(--color-text-primary);
}

.toolbar-button.primary {
  background: var(--color-brand-primary);
  border-color: var(--color-brand-primary);
  color: #040810;
  font-weight: 500;
}

.toolbar-button.primary:hover {
  filter: brightness(1.1);
}

.success-btn {
  background: var(--color-status-success);
  border-color: var(--color-status-success);
  color: #040810;
  font-weight: 500;
}

.success-btn:hover {
  filter: brightness(1.1);
}

.success-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.banner.error {
  border: 1px solid color-mix(in srgb, var(--color-status-error) 40%, var(--color-border-default));
  background: color-mix(in srgb, var(--color-status-error) 12%, transparent);
  border-radius: 8px;
  padding: 10px 12px;
  margin: 12px;
}

.workspace-content {
  flex: 1;
  display: flex;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

/* Excel spreadsheet grid */
.excel-grid-container {
  flex: 1;
  overflow: auto;
  min-width: 0;
  min-height: 0;
  background: var(--color-bg-page);
  padding: 1px; /* prevents layout shift on outline focus */
}

.excel-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
  min-width: 1100px;
}

.excel-table th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-bg-panel);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  padding: 8px 10px;
  user-select: none;
}

.excel-table td {
  border: 1px solid var(--color-border-soft);
  padding: 0; /* padding handled inside cell for excel style */
  vertical-align: middle;
  height: 38px;
  position: relative;
}

/* Columns widths */
.col-num { width: 48px; }
.col-faction { width: 90px; }
.col-type { width: 100px; }
.col-name { width: 180px; }
.col-aliases { width: 320px; }
.col-keywords { width: 320px; }
.col-asset { width: 150px; }
.col-actions { width: 60px; }

.cell-num {
  text-align: center;
  background: rgba(255, 255, 255, 0.02);
  color: var(--color-text-disabled);
  font-family: monospace;
  font-size: 11px;
  user-select: none;
}

.excel-input-field {
  width: 100%;
  height: 38px;
  border: none;
  background: transparent;
  color: var(--color-text-primary);
  padding: 8px 10px;
  font-size: 12px;
  font-family: inherit;
  border-radius: 0;
}

.excel-input-field:focus {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-brand-primary);
  z-index: 5;
  position: relative;
  background: var(--color-bg-hover);
}

.cell-expandable {
  position: relative;
  cursor: pointer;
  height: 100%;
}

.cell-expandable:focus-within,
.cell-expandable:focus {
  outline: none;
  box-shadow: inset 0 0 0 2px var(--color-brand-primary);
  z-index: 5;
}

.cell-tags-display {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 6px 10px;
  align-items: center;
  min-height: 36px;
  overflow: hidden;
  max-height: 60px;
}

.empty-placeholder {
  color: var(--color-text-disabled);
  font-style: italic;
}

.excel-tag {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 500;
  line-height: 1.2;
}

.alias-tag {
  background: rgba(96, 165, 250, 0.08);
  border: 1px solid rgba(96, 165, 250, 0.16);
  color: var(--color-status-info);
}

.keyword-tag {
  background: rgba(244, 114, 182, 0.08);
  border: 1px solid rgba(244, 114, 182, 0.16);
  color: var(--color-brand-tertiary);
}

.excel-textarea-field {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: auto;
  min-height: 80px;
  z-index: 20;
  background: var(--color-bg-elevated);
  border: 2px solid var(--color-brand-primary);
  box-shadow: var(--shadow-lg);
  color: var(--color-text-primary);
  padding: 8px 10px;
  font-size: 12px;
  font-family: inherit;
  resize: vertical;
  outline: none;
}

.cell-actions {
  text-align: center;
}

.row-delete-btn {
  background: transparent;
  border: none;
  color: var(--color-status-danger);
  cursor: pointer;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  transition: all 0.2s;
}

.row-delete-btn:hover {
  background: rgba(248, 113, 113, 0.15);
}

.excel-empty-row {
  text-align: center;
  color: var(--color-text-muted);
  font-size: 12px;
  padding: 20px;
}

.load-more-container {
  display: flex;
  justify-content: center;
  padding: 16px;
}

.load-more-btn {
  background: var(--color-bg-card);
  border: 1px solid var(--color-border-default);
  color: var(--color-text-secondary);
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.load-more-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
  border-color: var(--color-text-secondary);
}

.readonly-cell {
  cursor: default;
}

/* Sidebar configuration drawer */
.rules-sidebar {
  width: 340px;
  border-left: 1px solid var(--color-border-default);
  background: var(--color-bg-panel);
  display: flex;
  flex-direction: column;
  min-height: 0;
  backdrop-filter: blur(16px);
  z-index: 30;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--color-border-default);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.close-sidebar-btn {
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  cursor: pointer;
  font-size: 14px;
}

.sidebar-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.sidebar-section {
  border: 1px solid var(--color-border-soft);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.015);
  padding: 14px;
}

.sidebar-section h4 {
  margin: 0 0 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 6px;
}

.section-title-with-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  padding-bottom: 6px;
}

.section-title-with-actions h4 {
  margin: 0;
  border-bottom: none;
  padding-bottom: 0;
}

.sidebar-action-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--color-border-default);
  border-radius: 4px;
  color: var(--color-text-secondary);
  font-size: 10px;
  padding: 2px 8px;
  cursor: pointer;
}

.sidebar-action-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text-primary);
}

.section-help {
  color: var(--color-text-disabled);
  font-size: 10px;
  margin: 0 0 10px;
}

.sidebar-field {
  display: grid;
  gap: 6px;
  margin-bottom: 12px;
}

.sidebar-field:last-child {
  margin-bottom: 0;
}

.sidebar-field span {
  font-size: 11px;
  color: var(--color-text-muted);
}

.sidebar-input {
  height: 32px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-text-primary);
  padding: 0 8px;
  font-size: 12px;
  width: 100%;
}

.sidebar-textarea {
  min-height: 80px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.3);
  color: var(--color-text-primary);
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.4;
  resize: vertical;
  width: 100%;
}

.json-sidebar-textarea {
  height: 240px;
  border: 1px solid var(--color-border-default);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.4);
  color: var(--color-text-secondary);
  padding: 8px;
  font-size: 11px;
  font-family: monospace;
  line-height: 1.4;
  resize: vertical;
  width: 100%;
}

.meta-section {
  font-size: 11px;
}

.meta-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  color: var(--color-text-muted);
}

.meta-row:last-child {
  margin-bottom: 0;
}

.path-val {
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 180px;
}

/* Sidebar Transition Animations */
.slide-enter-active,
.slide-leave-active {
  transition: all 0.3s ease;
}

.slide-enter-from,
.slide-leave-to {
  transform: translateX(100%);
  opacity: 0;
}
</style>
