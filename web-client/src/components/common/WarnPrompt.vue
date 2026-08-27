<template>
  <Teleport to="body">
    <div v-if="ui.warnPrompt.visible" class="warning-composer-root" v-backdrop-close="cancel">
      <section class="warning-composer" :data-kind="kind">
        <header class="composer-head">
          <div class="head-mark" aria-hidden="true">!</div>
          <div class="head-copy">
            <span class="eyebrow">ADMIN WARNING</span>
            <h3>{{ ui.warnPrompt.title }}</h3>
            <p>目标玩家 <strong>{{ ui.warnPrompt.targetName }}</strong></p>
          </div>
          <button type="button" class="close-button" aria-label="关闭" @click="cancel">×</button>
        </header>

        <nav class="warning-kind-tabs" aria-label="警告类型">
          <button type="button" :class="{ active: kind === 'ordinary' }" @click="kind = 'ordinary'">
            <span>普通警告</span>
            <small>只发送提醒，不写入违规记录</small>
          </button>
          <button
            type="button"
            :class="{ active: kind === 'violation' }"
            :disabled="!ui.warnPrompt.allowViolation"
            @click="kind = 'violation'"
          >
            <span>违规警告</span>
            <small>{{ ui.warnPrompt.allowViolation ? "发送后计入玩家档案" : "仅支持单个玩家" }}</small>
          </button>
        </nav>

        <div v-if="kind === 'ordinary'" class="ordinary-body">
          <label class="field-label" for="ordinary-warning-message">警告内容</label>
          <textarea
            id="ordinary-warning-message"
            ref="inputRef"
            v-model="message"
            class="warning-textarea"
            maxlength="180"
            placeholder="输入只起提醒作用的警告内容…"
            @keydown.enter.ctrl="submit"
          ></textarea>
          <div class="field-meta"><span>Ctrl + Enter 发送</span><span>{{ message.length }}/180</span></div>
          <div class="quick-hints">
            <button v-for="hint in hints" :key="hint" type="button" @click="message = hint">{{ hint }}</button>
          </div>
        </div>

        <div v-else class="violation-body">
          <aside class="category-list">
            <button
              v-for="category in violationWarningCatalog"
              :key="category.key"
              type="button"
              :class="{ active: selectedCategoryKey === category.key }"
              @click="selectCategory(category.key)"
            >
              <span>{{ category.label }}</span>
              <small>{{ category.items.length }} 项</small>
            </button>
          </aside>

          <section class="violation-editor">
            <div class="editor-block">
              <span class="field-label">具体违规行为</span>
              <div class="violation-options">
                <button
                  v-for="item in selectedCategory.items"
                  :key="item.key"
                  type="button"
                  :class="{ active: selectedViolationKey === item.key }"
                  @click="selectedViolationKey = item.key"
                >
                  {{ item.label }}
                </button>
              </div>
            </div>

            <label class="editor-block">
              <span class="field-label">管理员补充描述</span>
              <textarea
                ref="detailRef"
                v-model="detail"
                class="warning-textarea detail-textarea"
                maxlength="120"
                placeholder="补充位置、载具、队伍或现场情况；该内容会随违规记录保存…"
                @keydown.enter.ctrl="submit"
              ></textarea>
              <span class="field-meta"><span>必填，将拼接在违规文案后</span><span>{{ detail.length }}/120</span></span>
            </label>

            <div class="warning-preview">
              <span>最终发送文案</span>
              <strong>{{ violationMessage || "选择违规行为并填写具体描述" }}</strong>
              <small>统计项目：{{ selectedViolation.label || "--" }}</small>
            </div>
          </section>
        </div>

        <footer class="composer-actions">
          <p v-if="kind === 'violation'">警告发送成功后，才会写入玩家违规历史与分类统计。</p>
          <span v-else></span>
          <div>
            <AppButton variant="ghost" @click="cancel">取消</AppButton>
            <AppButton variant="warning" :disabled="!canSubmit" @click="submit">
              {{ kind === "violation" ? "发送并记录违规" : ui.warnPrompt.confirmText }}
            </AppButton>
          </div>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import AppButton from "../ui/AppButton.vue";
import { useUiStore } from "../../stores/ui.store";
import { violationWarningCatalog, type ViolationWarningCategory } from "../../shared/violation-catalog";

const ui = useUiStore();
const kind = ref<"ordinary" | "violation">("ordinary");
const message = ref("");
const detail = ref("");
const selectedCategoryKey = ref(violationWarningCatalog[0]?.key ?? "");
const selectedViolationKey = ref(violationWarningCatalog[0]?.items[0]?.key ?? "");
const inputRef = ref<HTMLTextAreaElement | null>(null);
const detailRef = ref<HTMLTextAreaElement | null>(null);

const hints = [
  "请遵守服务器规则",
  "请前往己方基地领取载具",
  "请勿单人驾驶重要载具",
  "请保持有效沟通并服从队伍安排",
];

const selectedCategory = computed<ViolationWarningCategory>(() =>
  violationWarningCatalog.find((category) => category.key === selectedCategoryKey.value)
  ?? violationWarningCatalog[0]!,
);
const selectedViolation = computed(() =>
  selectedCategory.value?.items.find((item) => item.key === selectedViolationKey.value)
  ?? selectedCategory.value?.items[0]
  ?? { key: "", label: "", warningText: "" },
);
const violationMessage = computed(() => {
  const prefix = selectedViolation.value.warningText.trim();
  const suffix = detail.value.trim();
  return prefix && suffix ? `${prefix}，${suffix}` : "";
});
const canSubmit = computed(() =>
  kind.value === "ordinary"
    ? Boolean(message.value.trim())
    : Boolean(ui.warnPrompt.allowViolation && selectedViolation.value.key && detail.value.trim()),
);

watch(() => ui.warnPrompt.visible, (visible) => {
  if (!visible) return;
  kind.value = "ordinary";
  message.value = ui.warnPrompt.defaultMessage;
  detail.value = "";
  selectedCategoryKey.value = violationWarningCatalog[0]?.key ?? "";
  selectedViolationKey.value = violationWarningCatalog[0]?.items[0]?.key ?? "";
  nextTick(() => {
    inputRef.value?.focus();
    inputRef.value?.select();
  });
});

watch(kind, (next) => {
  nextTick(() => {
    if (next === "violation") detailRef.value?.focus();
    else inputRef.value?.focus();
  });
});

function selectCategory(categoryKey: string) {
  selectedCategoryKey.value = categoryKey;
  selectedViolationKey.value = selectedCategory.value?.items[0]?.key ?? "";
}

function submit() {
  if (!canSubmit.value) return;
  if (kind.value === "ordinary") {
    ui.resolveWarnPrompt({ kind: "ordinary", message: message.value.trim() });
    return;
  }

  ui.resolveWarnPrompt({
    kind: "violation",
    message: violationMessage.value,
    violation: {
      categoryKey: selectedCategory.value.key,
      categoryLabel: selectedCategory.value.label,
      violationKey: selectedViolation.value.key,
      violationLabel: selectedViolation.value.label,
      warningText: selectedViolation.value.warningText,
      detail: detail.value.trim(),
    },
  });
}

function cancel() {
  ui.resolveWarnPrompt(null);
}
</script>

<style scoped>
.warning-composer-root{position:fixed;inset:0;z-index:var(--z-confirm-dialog);display:grid;place-items:center;padding:20px;background:rgba(3,8,14,.76);backdrop-filter:blur(8px)}
.warning-composer{width:min(900px,100%);max-height:min(760px,calc(100dvh - 40px));display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(251,191,36,.25);border-radius:20px;background:linear-gradient(145deg,rgba(255,255,255,.045),transparent 42%),var(--color-bg-card);box-shadow:0 28px 90px #000a,0 0 34px rgba(245,158,11,.09)}
.composer-head{display:flex;align-items:center;gap:13px;padding:18px 20px;border-bottom:1px solid var(--color-border-default)}
.head-mark{width:40px;height:40px;display:grid;place-items:center;border-radius:12px;background:rgba(245,158,11,.13);border:1px solid rgba(245,158,11,.34);color:#fbbf24;font-size:23px;font-weight:950}.head-copy{min-width:0;flex:1}.eyebrow{color:#fbbf24;font-size:9px;font-weight:900;letter-spacing:.18em}.head-copy h3{margin:2px 0 0;font-size:18px}.head-copy p{margin:4px 0 0;color:var(--color-text-muted);font-size:12px}.head-copy strong{color:var(--color-text-primary)}.close-button{width:34px;height:34px;border:1px solid var(--color-border-default);border-radius:10px;background:var(--color-bg-hover);color:var(--color-text-muted);font-size:20px;cursor:pointer}
.warning-kind-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px 16px;border-bottom:1px solid var(--color-border-default);background:rgba(0,0,0,.08)}.warning-kind-tabs button{min-width:0;padding:10px 13px;text-align:left;border:1px solid var(--color-border-default);border-radius:11px;background:rgba(255,255,255,.018);color:var(--color-text-secondary);cursor:pointer}.warning-kind-tabs button.active{border-color:rgba(245,158,11,.55);background:rgba(245,158,11,.09);color:#fde68a}.warning-kind-tabs button:disabled{opacity:.46;cursor:not-allowed}.warning-kind-tabs span,.warning-kind-tabs small{display:block}.warning-kind-tabs span{font-size:13px;font-weight:850}.warning-kind-tabs small{margin-top:3px;color:var(--color-text-muted);font-size:10px}
.ordinary-body{min-height:330px;display:flex;flex-direction:column;gap:9px;padding:22px}.field-label{color:var(--color-text-secondary);font-size:11px;font-weight:850;letter-spacing:.05em}.warning-textarea{width:100%;min-height:130px;border:1px solid var(--color-border-default);border-radius:12px;background:var(--color-bg-elevated);padding:13px;color:var(--color-text-primary);font-size:14px;line-height:1.55;resize:vertical}.warning-textarea:focus{outline:none;border-color:rgba(245,158,11,.55);box-shadow:0 0 0 3px rgba(245,158,11,.08)}.field-meta{display:flex;justify-content:space-between;color:var(--color-text-muted);font-size:10px}.quick-hints{display:flex;flex-wrap:wrap;gap:7px;margin-top:5px}.quick-hints button{padding:6px 9px;border:1px solid var(--color-border-soft);border-radius:999px;background:rgba(245,158,11,.06);color:#e9c872;font-size:11px;cursor:pointer}
.violation-body{display:grid;grid-template-columns:250px minmax(0,1fr);min-height:390px;overflow:hidden}.category-list{overflow:auto;padding:12px;border-right:1px solid var(--color-border-default);background:rgba(0,0,0,.08)}.category-list button{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;padding:10px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--color-text-secondary);text-align:left;cursor:pointer}.category-list button.active{border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.09);color:#fecaca}.category-list span{font-size:12px;font-weight:800}.category-list small{color:var(--color-text-muted);font-size:9px;white-space:nowrap}.violation-editor{overflow:auto;padding:18px;display:grid;align-content:start;gap:18px}.editor-block{display:grid;gap:9px}.violation-options{display:flex;flex-wrap:wrap;gap:8px}.violation-options button{padding:8px 11px;border:1px solid var(--color-border-default);border-radius:9px;background:rgba(255,255,255,.02);color:var(--color-text-secondary);font-size:12px;cursor:pointer}.violation-options button.active{border-color:rgba(239,68,68,.48);background:rgba(239,68,68,.11);color:#fecaca}.detail-textarea{min-height:105px}.warning-preview{display:grid;gap:5px;padding:13px;border:1px solid rgba(239,68,68,.24);border-radius:12px;background:linear-gradient(120deg,rgba(239,68,68,.08),transparent)}.warning-preview span,.warning-preview small{color:var(--color-text-muted);font-size:10px}.warning-preview strong{color:#fee2e2;font-size:13px;line-height:1.55}
.composer-actions{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 18px;border-top:1px solid var(--color-border-default);background:rgba(0,0,0,.08)}.composer-actions p{margin:0;color:var(--color-text-muted);font-size:10px}.composer-actions>div{display:flex;gap:9px}
@media(max-width:700px){.warning-composer-root{padding:8px}.warning-composer{max-height:calc(100dvh - 16px);border-radius:15px}.composer-head{padding:13px}.warning-kind-tabs{padding:9px}.warning-kind-tabs small{display:none}.violation-body{grid-template-columns:1fr;overflow:auto}.category-list{display:flex;gap:6px;overflow:auto;border-right:0;border-bottom:1px solid var(--color-border-default)}.category-list button{width:auto;min-width:max-content;margin:0}.violation-editor{overflow:visible;padding:13px}.ordinary-body{min-height:280px;padding:14px}.composer-actions{align-items:flex-end}.composer-actions p{max-width:45%}}
</style>
