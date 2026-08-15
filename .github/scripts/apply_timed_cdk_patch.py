from pathlib import Path
import re


def read(path):
    return Path(path).read_text(encoding="utf-8-sig")


def write(path, text):
    Path(path).write_text(text, encoding="utf-8", newline="")


def replace_once(path, old, new):
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one exact match, got {count}: {old[:120]!r}")
    write(path, text.replace(old, new, 1))


def regex_once(path, pattern, replacement):
    text = read(path)
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, got {count}: {pattern[:120]!r}")
    write(path, next_text)


backend = "app/modules/reserve-slots/index.js"
routes = "app/modules/reserve-slots/routes.js"
api = "web-client/src/app/reserveSlotsApi.ts"
component = "web-client/src/components/settings/ReserveSlotsSection.vue"
tests = "app/tests/run-reserve-slots-tests.js"

replace_once(
    backend,
    '  BATCH_DEACTIVATED: "batch_deactivated",\n  CODE_USED: "code_used",',
    '  BATCH_DEACTIVATED: "batch_deactivated",\n  BATCH_NOT_ACTIVE: "batch_not_active",\n  CODE_USED: "code_used",',
)

replace_once(
    backend,
    "      allowMultiActivation: payload.allowMultiActivation,\n      deactivated: false,",
    "      allowMultiActivation: payload.allowMultiActivation,\n      activateAt: payload.activateAt,\n      autoDeactivateAt: payload.autoDeactivateAt,\n      deactivated: false,",
)

replace_once(
    backend,
    '''    if (batch.deactivated) {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: resolvedCodeType,
        result: ACTIVATION_RESULTS.BATCH_DEACTIVATED,
        failureReason: "该批次已停用，无法继续激活。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }
''',
    '''    const batchStatus = resolveCdkBatchStatus(batch);
    if (batchStatus === "deactivated") {
      const automaticallyExpired = !batch.deactivated && Boolean(batch.autoDeactivateAt);
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: resolvedCodeType,
        result: ACTIVATION_RESULTS.BATCH_DEACTIVATED,
        failureReason: automaticallyExpired
          ? `该批次已于 ${formatCdkScheduleTime(batch.autoDeactivateAt)} 自动报销。`
          : "该批次已停用，无法继续激活。",
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }

    if (batchStatus === "scheduled") {
      return logActivation({
        playerName,
        steamId,
        message,
        batchId: batch.id,
        code,
        codeType: resolvedCodeType,
        result: ACTIVATION_RESULTS.BATCH_NOT_ACTIVE,
        failureReason: `该批次将于 ${formatCdkScheduleTime(batch.activateAt)} 后生效。`,
        grantedExpireAt: null,
        matchedFutureRequirement: false,
      });
    }
''',
)

regex_once(
    backend,
    r'''function normalizeCreateCdkBatchInput\(input = \{\}\) \{.*?\n\}\n\nfunction resolveCdkRequirementSuffix''',
    '''function normalizeCreateCdkBatchInput(input = {}) {
  const codeType = String(input.codeType ?? input.type ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,24}$/.test(codeType)) {
    throw createReserveSlotError(400, "InvalidCdkType", "CDK 类型只能包含字母、数字、下划线和短横线。");
  }

  const quantity = Math.max(1, Math.min(500, Number(input.quantity ?? 0) || 0));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw createReserveSlotError(400, "InvalidCdkQuantity", "CDK 数量必须大于 0。");
  }

  const durationDays = Math.max(1, Math.min(3650, Number(input.durationDays ?? 0) || 0));
  if (!Number.isFinite(durationDays) || durationDays <= 0) {
    throw createReserveSlotError(400, "InvalidCdkDurationDays", "激活天数必须大于 0。");
  }

  const activateAt = normalizeOptionalCdkTimestamp(input.activateAt, "生效时间");
  const autoDeactivateAt = normalizeOptionalCdkTimestamp(input.autoDeactivateAt, "自动报销时间");
  const effectiveActivateAtMs = activateAt ? Date.parse(activateAt) : Date.now();
  const autoDeactivateAtMs = autoDeactivateAt ? Date.parse(autoDeactivateAt) : null;
  if (autoDeactivateAtMs != null && autoDeactivateAtMs <= effectiveActivateAtMs) {
    throw createReserveSlotError(400, "InvalidCdkAutoDeactivateAt", "自动报销时间必须晚于生效时间。");
  }

  return {
    codeType,
    quantity,
    durationDays,
    allowMultiActivation: Boolean(input.allowMultiActivation),
    activateAt,
    autoDeactivateAt,
    minCurrentSessionSeconds: Math.max(0, Number(input.minCurrentSessionSeconds ?? 0) || 0),
    minServerSeconds: Math.max(0, Number(input.minServerSeconds ?? 0) || 0),
  };
}

function normalizeOptionalCdkTimestamp(value, label) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const timestampMs = Date.parse(text);
  if (!Number.isFinite(timestampMs)) {
    throw createReserveSlotError(400, "InvalidCdkScheduleTime", `${label}无效。`);
  }
  return new Date(timestampMs).toISOString();
}

function resolveCdkRequirementSuffix''',
)

replace_once(
    backend,
    "    allowMultiActivation: Boolean(batch.allowMultiActivation),\n    deactivated: Boolean(batch.deactivated),",
    "    allowMultiActivation: Boolean(batch.allowMultiActivation),\n    activateAt: optionalText(batch.activateAt),\n    autoDeactivateAt: optionalText(batch.autoDeactivateAt),\n    deactivated: Boolean(batch.deactivated),",
)

regex_once(
    backend,
    r'''function buildCdkSummary\(store\) \{.*?\n\}\n\nfunction buildCdkBatchView\(store\) \{.*?\n\}\n''',
    '''function resolveCdkBatchStatus(batch, nowMs = Date.now()) {
  if (!batch || batch.deactivated) return "deactivated";
  const autoDeactivateAtMs = batch.autoDeactivateAt ? Date.parse(batch.autoDeactivateAt) : NaN;
  if (Number.isFinite(autoDeactivateAtMs) && autoDeactivateAtMs <= nowMs) return "deactivated";
  const activateAtMs = batch.activateAt ? Date.parse(batch.activateAt) : NaN;
  if (Number.isFinite(activateAtMs) && activateAtMs > nowMs) return "scheduled";
  return "active";
}

function formatCdkScheduleTime(value) {
  const timestampMs = Date.parse(String(value ?? ""));
  if (!Number.isFinite(timestampMs)) return String(value ?? "未知时间");
  return formatLocalDateTime(new Date(timestampMs));
}

function buildCdkSummary(store) {
  const batches = Array.isArray(store?.cdkBatches) ? store.cdkBatches : [];
  const codes = Array.isArray(store?.cdkCodes) ? store.cdkCodes : [];
  const activations = Array.isArray(store?.cdkActivations) ? store.cdkActivations : [];
  const visibleBatches = batches.filter((item) => resolveCdkBatchStatus(item) !== "deactivated");
  const visibleBatchIds = new Set(visibleBatches.map((item) => item.id));
  const visibleCodes = codes.filter((item) => visibleBatchIds.has(item.batchId));
  const usedCodeCount = visibleCodes.filter((item) => item.status === "used").length;
  const activeBatchCount = visibleBatches.filter((item) => resolveCdkBatchStatus(item) === "active").length;
  const scheduledBatchCount = visibleBatches.filter((item) => resolveCdkBatchStatus(item) === "scheduled").length;
  const deactivatedBatchCount = batches.filter((item) => resolveCdkBatchStatus(item) === "deactivated").length;

  return {
    batchCount: visibleBatches.length,
    activeBatchCount,
    scheduledBatchCount,
    deactivatedBatchCount,
    codeCount: visibleCodes.length,
    usedCodeCount,
    remainingCodeCount: Math.max(0, visibleCodes.length - usedCodeCount),
    activationCount: activations.length,
    successCount: activations.filter((item) => item.result === ACTIVATION_RESULTS.SUCCESS).length,
    failureCount: activations.filter((item) => item.result !== ACTIVATION_RESULTS.SUCCESS).length,
  };
}

function buildCdkBatchView(store) {
  const batches = cloneValue((store?.cdkBatches ?? []).filter((batch) => resolveCdkBatchStatus(batch) !== "deactivated"));
  const codes = store?.cdkCodes ?? [];
  return batches.map((batch) => {
    const relatedCodes = codes.filter((item) => item.batchId === batch.id);
    const usedCount = relatedCodes.filter((item) => item.status === "used").length;
    return {
      ...batch,
      codes: relatedCodes.map((item) => String(item?.code ?? "").trim()).filter(Boolean),
      usedCount,
      remainingCount: Math.max(0, relatedCodes.length - usedCount),
      activationCount: (store?.cdkActivations ?? []).filter((item) => item.batchId === batch.id).length,
      status: resolveCdkBatchStatus(batch),
    };
  });
}
''',
)

replace_once(
    backend,
    '''    case ACTIVATION_RESULTS.BATCH_DEACTIVATED:
      return "[预留位 CDK] 该批次已停用，无法继续激活。";
    case ACTIVATION_RESULTS.CODE_USED:''',
    '''    case ACTIVATION_RESULTS.BATCH_DEACTIVATED:
      return `[预留位 CDK] ${record.failureReason || "该批次已停用，无法继续激活。"}`;
    case ACTIVATION_RESULTS.BATCH_NOT_ACTIVE:
      return `[预留位 CDK] ${record.failureReason || "该批次尚未生效。"}`;
    case ACTIVATION_RESULTS.CODE_USED:''',
)

replace_once(
    routes,
    "        allowMultiActivation: Boolean(body?.allowMultiActivation),\n        minCurrentSessionSeconds: body?.minCurrentSessionSeconds ?? 0,",
    "        allowMultiActivation: Boolean(body?.allowMultiActivation),\n        activateAt: body?.activateAt ?? null,\n        autoDeactivateAt: body?.autoDeactivateAt ?? null,\n        minCurrentSessionSeconds: body?.minCurrentSessionSeconds ?? 0,",
)

replace_once(
    api,
    "  allowMultiActivation: boolean;\n  deactivated: boolean;",
    "  allowMultiActivation: boolean;\n  activateAt: string | null;\n  autoDeactivateAt: string | null;\n  deactivated: boolean;",
)
replace_once(api, '  status: "active" | "deactivated";', '  status: "active" | "scheduled" | "deactivated";')
replace_once(
    api,
    "  activeBatchCount: number;\n  deactivatedBatchCount: number;",
    "  activeBatchCount: number;\n  scheduledBatchCount: number;\n  deactivatedBatchCount: number;",
)
replace_once(
    api,
    "  allowMultiActivation: boolean;\n  minCurrentSessionSeconds?: number;",
    "  allowMultiActivation: boolean;\n  activateAt?: string | null;\n  autoDeactivateAt?: string | null;\n  minCurrentSessionSeconds?: number;",
)

replace_once(
    component,
    '''          <div class="reserve-summary-card">
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
          </div>''',
    '''          <div class="reserve-summary-card active">
            <span>当前生效</span>
            <strong>{{ cdkState?.summary.activeBatchCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card scheduled">
            <span>待生效</span>
            <strong>{{ cdkState?.summary.scheduledBatchCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card">
            <span>剩余 CDK</span>
            <strong>{{ cdkState?.summary.remainingCodeCount ?? 0 }}</strong>
          </div>
          <div class="reserve-summary-card subtle">
            <span>已自动 / 手动报销</span>
            <strong>{{ cdkState?.summary.deactivatedBatchCount ?? 0 }}</strong>
          </div>''',
)

replace_once(
    component,
    '''                class="cdk-batch-card compact"
                :class="{ active: selectedBatchId === batch.id }"''',
    '''                class="cdk-batch-card compact"
                :class="{ active: selectedBatchId === batch.id, scheduled: batch.status === 'scheduled' }"''',
)
replace_once(
    component,
    '                      <span class="reserve-pill active">有效</span>',
    '''                      <span class="reserve-pill" :class="batch.status === 'scheduled' ? 'scheduled' : 'active'">
                        {{ batchStatusLabel(batch) }}
                      </span>''',
)
replace_once(
    component,
    '''                  <span>同玩家：{{ batch.allowMultiActivation ? "允许多次" : "单次使用" }}</span>
                  <span>创建时间：{{ formatDate(batch.createdAt) }}</span>
                  <span>创建人：{{ batch.createdBy || "system" }}</span>''',
    '''                  <span>同玩家：{{ batch.allowMultiActivation ? "允许多次" : "单次使用" }}</span>
                  <span>生效时间：{{ batch.activateAt ? formatDate(batch.activateAt) : "立即生效" }}</span>
                  <span>自动报销：{{ batch.autoDeactivateAt ? formatDate(batch.autoDeactivateAt) : "不自动报销" }}</span>
                  <span class="batch-timing-hint">{{ batchTimingHint(batch) }}</span>
                  <span>创建时间：{{ formatDate(batch.createdAt) }}</span>
                  <span>创建人：{{ batch.createdBy || "system" }}</span>''',
)

replace_once(
    component,
    '''            <label class="reserve-field">
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
            <label class="reserve-field">
              <span>当前局门槛（秒）</span>
              <input v-model.number="batchForm.minCurrentSessionSeconds" class="reserve-input" type="number" min="0" step="1">
            </label>
            <label class="reserve-field">
              <span>服务器累计时长门槛（秒）</span>
              <input v-model.number="batchForm.minServerSeconds" class="reserve-input" type="number" min="0" step="1">
            </label>
            <label class="checkbox-row">
              <input v-model="batchForm.allowMultiActivation" type="checkbox">
              <span>允许同一玩家多次使用该批次中的不同 CDK</span>
            </label>''',
    '''            <div class="batch-form-grid">
              <label class="reserve-field">
                <span>CDK 类型</span>
                <input v-model.trim="batchForm.codeType" class="reserve-input" type="text" placeholder="例如 VIP" required>
              </label>
              <label class="reserve-field">
                <span>数量</span>
                <input v-model.number="batchForm.quantity" class="reserve-input" type="number" min="1" step="1" required>
              </label>
              <label class="reserve-field">
                <span>激活后预留位天数</span>
                <input v-model.number="batchForm.durationDays" class="reserve-input" type="number" min="1" step="1" required>
              </label>
            </div>

            <section class="batch-schedule-card">
              <div class="batch-schedule-head">
                <div>
                  <strong>启用与自动报销</strong>
                  <p>例如 13:00 生成、13:30 生效，则 13:30 前输入 CDK 不会消耗。</p>
                </div>
              </div>
              <div class="batch-form-grid timing-grid">
                <label class="reserve-field">
                  <span>何时生效</span>
                  <input v-model="batchForm.activateAt" class="reserve-input" type="datetime-local">
                </label>
                <label class="reserve-field">
                  <span>何时自动报销</span>
                  <input v-model="batchForm.autoDeactivateAt" class="reserve-input" type="datetime-local">
                </label>
              </div>
              <div class="batch-quick-actions">
                <span>生效：</span>
                <button type="button" class="reserve-mini-btn" @click="setBatchActivationDelay(0)">立即</button>
                <button type="button" class="reserve-mini-btn" @click="setBatchActivationDelay(30)">+30 分钟</button>
                <button type="button" class="reserve-mini-btn" @click="setBatchActivationDelay(60)">+1 小时</button>
              </div>
              <div class="batch-quick-actions">
                <span>自动报销：</span>
                <button type="button" class="reserve-mini-btn" @click="setBatchAutoDeactivateDelay(0)">不自动</button>
                <button type="button" class="reserve-mini-btn" @click="setBatchAutoDeactivateDelay(60)">生效后 +1 小时</button>
                <button type="button" class="reserve-mini-btn" @click="setBatchAutoDeactivateDelay(360)">生效后 +6 小时</button>
                <button type="button" class="reserve-mini-btn" @click="setBatchAutoDeactivateDelay(1440)">生效后 +24 小时</button>
              </div>
              <p class="reserve-helper" :class="{ error: !batchScheduleValid }">{{ batchSchedulePreview }}</p>
            </section>

            <details class="batch-advanced">
              <summary>高级激活条件</summary>
              <div class="batch-form-grid advanced-grid">
                <label class="reserve-field">
                  <span>当前局门槛（秒）</span>
                  <input v-model.number="batchForm.minCurrentSessionSeconds" class="reserve-input" type="number" min="0" step="1">
                </label>
                <label class="reserve-field">
                  <span>服务器累计时长门槛（秒）</span>
                  <input v-model.number="batchForm.minServerSeconds" class="reserve-input" type="number" min="0" step="1">
                </label>
              </div>
              <label class="checkbox-row">
                <input v-model="batchForm.allowMultiActivation" type="checkbox">
                <span>允许同一玩家多次使用该批次中的不同 CDK</span>
              </label>
            </details>''',
)

replace_once(
    component,
    '              <strong>{{ batchForm.codeType || "CDK" }} / {{ Number(batchForm.quantity) || 0 }} 个 / {{ Number(batchForm.durationDays) || 0 }} 天</strong>',
    '              <strong>{{ batchForm.codeType || "CDK" }} / {{ Number(batchForm.quantity) || 0 }} 个 / {{ Number(batchForm.durationDays) || 0 }} 天</strong>\n              <small>{{ batchSchedulePreview }}</small>',
)
replace_once(
    component,
    '            <button type="submit" class="reserve-btn primary full" :disabled="!canEdit || batchCreating">',
    '            <button type="submit" class="reserve-btn primary full" :disabled="!canEdit || batchCreating || !batchScheduleValid">',
)
replace_once(
    component,
    '  { value: "batch_deactivated", label: "预留位无效" },\n  { value: "code_used", label: "码已使用" },',
    '  { value: "batch_deactivated", label: "批次已报销" },\n  { value: "batch_not_active", label: "批次未到生效时间" },\n  { value: "code_used", label: "码已使用" },',
)
replace_once(
    component,
    '  allowMultiActivation: false,\n  minCurrentSessionSeconds: 0,',
    '  allowMultiActivation: false,\n  activateAt: "",\n  autoDeactivateAt: "",\n  minCurrentSessionSeconds: 0,',
)
replace_once(
    component,
    'const selectedCustomDaysValid = computed(() => Number.isFinite(Number(selectedCustomDays.value)) && Number(selectedCustomDays.value) !== 0);',
    '''const selectedCustomDaysValid = computed(() => Number.isFinite(Number(selectedCustomDays.value)) && Number(selectedCustomDays.value) !== 0);

const batchScheduleValid = computed(() => {
  void nowTick.value;
  const activateAtMs = parseBatchLocalTime(batchForm.activateAt);
  const autoDeactivateAtMs = parseBatchLocalTime(batchForm.autoDeactivateAt);
  if (batchForm.activateAt && activateAtMs == null) return false;
  if (batchForm.autoDeactivateAt && autoDeactivateAtMs == null) return false;
  if (autoDeactivateAtMs == null) return true;
  const effectiveActivateAtMs = activateAtMs != null && activateAtMs > Date.now() ? activateAtMs : Date.now();
  return autoDeactivateAtMs > effectiveActivateAtMs;
});

const batchSchedulePreview = computed(() => {
  if (!batchScheduleValid.value) return "自动报销时间必须晚于实际生效时间。";
  const activateText = batchForm.activateAt ? `生效 ${formatDate(normalizeBatchScheduleValue(batchForm.activateAt))}` : "立即生效";
  const deactivateText = batchForm.autoDeactivateAt ? `自动报销 ${formatDate(normalizeBatchScheduleValue(batchForm.autoDeactivateAt))}` : "不自动报销";
  return `${activateText} · ${deactivateText}`;
});''',
)
replace_once(
    component,
    '    const result = await createReserveSlotCdkBatch(batchForm);',
    '''    const result = await createReserveSlotCdkBatch({
      ...batchForm,
      activateAt: normalizeBatchScheduleValue(batchForm.activateAt),
      autoDeactivateAt: normalizeBatchScheduleValue(batchForm.autoDeactivateAt),
    });''',
)
replace_once(
    component,
    '''function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}
''',
    '''function parseBatchLocalTime(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = new Date(text);
  const timestampMs = parsed.getTime();
  return Number.isFinite(timestampMs) ? timestampMs : null;
}

function normalizeBatchScheduleValue(value: string | null | undefined) {
  const timestampMs = parseBatchLocalTime(value);
  return timestampMs == null ? null : new Date(timestampMs).toISOString();
}

function setBatchActivationDelay(minutes: number) {
  const normalizedMinutes = Math.max(0, Number(minutes) || 0);
  batchForm.activateAt = normalizedMinutes <= 0
    ? ""
    : toDatetimeLocal(new Date(Date.now() + normalizedMinutes * 60_000));
}

function setBatchAutoDeactivateDelay(minutes: number) {
  const normalizedMinutes = Math.max(0, Number(minutes) || 0);
  if (normalizedMinutes <= 0) {
    batchForm.autoDeactivateAt = "";
    return;
  }
  const activateAtMs = parseBatchLocalTime(batchForm.activateAt);
  const baseMs = activateAtMs != null && activateAtMs > Date.now() ? activateAtMs : Date.now();
  batchForm.autoDeactivateAt = toDatetimeLocal(new Date(baseMs + normalizedMinutes * 60_000));
}

function batchStatusLabel(batch: ReserveSlotCdkBatch) {
  return batch.status === "scheduled" ? "待生效" : "生效中";
}

function batchTimingHint(batch: ReserveSlotCdkBatch) {
  const now = nowTick.value;
  if (batch.status === "scheduled" && batch.activateAt) {
    const target = Date.parse(batch.activateAt);
    if (Number.isFinite(target)) return `距离生效 ${formatDurationShort(target - now)}`;
  }
  if (batch.autoDeactivateAt) {
    const target = Date.parse(batch.autoDeactivateAt);
    if (Number.isFinite(target)) return `距离自动报销 ${formatDurationShort(target - now)}`;
  }
  return "长期有效，直到手动报销";
}

function formatDurationShort(diffMs: number) {
  const totalMinutes = Math.max(0, Math.ceil(Number(diffMs || 0) / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const remainHours = hours % 24;
  return remainHours ? `${days} 天 ${remainHours} 小时` : `${days} 天`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
}
''',
)

style_addition = r'''

.reserve-summary-card.scheduled,
.reserve-pill.scheduled {
  border-color: rgba(245, 158, 11, 0.42);
  background: rgba(245, 158, 11, 0.10);
}

.cdk-batch-card.scheduled {
  border-style: dashed;
}

.batch-create-panel {
  align-self: start;
  max-height: 100%;
  overflow: auto;
}

.batch-form-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.batch-schedule-card {
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.2));
  border-radius: 12px;
  background: rgba(15, 23, 42, 0.18);
}

.batch-schedule-head p {
  margin: 4px 0 0;
  font-size: 12px;
  opacity: 0.72;
  line-height: 1.5;
}

.batch-quick-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.batch-quick-actions > span {
  min-width: 76px;
  font-size: 12px;
  opacity: 0.72;
}

.batch-advanced {
  padding: 10px 12px;
  border: 1px solid var(--border-subtle, rgba(148, 163, 184, 0.2));
  border-radius: 10px;
}

.batch-advanced summary {
  cursor: pointer;
  font-weight: 650;
  user-select: none;
}

.batch-advanced[open] summary {
  margin-bottom: 10px;
}

.batch-timing-hint {
  font-weight: 650;
}

.reserve-helper.error {
  color: #ef4444;
}

.reserve-save-preview small {
  display: block;
  margin-top: 4px;
  font-weight: 500;
  opacity: 0.72;
}

@media (max-width: 1180px) {
  .batch-form-grid {
    grid-template-columns: 1fr;
  }
}
'''
text = read(component)
if style_addition.strip() in text:
    raise RuntimeError("component: timed CDK styles already present")
if "</style>" not in text:
    raise RuntimeError("component: missing </style>")
write(component, text.rsplit("</style>", 1)[0] + style_addition + "\n</style>\n")

timed_test = r'''

async function testCdkBatchActivationScheduleAndAutoDeactivation() {
  const module = await setupReserveModule({ enabled: true });
  await module.reserveModule.start();

  const scheduledAt = new Date(Date.now() + 60_000).toISOString();
  const scheduled = await module.reserveModule.api.createCdkBatch({
    codeType: "VIP",
    quantity: 1,
    durationDays: 30,
    activateAt: scheduledAt,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });

  const scheduledBatch = scheduled.batches.find((item) => item.id === scheduled.createdBatchId);
  assert.equal(scheduledBatch.status, "scheduled");
  assert.equal(scheduled.summary.scheduledBatchCount, 1);

  module.harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: scheduled.createdCodes[0],
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const earlyState = await module.reserveModule.api.getCdkState();
  const earlyActivation = earlyState.activations.find((item) => item.code === scheduled.createdCodes[0]);
  assert.equal(earlyActivation?.result, "batch_not_active");
  assert.equal(earlyState.summary.usedCodeCount, 0);

  const autoDeactivateAt = new Date(Date.now() + 250).toISOString();
  const expiring = await module.reserveModule.api.createCdkBatch({
    codeType: "AUTO",
    quantity: 1,
    durationDays: 30,
    autoDeactivateAt,
    allowMultiActivation: false,
  }, {
    actor: { username: "admin" },
  });
  const expiringCode = expiring.createdCodes[0];
  assert.equal(expiring.batches.find((item) => item.id === expiring.createdBatchId)?.status, "active");

  await new Promise((resolve) => setTimeout(resolve, 320));
  const expiredState = await module.reserveModule.api.getCdkState();
  assert.equal(expiredState.batches.some((item) => item.id === expiring.createdBatchId), false);

  module.harness.chatManager.api.emit("message", {
    chatChannel: "all",
    playerName: "Alpha",
    steamId: "76561198377609640",
    message: expiringCode,
  });
  await new Promise((resolve) => setTimeout(resolve, 80));

  const afterExpiredAttempt = await module.reserveModule.api.getCdkState();
  const expiredActivation = afterExpiredAttempt.activations.find((item) => item.code === expiringCode);
  assert.equal(expiredActivation?.result, "batch_deactivated");
  assert.match(expiredActivation?.failureReason ?? "", /自动报销/);

  await module.reserveModule.stop();
  await fs.rm(module.tempDir, { recursive: true, force: true });
}
'''
replace_once(tests, "async function testCsvImportSyncsAdminFile() {", timed_test + "\nasync function testCsvImportSyncsAdminFile() {")
replace_once(
    tests,
    "  await testChatActivationRespectsEnabledFlag();\n  await testCsvImportSyncsAdminFile();",
    "  await testChatActivationRespectsEnabledFlag();\n  await testCdkBatchActivationScheduleAndAutoDeactivation();\n  await testCsvImportSyncsAdminFile();",
)
