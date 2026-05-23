<template>
  <section class="fair-squad-building-modern">
    <!-- PAGE HEADER -->
    <header class="mgmt-header">
      <div class="mgmt-title-group">
        <div class="mgmt-eyebrow">PLUGIN CONFIGURATION</div>
        <h1 class="mgmt-title">公平建队设置 <small>Fair Squad Building</small></h1>
      </div>
      <div class="mgmt-header-actions">
        <div class="sync-status" :class="{ active: loading }">
          <span class="pulse"></span>
          {{ loading ? "同步中..." : "实时监听中" }}
        </div>
        <button class="glass-btn" @click="fetchStatus" :disabled="loading">
          <span class="icon">🔄</span> 刷新数据
        </button>
      </div>
    </header>

    <div class="mgmt-container">
      <!-- LEFT COLUMN: STATUS & MASTER TOGGLE -->
      <aside class="mgmt-actions-panel">
        <div class="panel-inner">
          <div class="panel-section">
            <h2 class="section-label">实时状态 <small>REALTIME STATUS</small></h2>
            
            <div class="action-card glass">
              <div class="card-head">
                <span class="dot" :class="isSafe ? 'success' : 'warn'"></span>
                <h3>当前对局阶段</h3>
              </div>
              <div class="status-content">
                <div class="stat-item">
                  <label>日志时间 (Log Clock)</label>
                  <div class="value" :class="isSafe ? 'text-success' : 'text-warn'">{{ logTimeText }}</div>
                </div>
                <div class="stat-item">
                  <label>生效阶段</label>
                  <div class="value">{{ currentPhase }}</div>
                </div>
                <p class="hint-text">
                  * 仅在日志时间重置（检测到 SeamlessTravel）后生效。默认 10 分钟为保护状态。
                </p>
              </div>
            </div>

            <div class="action-card glass">
              <div class="card-head">
                <span class="dot" :class="state.enabled ? 'success' : 'danger'"></span>
                <h3>插件开关</h3>
              </div>
              <div class="card-form">
                <button 
                  class="action-btn" 
                  :class="state.enabled ? 'danger-filled' : 'success-filled'"
                  @click="toggleEnabled"
                >
                  {{ state.enabled ? '停用插件 (Disable)' : '启用插件 (Enable)' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <!-- RIGHT COLUMN: CONFIGURATION -->
      <main class="mgmt-monitor">
        <div class="card glass">
          <div class="card-head">
            <span class="dot primary"></span>
            <h3>规则配置 <small>RULES CONFIGURATION</small></h3>
          </div>
          
          <div class="config-body">
            <div class="form-row">
              <div class="field">
                <label>阶段 1 时长 (秒)</label>
                <input v-model.number="state.config.phase1Seconds" type="number" min="0" max="300" />
                <p class="field-hint">此时间内禁止任何建队动作。</p>
              </div>
              <div class="field">
                <label>阶段 2 时长 (秒)</label>
                <input v-model.number="state.config.phase2Seconds" type="number" min="0" max="600" />
                <p class="field-hint">此时间内仅允许步兵队（Squad X / 白名单）。</p>
              </div>
            </div>

            <div class="field mt-4">
              <label>步兵队白名单 (每行一个关键字)</label>
              <textarea v-model="whitelistText" rows="8" placeholder="例如：\nINF\nInfantry\n步兵"></textarea>
              <p class="field-hint">队名包含这些关键字的小队在阶段 2 不会被解散。</p>
            </div>

            <div class="form-actions mt-4">
              <button 
                class="action-btn primary-filled" 
                @click="saveConfig" 
                :disabled="saving"
              >
                {{ saving ? '正在同步配置...' : '保存并应用配置' }}
              </button>
              <span v-if="successMsg" class="feedback success">{{ successMsg }}</span>
              <span v-if="errorMsg" class="feedback danger">{{ errorMsg }}</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

const state = ref({
  enabled: true,
  logSeconds: 600,
  config: {
    phase1Seconds: 20,
    phase2Seconds: 50,
    infantryWhitelist: [] as string[]
  }
});

const whitelistText = ref('');
const loading = ref(false);
const saving = ref(false);
const errorMsg = ref('');
const successMsg = ref('');

let refreshTimer: any = null;

const isSafe = computed(() => (state.value.logSeconds ?? 600) < 590);
const logTimeText = computed(() => isSafe.value ? `${state.value.logSeconds}s` : `保护中 (${state.value.logSeconds ?? 600}s)`);
const currentPhase = computed(() => {
  const s = state.value.logSeconds ?? 600;
  const c = state.value.config ?? { phase1Seconds: 20, phase2Seconds: 50 };
  if (s < (c.phase1Seconds ?? 20)) return "阶段 1 (禁止所有建队)";
  if (s < (c.phase2Seconds ?? 50)) return "阶段 2 (仅限步兵队)";
  return "阶段 3 (全部开放)";
});

async function apiRequest(path: string, options?: RequestInit) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.message || 'Request failed');
  return data;
}

async function fetchStatus() {
  loading.value = true;
  try {
    const res = await apiRequest('/api/plugins/fair-squad-building/status');
    state.value = res.data;
    // Only update whitelist text if not currently focused/typing to avoid jumpiness
    if (!saving.value) {
      whitelistText.value = (res.data.config.infantryWhitelist || []).join('\n');
    }
    errorMsg.value = '';
  } catch (err: any) {
    errorMsg.value = err.message;
  } finally {
    loading.value = false;
  }
}

async function toggleEnabled() {
  const next = !state.value.enabled;
  try {
    await apiRequest('/api/plugins/fair-squad-building/config', {
      method: 'PATCH',
      body: JSON.stringify({ enabled: next })
    });
    state.value.enabled = next;
    showSuccess(next ? '插件已开启' : '插件已禁用');
  } catch (err: any) {
    errorMsg.value = err.message;
  }
}

async function saveConfig() {
  saving.value = true;
  const whitelist = whitelistText.value.split('\n').map(s => s.trim()).filter(Boolean);
  try {
    await apiRequest('/api/plugins/fair-squad-building/config', {
      method: 'PATCH',
      body: JSON.stringify({
        phase1Seconds: state.value.config.phase1Seconds,
        phase2Seconds: state.value.config.phase2Seconds,
        infantryWhitelist: whitelist
      })
    });
    state.value.config.infantryWhitelist = whitelist;
    showSuccess('配置同步成功');
  } catch (err: any) {
    errorMsg.value = err.message;
  } finally {
    saving.value = false;
  }
}

function showSuccess(msg: string) {
  successMsg.value = msg;
  setTimeout(() => { successMsg.value = ''; }, 3000);
}

onMounted(() => {
  fetchStatus();
  refreshTimer = setInterval(fetchStatus, 3000);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
});
</script>

<style scoped>
.fair-squad-building-modern {
  padding: 1.5rem;
  color: #fff;
}

.mgmt-container {
  display: grid;
  grid-template-columns: 350px 1fr;
  gap: 1.5rem;
  margin-top: 1.5rem;
}

.status-content {
  padding: 1rem;
}

.stat-item {
  margin-bottom: 1rem;
}

.stat-item label {
  display: block;
  font-size: 0.75rem;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 0.25rem;
}

.stat-item .value {
  font-size: 1.5rem;
  font-weight: 700;
  font-family: 'JetBrains Mono', monospace;
}

.text-success { color: #4ade80; }
.text-warn { color: #facc15; }

.hint-text {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.4;
}

.config-body {
  padding: 1.5rem;
}

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1.5rem;
}

.field label {
  display: block;
  font-size: 0.85rem;
  font-weight: 600;
  margin-bottom: 0.5rem;
}

.field input, .field textarea {
  width: 100%;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  padding: 0.75rem;
  font-size: 1rem;
}

.field-hint {
  font-size: 0.75rem;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 0.25rem;
}

.mt-4 { margin-top: 1.5rem; }

.form-actions {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.feedback {
  font-size: 0.85rem;
  font-weight: 600;
}

.feedback.success { color: #4ade80; }
.feedback.danger { color: #f87171; }

.success-filled { background: #10b981; color: #fff; }
.primary-filled { background: #3b82f6; color: #fff; }

@media (max-width: 1024px) {
  .mgmt-container {
    grid-template-columns: 1fr;
  }
}
</style>
