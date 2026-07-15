<template>
  <AppPage class="policy-page" full-bleed>
    <WorkspaceToolbar>
      <div class="title-row">
        <button class="btn ghost" type="button" @click="goBack">← 返回规则链</button>
        <strong>队名规范维护</strong>
        <AppStatusBadge tone="idle">v{{ state?.version || 2 }} · r{{ state?.revision || 0 }}</AppStatusBadge>
        <AppStatusBadge :tone="dirty ? 'warn' : 'ok'">{{ dirty ? "存在未保存修改" : "已同步" }}</AppStatusBadge>
      </div>
      <template #actions>
        <button class="btn" type="button" :disabled="loading" @click="loadState">刷新</button>
        <button class="btn" type="button" @click="toggleAdvanced">JSON 导入/导出</button>
        <button v-if="canSave" class="btn primary" type="button" :disabled="saving || !dirty" @click="saveState">
          {{ saving ? "验证并保存中…" : "保存" }}
        </button>
      </template>
    </WorkspaceToolbar>

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-if="validation && !validation.valid" class="validation-banner">
      <strong>保存前校验发现 {{ validation.errors.length }} 个错误</strong>
      <button class="btn ghost" type="button" @click="validation = null">关闭</button>
      <ul>
        <li v-for="item in validation.errors.slice(0, 12)" :key="`${item.code}:${item.index}:${item.message}`">
          {{ item.index != null ? `第 ${item.index + 1} 行：` : "" }}{{ item.message }}
        </li>
      </ul>
    </div>

    <div class="tabs">
      <button :class="{ active: activeTab === 'rules' }" type="button" @click="activeTab = 'rules'">队名规则</button>
      <button :class="{ active: activeTab === 'types' }" type="button" @click="activeTab = 'types'">队伍类型</button>
    </div>

    <section v-if="activeTab === 'rules'" class="workspace">
      <div class="filters">
        <input v-model.trim="filters.search" type="search" placeholder="搜索队名、别名、关键词或资产…" />
        <select v-model="filters.nature"><option value="">全部性质</option><option v-for="nature in natures" :key="nature" :value="nature">{{ natureLabel(nature) }}</option></select>
        <select v-model="filters.typeId"><option value="">全部类型</option><option v-for="type in sortedTypes" :key="type.id" :value="type.id">{{ type.label }}</option></select>
        <select v-model="filters.status"><option value="">全部状态</option><option value="enabled">启用</option><option value="disabled">停用</option></select>
        <select v-model="filters.source"><option value="">全部来源</option><option v-for="sourceName in sources" :key="sourceName" :value="sourceName">{{ sourceName }}</option></select>
        <button v-if="canSave" class="btn" type="button" @click="addRule">新增队名规则</button>
        <button v-if="canSave" class="btn" type="button" @click="addTypeAndOpen">新增队伍类型</button>
      </div>

      <div v-if="selectedIds.length" class="bulk-bar">
        <strong>已选择 {{ selectedIds.length }} 条</strong>
        <select v-model="bulk.typeId"><option value="">批量类型</option><option v-for="type in enabledTypes" :key="type.id" :value="type.id">{{ type.label }}</option></select>
        <input v-model="bulk.faction" placeholder="批量阵营（可空）" />
        <input v-model.number="bulk.maxPlayersOverride" type="number" min="1" placeholder="规则人数覆盖" />
        <label><input v-model="bulk.clearOverride" type="checkbox" /> 清除人数覆盖</label>
        <select v-model="bulk.enabled"><option value="">启用状态</option><option value="true">启用</option><option value="false">停用</option></select>
        <label><input v-model="bulk.clearAsset" type="checkbox" /> 清除资产</label>
        <button class="btn primary" type="button" @click="applyBulk">应用批量修改</button>
        <button class="btn ghost" type="button" @click="selectedIds = []">取消选择</button>
      </div>

      <div class="test-bar">
        <span>实时测试</span>
        <input v-model.trim="testName" placeholder="例如 BMP队" @keyup.enter="runLiveTest" />
        <button class="btn" type="button" :disabled="testing || !testName" @click="runLiveTest">测试当前草稿</button>
        <div v-if="testResult" class="test-result" :data-valid="testResult.valid">
          <strong>{{ testResult.valid ? "允许" : "不允许" }}</strong>
          <span>规则 {{ testResult.classification?.ruleId || "-" }}</span>
          <span>{{ natureLabel(testResult.classification?.nature || "other") }} / {{ testResult.classification?.typeLabel || "未知" }}</span>
          <span>人数 {{ testResult.classification?.effectiveMaxPlayers ?? "不限" }}（{{ maxSourceLabel(testResult.classification?.maxPlayersSource) }}）</span>
          <span v-if="testResult.classification?.assetPath">资产 {{ testResult.classification.assetPath }}</span>
          <span>命中 {{ matchKindLabel(testResult.matched?.matchedKind) }}</span>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr>
            <th class="check"><input type="checkbox" :checked="allVisibleSelected" @change="toggleVisibleSelection" /></th>
            <th>状态</th><th>宽泛性质</th><th>队伍类型</th><th>允许队名</th><th>别名</th><th>关键词</th>
            <th>阵营</th><th>资产路径</th><th>类型默认人数</th><th>规则覆盖人数</th><th>最终人数</th><th>优先级</th><th>来源</th><th>操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="entry in visibleEntries" :key="entry.id" :class="{ invalid: invalidRuleIds.has(entry.id) }">
              <td class="check"><input v-model="selectedIds" type="checkbox" :value="entry.id" /></td>
              <td><button class="status" :data-enabled="entry.enabled" type="button" :disabled="!canSave" @click="entry.enabled = !entry.enabled; markDirty()">{{ entry.enabled ? "启用" : "停用" }}</button></td>
              <td>{{ natureLabel(typeFor(entry.typeId)?.nature || "other") }}</td>
              <td><select v-model="entry.typeId" :disabled="!canSave" @change="onEntryTypeChanged(entry)"><option v-for="type in sortedTypes" :key="type.id" :value="type.id">{{ type.label }}</option></select></td>
              <td><button class="name-link" type="button" @click="openEditor(entry.id)">{{ entry.name }}</button></td>
              <td class="truncate" :title="entry.aliases.join('、')">{{ entry.aliases.join("、") || "-" }}</td>
              <td class="truncate" :title="entry.keywords.join('、')">{{ entry.keywords.join("、") || "-" }}</td>
              <td>{{ entry.faction || "-" }}</td>
              <td class="truncate path" :title="entry.asset">{{ entry.asset || "-" }}</td>
              <td>{{ typeFor(entry.typeId)?.defaultMaxPlayers ?? "不限" }}</td>
              <td>{{ entry.maxPlayersOverride ?? "继承" }}</td>
              <td><strong>{{ effectiveMax(entry) ?? "不限" }}</strong></td>
              <td>{{ entry.priority }}</td><td>{{ entry.source }}</td>
              <td><button class="btn tiny" type="button" @click="openEditor(entry.id)">编辑</button></td>
            </tr>
            <tr v-if="!visibleEntries.length"><td colspan="15" class="empty">没有匹配的规则</td></tr>
          </tbody>
        </table>
        <button v-if="filteredEntries.length > renderLimit" class="load-more" type="button" @click="renderLimit += 100">显示更多（{{ visibleEntries.length }}/{{ filteredEntries.length }}）</button>
      </div>
    </section>

    <section v-else class="workspace types-workspace">
      <div class="filters">
        <strong>{{ types.length }} 个队伍类型</strong>
        <span class="muted">类型默认人数修改会立即影响所有未设置单条覆盖的关联规则。</span>
        <button v-if="canSave" class="btn" type="button" @click="addType">新增队伍类型</button>
      </div>
      <div class="table-wrap">
        <table class="types-table">
          <thead><tr><th>类型 ID</th><th>显示名称</th><th>宽泛性质</th><th>默认人数上限</th><th>资产模式</th><th>启用</th><th>排序</th><th>描述</th><th>关联规则</th><th>操作</th></tr></thead>
          <tbody>
            <tr v-for="type in sortedTypes" :key="type.id" :class="{ invalid: invalidTypeIds.has(type.id) }">
              <td><input v-model="type.id" :disabled="!canEditTypeId(type)" @input="markDirty" /></td>
              <td><input v-model="type.label" :disabled="!canSave" @input="markDirty" /></td>
              <td><select v-model="type.nature" :disabled="!canSave" @change="onTypeNatureChanged(type)"><option v-for="nature in natures" :key="nature" :value="nature">{{ natureLabel(nature) }}</option></select></td>
              <td><input v-model.number="type.defaultMaxPlayers" :disabled="!canSave" type="number" min="1" placeholder="不限" @input="markDirty" /><small v-if="ruleCount(type.id)">将影响 {{ inheritedRuleCount(type.id) }} 条规则</small></td>
              <td><select v-model="type.assetMode" :disabled="!canSave || type.nature !== 'vehicle'" @change="markDirty"><option value="none">禁止</option><option value="optional">可选</option><option value="required">必填</option></select></td>
              <td><input v-model="type.enabled" :disabled="!canSave" type="checkbox" @change="markDirty" /></td>
              <td><input v-model.number="type.sortOrder" :disabled="!canSave" type="number" @input="markDirty" /></td>
              <td><input v-model="type.description" :disabled="!canSave" @input="markDirty" /></td>
              <td>{{ ruleCount(type.id) }}</td>
              <td><button v-if="canSave" class="btn tiny danger" type="button" :disabled="ruleCount(type.id) > 0" :title="ruleCount(type.id) ? '请先将关联规则迁移到其他类型' : '删除类型'" @click="removeType(type.id)">删除</button></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <aside v-if="editorEntry" class="drawer">
      <header><div><strong>编辑队名规则</strong><small>{{ editorEntry.id }}</small></div><button class="btn ghost" type="button" @click="closeEditor">✕</button></header>
      <div class="drawer-body">
        <label>规则 ID<input v-model="editorEntry.id" disabled /></label>
        <label>允许队名<input v-model="editorEntry.name" :disabled="!canSave" @input="markDirty" /></label>
        <label>队伍类型<select v-model="editorEntry.typeId" :disabled="!canSave" @change="onEntryTypeChanged(editorEntry)"><option v-for="type in sortedTypes" :key="type.id" :value="type.id">{{ type.label }} / {{ natureLabel(type.nature) }}</option></select></label>
        <label>别名（每行一个）<textarea :value="editorEntry.aliases.join('\n')" :disabled="!canSave" @input="setList(editorEntry, 'aliases', $event)" /></label>
        <label>关键词（每行一个）<textarea :value="editorEntry.keywords.join('\n')" :disabled="!canSave" @input="setList(editorEntry, 'keywords', $event)" /></label>
        <label>阵营<input v-model="editorEntry.faction" :disabled="!canSave" @input="markDirty" /></label>
        <label>资产路径 <small>{{ assetHint(editorEntry) }}</small><input v-model="editorEntry.asset" :disabled="!canSave || typeFor(editorEntry.typeId)?.assetMode === 'none'" @input="markDirty" /></label>
        <div class="two-col"><label>规则覆盖人数<input v-model.number="editorEntry.maxPlayersOverride" :disabled="!canSave" type="number" min="1" placeholder="继承类型默认" @input="markDirty" /></label><label>最终人数<input :value="effectiveMax(editorEntry) ?? '不限'" disabled /></label></div>
        <div class="two-col"><label>优先级<input v-model.number="editorEntry.priority" :disabled="!canSave" type="number" @input="markDirty" /></label><label>来源<input v-model="editorEntry.source" :disabled="!canSave" @input="markDirty" /></label></div>
        <label class="inline"><input v-model="editorEntry.allowSquadSuffix" :disabled="!canSave" type="checkbox" @change="markDirty" />允许“队 / 小队 / Squad / Team”后缀</label>
        <label class="inline"><input v-model="editorEntry.enabled" :disabled="!canSave" type="checkbox" @change="markDirty" />启用规则</label>
        <label>备注<textarea v-model="editorEntry.notes" :disabled="!canSave" @input="markDirty" /></label>
        <button v-if="canSave" class="btn danger" type="button" @click="removeRule(editorEntry.id)">删除此规则</button>
      </div>
    </aside>

    <aside v-if="showAdvanced" class="drawer advanced">
      <header><div><strong>高级 JSON</strong><small>JSON 与表格草稿不会静默互相覆盖</small></div><button class="btn ghost" type="button" @click="showAdvanced = false">✕</button></header>
      <div class="drawer-body">
        <div class="button-row"><button class="btn" type="button" @click="syncJsonFromDraft">从当前表格生成</button><button class="btn" type="button" @click="exportJson">导出 JSON</button><label class="btn file-btn">导入文件<input type="file" accept="application/json,.json" @change="importJsonFile" /></label></div>
        <textarea v-model="jsonText" class="json-editor" @input="jsonEdited = true" />
        <button v-if="canSave" class="btn primary" type="button" :disabled="!jsonEdited" @click="applyJsonToDraft">明确应用 JSON 到表格草稿</button>
        <label>建议候选数量<input v-model.number="suggestionLimit" :disabled="!canSave" type="number" min="1" max="50" @input="markDirty" /></label>
        <label>默认队名正则（每行一个）<textarea :value="defaultNamePatterns.join('\n')" :disabled="!canSave" @input="setDefaultPatterns" /></label>
        <div class="meta"><span>配置文件</span><code>{{ state?.policyPath || "-" }}</code><span>迁移记录</span><strong>{{ state?.migrationWarnings?.length || 0 }}</strong></div>
      </div>
    </aside>
  </AppPage>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { onBeforeRouteLeave, useRouter } from "vue-router";
import { apiGet, apiPost, ApiError } from "../app/apiClient";
import AppPage from "../components/common/AppPage.vue";
import WorkspaceToolbar from "../components/common/WorkspaceToolbar.vue";
import AppStatusBadge from "../components/common/AppStatusBadge.vue";
import { useAuthStore } from "../stores/auth.store";
import { useUiStore } from "../stores/ui.store";

type Nature = "infantry" | "vehicle" | "support" | "logistics" | "other";
type SquadType = { id: string; label: string; nature: Nature; description: string; defaultMaxPlayers: number | null; assetMode: "none" | "optional" | "required"; enabled: boolean; sortOrder: number; ruleCount?: number };
type PolicyEntry = { id: string; name: string; aliases: string[]; keywords: string[]; typeId: string; faction: string; asset: string; maxPlayersOverride: number | null; allowSquadSuffix: boolean; enabled: boolean; priority: number; source: string; notes: string; legacyVehicleType?: string; searchTokens?: string[] };
type ValidationItem = { code: string; message: string; section?: string; index?: number; ruleId?: string; typeId?: string };
type ValidationResult = { valid: boolean; errors: ValidationItem[]; warnings: ValidationItem[] };
type PolicyState = { ok: boolean; policyPath: string; version: number; revision: number; source: Record<string, string>; importedAt: string | null; updatedAt: string | null; suggestionLimit: number; defaultNamePatterns: string[]; types: SquadType[]; entries: PolicyEntry[]; migrationWarnings?: unknown[]; validation?: ValidationResult };
type TestResult = { valid: boolean; matched?: { matchedKind?: string } | null; classification?: { nature: string; typeId: string; typeLabel: string; ruleId: string; effectiveMaxPlayers: number | null; maxPlayersSource: string; assetPath: string } | null };

const auth = useAuthStore(); const ui = useUiStore(); const router = useRouter();
const canSave = computed(() => Boolean(auth.user?.isSuperAdmin));
const state = ref<PolicyState | null>(null); const types = ref<SquadType[]>([]); const entries = ref<PolicyEntry[]>([]);
const suggestionLimit = ref(5); const defaultNamePatterns = ref<string[]>([]);
const loading = ref(false); const saving = ref(false); const dirty = ref(false); const error = ref(""); const validation = ref<ValidationResult | null>(null);
const activeTab = ref<"rules" | "types">("rules"); const renderLimit = ref(100); const selectedIds = ref<string[]>([]); const editorEntryId = ref("");
const showAdvanced = ref(false); const jsonText = ref(""); const jsonEdited = ref(false); const testName = ref("BMP队"); const testing = ref(false); const testResult = ref<TestResult | null>(null);
const natures: Nature[] = ["infantry", "vehicle", "support", "logistics", "other"];
const filters = reactive({ search: "", nature: "", typeId: "", status: "", source: "" });
const bulk = reactive({ typeId: "", faction: "", maxPlayersOverride: null as number | null, enabled: "", clearAsset: false, clearOverride: false });
const sortedTypes = computed(() => [...types.value].sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)));
const enabledTypes = computed(() => sortedTypes.value.filter((item) => item.enabled));
const sources = computed(() => [...new Set(entries.value.map((entry) => entry.source).filter(Boolean))].sort());
const typeMap = computed(() => new Map(types.value.map((type) => [type.id, type])));
const filteredEntries = computed(() => entries.value.filter((entry) => { const type = typeFor(entry.typeId); const search = filters.search.toLowerCase(); return (!search || [entry.name, entry.aliases.join(" "), entry.keywords.join(" "), entry.faction, entry.asset, entry.source].join(" ").toLowerCase().includes(search)) && (!filters.nature || type?.nature === filters.nature) && (!filters.typeId || entry.typeId === filters.typeId) && (!filters.status || (filters.status === "enabled") === entry.enabled) && (!filters.source || entry.source === filters.source); }));
const visibleEntries = computed(() => filteredEntries.value.slice(0, renderLimit.value));
const allVisibleSelected = computed(() => visibleEntries.value.length > 0 && visibleEntries.value.every((entry) => selectedIds.value.includes(entry.id)));
const editorEntry = computed(() => entries.value.find((entry) => entry.id === editorEntryId.value) ?? null);
const invalidRuleIds = computed(() => new Set((validation.value?.errors ?? []).map((item) => item.ruleId).filter(Boolean) as string[]));
const invalidTypeIds = computed(() => new Set((validation.value?.errors ?? []).map((item) => item.typeId).filter(Boolean) as string[]));

onMounted(() => { window.addEventListener("beforeunload", beforeUnload); void loadState(); });
onBeforeUnmount(() => window.removeEventListener("beforeunload", beforeUnload));
onBeforeRouteLeave(() => !dirty.value || window.confirm("队名规范存在未保存修改，确定离开吗？"));
function beforeUnload(event: BeforeUnloadEvent) { if (!dirty.value) return; event.preventDefault(); event.returnValue = ""; }
function goBack() { void router.push("/squad-rule-chain"); }
function typeFor(id: string) { return typeMap.value.get(id); }
function natureLabel(value: string) { return ({ infantry: "步兵", vehicle: "载具", support: "支援", logistics: "后勤", other: "其他" } as Record<string, string>)[value] || value; }
function maxSourceLabel(value?: string) { return value === "rule_override" ? "规则覆盖" : value === "type_default" ? "类型默认" : "无限制"; }
function matchKindLabel(value?: string) { return ({ canonical: "标准名", alias: "别名", suffix: "允许后缀", infantry: "步兵规则", special_infantry: "特种步兵规则" } as Record<string, string>)[value || ""] || value || "-"; }
function effectiveMax(entry: PolicyEntry) { return entry.maxPlayersOverride ?? typeFor(entry.typeId)?.defaultMaxPlayers ?? null; }
function ruleCount(typeId: string) { return entries.value.filter((entry) => entry.typeId === typeId).length; }
function inheritedRuleCount(typeId: string) { return entries.value.filter((entry) => entry.typeId === typeId && entry.maxPlayersOverride == null).length; }
function markDirty() { dirty.value = true; validation.value = null; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }
function normalizeEntry(entry: Partial<PolicyEntry>): PolicyEntry { return { id: entry.id || `rule:manual_${Date.now().toString(36)}`, name: entry.name || "新队名规则", aliases: Array.isArray(entry.aliases) ? entry.aliases : [], keywords: Array.isArray(entry.keywords) ? entry.keywords : [], typeId: entry.typeId || enabledTypes.value[0]?.id || "other", faction: entry.faction || "", asset: entry.asset || "", maxPlayersOverride: entry.maxPlayersOverride ?? null, allowSquadSuffix: entry.allowSquadSuffix !== false, enabled: entry.enabled !== false, priority: Number(entry.priority ?? 100), source: entry.source || "manual", notes: entry.notes || "", legacyVehicleType: entry.legacyVehicleType || "", searchTokens: entry.searchTokens || [] }; }
async function loadState() { if (dirty.value && !window.confirm("放弃未保存修改并刷新吗？")) return; loading.value = true; error.value = ""; try { applyState(await apiGet<PolicyState>("/api/squad-name-policy/state")); } catch (err) { error.value = formatError(err); } finally { loading.value = false; } }
function applyState(payload: PolicyState) { state.value = payload; types.value = clone(payload.types || []); entries.value = (payload.entries || []).map(normalizeEntry); suggestionLimit.value = payload.suggestionLimit || 5; defaultNamePatterns.value = [...(payload.defaultNamePatterns || [])]; dirty.value = false; validation.value = payload.validation || null; selectedIds.value = []; editorEntryId.value = ""; renderLimit.value = 100; syncJsonFromDraft(); jsonEdited.value = false; }
function buildPayload() { return { version: 2, revision: state.value?.revision ?? 1, source: state.value?.source ?? { type: "manual" }, importedAt: state.value?.importedAt ?? null, suggestionLimit: suggestionLimit.value, defaultNamePatterns: defaultNamePatterns.value, types: types.value, entries: entries.value }; }
async function saveState() { if (!canSave.value) return; saving.value = true; error.value = ""; try { const payload = buildPayload(); validation.value = await apiPost<ValidationResult>("/api/squad-name-policy/validate", payload); if (!validation.value.valid) return; const saved = await apiPost<PolicyState>("/api/squad-name-policy/state", payload); applyState(saved); ui.pushToast({ title: "保存完成", message: `队名规范已保存为修订 ${saved.revision}。`, tone: "ok" }); } catch (err) { const detail = err instanceof ApiError ? err.detail as { validation?: ValidationResult } : null; if (detail?.validation) validation.value = detail.validation; error.value = formatError(err); ui.pushToast({ title: "保存失败", message: error.value, tone: "error" }); } finally { saving.value = false; } }
function addRule() { const entry = normalizeEntry({}); entries.value.unshift(entry); editorEntryId.value = entry.id; markDirty(); }
function removeRule(id: string) { if (!window.confirm("确定删除此队名规则吗？")) return; entries.value = entries.value.filter((entry) => entry.id !== id); selectedIds.value = selectedIds.value.filter((item) => item !== id); closeEditor(); markDirty(); }
function openEditor(id: string) { editorEntryId.value = id; }
function closeEditor() { editorEntryId.value = ""; }
function addTypeAndOpen() { addType(); activeTab.value = "types"; }
function addType() { let index = types.value.length + 1; let id = `custom_type_${index}`; while (typeFor(id)) id = `custom_type_${++index}`; types.value.push({ id, label: "新队伍类型", nature: "other", description: "", defaultMaxPlayers: null, assetMode: "none", enabled: true, sortOrder: types.value.length * 10 + 10 }); markDirty(); }
function removeType(id: string) { if (ruleCount(id)) return; types.value = types.value.filter((type) => type.id !== id); markDirty(); }
function canEditTypeId(type: SquadType) { return canSave.value && ruleCount(type.id) === 0; }
function onTypeNatureChanged(type: SquadType) { if (type.nature !== "vehicle") { type.assetMode = "none"; for (const entry of entries.value.filter((item) => item.typeId === type.id)) entry.asset = ""; } else if (type.assetMode === "none") type.assetMode = "optional"; markDirty(); }
function onEntryTypeChanged(entry: PolicyEntry) { if (typeFor(entry.typeId)?.nature !== "vehicle") entry.asset = ""; markDirty(); }
function assetHint(entry: PolicyEntry) { const type = typeFor(entry.typeId); return type?.assetMode === "required" ? "必填" : type?.assetMode === "optional" ? "可选" : "非载具类型不可设置"; }
function parseList(value: string) { return [...new Set(value.split(/[\r\n,，]+/).map((item) => item.trim()).filter(Boolean))]; }
function setList(entry: PolicyEntry, field: "aliases" | "keywords", event: Event) { entry[field] = parseList((event.target as HTMLTextAreaElement).value); markDirty(); }
function setDefaultPatterns(event: Event) { defaultNamePatterns.value = parseList((event.target as HTMLTextAreaElement).value); markDirty(); }
function toggleVisibleSelection() { const visible = visibleEntries.value.map((entry) => entry.id); selectedIds.value = allVisibleSelected.value ? selectedIds.value.filter((id) => !visible.includes(id)) : [...new Set([...selectedIds.value, ...visible])]; }
function applyBulk() { const selected = new Set(selectedIds.value); for (const entry of entries.value) { if (!selected.has(entry.id)) continue; if (bulk.typeId) { entry.typeId = bulk.typeId; if (typeFor(entry.typeId)?.nature !== "vehicle") entry.asset = ""; } if (bulk.faction !== "") entry.faction = bulk.faction; if (bulk.clearOverride) entry.maxPlayersOverride = null; else if (bulk.maxPlayersOverride != null) entry.maxPlayersOverride = Number(bulk.maxPlayersOverride) || null; if (bulk.enabled) entry.enabled = bulk.enabled === "true"; if (bulk.clearAsset) entry.asset = ""; } markDirty(); }
async function runLiveTest() { testing.value = true; try { testResult.value = await apiPost<TestResult>("/api/squad-name-policy/test", { name: testName.value, policy: buildPayload() }); } catch (err) { ui.pushToast({ title: "测试失败", message: formatError(err), tone: "error" }); } finally { testing.value = false; } }
function toggleAdvanced() { showAdvanced.value = !showAdvanced.value; if (showAdvanced.value && !jsonEdited.value) syncJsonFromDraft(); }
function syncJsonFromDraft() { jsonText.value = JSON.stringify(buildPayload(), null, 2); jsonEdited.value = false; }
function applyJsonToDraft() { try { const parsed = JSON.parse(jsonText.value); if (!Array.isArray(parsed.types) || !Array.isArray(parsed.entries)) throw new Error("JSON 必须包含 types 和 entries 数组"); if (dirty.value && !window.confirm("这会用 JSON 明确覆盖当前表格草稿，是否继续？")) return; types.value = clone(parsed.types); entries.value = parsed.entries.map(normalizeEntry); suggestionLimit.value = Number(parsed.suggestionLimit || 5); defaultNamePatterns.value = [...(parsed.defaultNamePatterns || [])]; jsonEdited.value = false; markDirty(); } catch (err) { error.value = formatError(err); } }
function exportJson() { const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `squad_name_policy_v2_r${state.value?.revision || 0}.json`; anchor.click(); URL.revokeObjectURL(url); }
async function importJsonFile(event: Event) { const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return; jsonText.value = await file.text(); jsonEdited.value = true; }
function formatError(err: unknown) { return err instanceof Error ? err.message : String(err); }
</script>

<style scoped>
.policy-page{height:100%;min-height:0;display:flex;flex-direction:column;overflow:hidden}.title-row,.filters,.bulk-bar,.test-bar,.button-row{display:flex;align-items:center;gap:10px}.btn{height:32px;padding:0 12px;border:1px solid var(--color-border-default);border-radius:7px;background:var(--color-bg-card);color:var(--color-text-primary);cursor:pointer}.btn:disabled{opacity:.45;cursor:not-allowed}.btn.primary{background:var(--color-brand-primary);color:#07101d;font-weight:700}.btn.ghost{background:transparent}.btn.danger{border-color:color-mix(in srgb,var(--color-status-error) 55%,transparent);color:var(--color-status-error)}.btn.tiny{height:26px;padding:0 8px;font-size:11px}.banner,.validation-banner{margin:10px 14px 0;padding:10px 12px;border-radius:8px}.error,.validation-banner{border:1px solid color-mix(in srgb,var(--color-status-error) 45%,transparent);background:color-mix(in srgb,var(--color-status-error) 10%,transparent)}.validation-banner{position:relative;max-height:190px;overflow:auto}.validation-banner>.btn{position:absolute;right:8px;top:6px}.validation-banner ul{margin:8px 0 0;padding-left:20px;font-size:12px}.tabs{display:flex;padding:10px 14px 0;border-bottom:1px solid var(--color-border-default)}.tabs button{padding:9px 18px;border:0;border-bottom:2px solid transparent;background:transparent;color:var(--color-text-muted);cursor:pointer}.tabs button.active{border-color:var(--color-brand-primary);color:var(--color-text-primary)}.workspace{flex:1;min-height:0;display:flex;flex-direction:column}.filters,.bulk-bar,.test-bar{padding:10px 14px;flex-wrap:wrap;border-bottom:1px solid var(--color-border-soft)}input,select,textarea{border:1px solid var(--color-border-default);border-radius:6px;background:rgba(0,0,0,.22);color:var(--color-text-primary);padding:6px 8px;min-width:0}.filters>input[type=search]{width:270px}.bulk-bar{background:color-mix(in srgb,var(--color-brand-primary) 8%,transparent)}.bulk-bar label,.drawer .inline{display:flex;align-items:center;gap:6px}.bulk-bar label input,.inline input{width:auto}.test-bar{font-size:12px}.test-result{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 10px;border-radius:6px;background:rgba(255,255,255,.04)}.test-result[data-valid=true]{color:var(--color-status-success)}.test-result[data-valid=false]{color:var(--color-status-error)}.table-wrap{flex:1;min-height:0;overflow:auto;position:relative}table{width:100%;min-width:1550px;border-collapse:collapse;font-size:12px}th{position:sticky;top:0;z-index:3;background:var(--color-bg-panel);color:var(--color-text-muted);text-align:left;white-space:nowrap}th,td{padding:7px 8px;border:1px solid var(--color-border-soft);vertical-align:middle}tr.invalid{background:color-mix(in srgb,var(--color-status-error) 8%,transparent)}td.check,th.check{width:32px;text-align:center}.truncate{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.path{font-family:monospace;font-size:10px}.name-link{border:0;background:transparent;color:var(--color-brand-primary);font-weight:700;cursor:pointer}.status{border:0;border-radius:999px;padding:3px 8px;font-size:10px}.status[data-enabled=true]{background:color-mix(in srgb,var(--color-status-success) 18%,transparent);color:var(--color-status-success)}.status[data-enabled=false]{background:rgba(255,255,255,.06);color:var(--color-text-muted)}.empty{text-align:center;padding:30px;color:var(--color-text-muted)}.load-more{display:block;margin:14px auto;padding:8px 20px;border:1px solid var(--color-border-default);border-radius:8px;background:var(--color-bg-card);color:var(--color-text-primary)}.types-table{min-width:1250px}.types-table input:not([type=checkbox]),.types-table select{width:100%}.types-table td:nth-child(4){min-width:145px}.types-table small{display:block;color:var(--color-status-warn);margin-top:4px}.muted{color:var(--color-text-muted);font-size:12px}.drawer{position:fixed;z-index:50;right:0;top:0;bottom:0;width:min(430px,94vw);display:flex;flex-direction:column;background:color-mix(in srgb,var(--color-bg-panel) 94%,transparent);border-left:1px solid var(--color-border-default);box-shadow:-16px 0 45px rgba(0,0,0,.3);backdrop-filter:blur(18px)}.drawer.advanced{width:min(620px,96vw)}.drawer header{display:flex;justify-content:space-between;align-items:center;padding:16px;border-bottom:1px solid var(--color-border-default)}.drawer header div{display:grid;gap:4px}.drawer header small{color:var(--color-text-muted)}.drawer-body{padding:16px;overflow:auto;display:grid;gap:13px}.drawer label{display:grid;gap:6px;font-size:12px;color:var(--color-text-muted)}.drawer label input,.drawer label select,.drawer label textarea{width:100%;color:var(--color-text-primary)}.drawer textarea{min-height:88px;resize:vertical}.drawer .json-editor{height:56vh;font-family:monospace;font-size:11px}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:10px}.file-btn{display:inline-flex!important;align-items:center!important;color:var(--color-text-primary)!important}.file-btn input{display:none}.meta{display:grid;grid-template-columns:auto 1fr;gap:8px;font-size:11px}.meta code{overflow-wrap:anywhere}@media(max-width:900px){.filters>input[type=search]{width:100%}.test-result{width:100%}.two-col{grid-template-columns:1fr}}
</style>
