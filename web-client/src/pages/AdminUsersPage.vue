<template>
  <div class="admin-users-page">
    <header class="admin-users-header">
      <div>
        <p class="eyebrow">System</p>
        <h1>管理员账号</h1>
        <p class="subtitle">管理 Web 登录账号、角色、Steam64 绑定和启用状态。</p>
      </div>
      <button class="primary-button" type="button" @click="openCreateDialog">添加管理员</button>
    </header>

    <section class="stats-grid">
      <div class="stat-card">
        <span>账号总数</span>
        <strong>{{ stats.total }}</strong>
      </div>
      <div class="stat-card">
        <span>启用账号</span>
        <strong>{{ stats.enabled }}</strong>
      </div>
      <div class="stat-card">
        <span>SuperAdmin</span>
        <strong>{{ stats.superAdmins }}</strong>
      </div>
      <div class="stat-card">
        <span>已绑定 Steam</span>
        <strong>{{ stats.steamBound }}</strong>
      </div>
    </section>

    <section class="toolbar">
      <label>
        <span>搜索账号</span>
        <input v-model.trim="filters.search" type="search" placeholder="用户名 / 显示名 / Steam64" />
      </label>
      <label>
        <span>角色</span>
        <select v-model="filters.role">
          <option value="">全部</option>
          <option value="SuperAdmin">SuperAdmin</option>
          <option value="Admin">Admin</option>
        </select>
      </label>
      <label>
        <span>状态</span>
        <select v-model="filters.enabled">
          <option value="">全部</option>
          <option value="enabled">启用</option>
          <option value="disabled">禁用</option>
        </select>
      </label>
      <label>
        <span>Steam</span>
        <select v-model="filters.steam">
          <option value="">全部</option>
          <option value="bound">已绑定</option>
          <option value="unbound">未绑定</option>
        </select>
      </label>
      <button class="ghost-button" type="button" :disabled="loading" @click="loadUsers">刷新</button>
    </section>

    <p v-if="error" class="error-banner">{{ error }}</p>

    <section class="table-shell">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>显示名</th>
            <th>角色</th>
            <th>Steam64</th>
            <th>状态</th>
            <th>最后修改</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="7" class="empty-cell">正在加载账号...</td>
          </tr>
          <tr v-else-if="filteredUsers.length === 0">
            <td colspan="7" class="empty-cell">没有匹配的账号</td>
          </tr>
          <template v-else>
            <tr v-for="item in filteredUsers" :key="item.id">
              <td>
                <div class="account-cell">
                  <img v-if="item.steamAvatar" class="admin-avatar" :src="item.steamAvatar" alt="" referrerpolicy="no-referrer" />
                  <span v-else class="admin-avatar fallback">{{ getAccountInitial(item) }}</span>
                  <div>
                    <strong>{{ item.username }}</strong>
                    <small v-if="item.id === auth.user?.id">当前账号</small>
                  </div>
                </div>
              </td>
              <td>{{ item.displayName || "-" }}</td>
              <td><span class="role-badge" :data-role="item.role">{{ item.role }}</span></td>
              <td>{{ item.steam64 || "未绑定" }}</td>
              <td><span class="status-pill" :data-enabled="String(item.enabled)">{{ item.enabled ? "启用" : "禁用" }}</span></td>
              <td>{{ formatDate(item.updatedAt) }}</td>
              <td>
                <div class="action-row">
                  <button class="link-button" type="button" @click="openEditDialog(item)">编辑</button>
                  <button class="link-button" type="button" @click="openResetDialog(item)">重置密码</button>
                  <button class="danger-link" type="button" :disabled="item.id === auth.user?.id" @click="deleteUser(item)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </section>

    <div v-if="editorOpen" class="modal-backdrop" @click.self="closeEditor">
      <form class="modal-panel" @submit.prevent="submitEditor">
        <header>
          <h2>{{ editingUser ? "编辑管理员" : "添加管理员" }}</h2>
          <button class="icon-button" type="button" @click="closeEditor">×</button>
        </header>

        <label>
          <span>用户名</span>
          <input v-model.trim="form.username" :disabled="Boolean(editingUser)" required />
        </label>
        <label>
          <span>显示名称</span>
          <input v-model.trim="form.displayName" />
        </label>
        <label>
          <span>角色</span>
          <select v-model="form.role">
            <option value="Admin">Admin</option>
            <option value="SuperAdmin">SuperAdmin</option>
          </select>
        </label>
        <label>
          <span>Steam64</span>
          <input v-model.trim="form.steam64" inputmode="numeric" pattern="\d{17}" maxlength="17" placeholder="17 位 Steam64，留空表示未绑定" />
        </label>
        <label class="checkbox-row">
          <input v-model="form.viewerTeamAutoSwapEnabled" type="checkbox" />
          <span>自动识别所在队伍</span>
        </label>
        <label class="checkbox-row">
          <input v-model="form.enabled" type="checkbox" />
          <span>账号启用</span>
        </label>
        <label>
          <span>备注</span>
          <textarea v-model.trim="form.note" rows="3" />
        </label>

        <template v-if="!editingUser">
          <div class="password-tools">
            <span>密码</span>
            <button class="ghost-button" type="button" @click="generateCreatePassword">生成随机密码</button>
          </div>
          <label>
            <input v-model="form.password" :type="showCreatePassword ? 'text' : 'password'" autocomplete="new-password" required minlength="8" />
          </label>
          <label>
            <span>确认密码</span>
            <input v-model="form.confirmPassword" :type="showCreatePassword ? 'text' : 'password'" autocomplete="new-password" required minlength="8" />
          </label>
          <label class="checkbox-row">
            <input v-model="showCreatePassword" type="checkbox" />
            <span>显示本次输入的密码</span>
          </label>
        </template>

        <p v-if="dialogError" class="error-banner">{{ dialogError }}</p>

        <footer>
          <button class="ghost-button" type="button" @click="closeEditor">取消</button>
          <button class="primary-button" type="submit" :disabled="saving">{{ saving ? "保存中..." : "保存" }}</button>
        </footer>
      </form>
    </div>

    <div v-if="resetOpen && resetUser" class="modal-backdrop" @click.self="closeReset">
      <form class="modal-panel compact" @submit.prevent="submitReset">
        <header>
          <h2>重置密码</h2>
          <button class="icon-button" type="button" @click="closeReset">×</button>
        </header>
        <p class="subtitle">账号：{{ resetUser.username }}</p>
        <div class="password-tools">
          <span>新密码</span>
          <button class="ghost-button" type="button" @click="generateResetPassword">生成随机密码</button>
        </div>
        <label>
          <input v-model="resetForm.password" :type="showResetPassword ? 'text' : 'password'" autocomplete="new-password" required minlength="8" />
        </label>
        <label>
          <span>确认新密码</span>
          <input v-model="resetForm.confirmPassword" :type="showResetPassword ? 'text' : 'password'" autocomplete="new-password" required minlength="8" />
        </label>
        <label class="checkbox-row">
          <input v-model="showResetPassword" type="checkbox" />
          <span>显示本次输入的密码</span>
        </label>
        <p class="hint">关闭窗口后无法再次查看密码，只能重新重置。</p>
        <p v-if="dialogError" class="error-banner">{{ dialogError }}</p>
        <footer>
          <button class="ghost-button" type="button" @click="closeReset">取消</button>
          <button class="primary-button" type="submit" :disabled="saving">{{ saving ? "重置中..." : "重置密码" }}</button>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import {
  createAdminUser,
  deleteAdminUser,
  fetchAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
  type AdminUser,
  type AdminUserRole,
  type AdminUserStats,
} from "../app/adminUsersApi";
import { useAuthStore } from "../stores/auth.store";

const auth = useAuthStore();
const users = ref<AdminUser[]>([]);
const stats = reactive<AdminUserStats>({ total: 0, enabled: 0, superAdmins: 0, steamBound: 0 });
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const dialogError = ref("");
const editorOpen = ref(false);
const resetOpen = ref(false);
const editingUser = ref<AdminUser | null>(null);
const resetUser = ref<AdminUser | null>(null);
const showCreatePassword = ref(false);
const showResetPassword = ref(false);

const filters = reactive({
  search: "",
  role: "",
  enabled: "",
  steam: "",
});

const form = reactive({
  username: "",
  displayName: "",
  role: "Admin" as AdminUserRole,
  steam64: "",
  viewerTeamAutoSwapEnabled: true,
  enabled: true,
  note: "",
  password: "",
  confirmPassword: "",
});

const resetForm = reactive({
  password: "",
  confirmPassword: "",
});

const filteredUsers = computed(() => {
  const needle = filters.search.toLowerCase();
  return users.value.filter((item) => {
    if (filters.role && item.role !== filters.role) return false;
    if (filters.enabled === "enabled" && !item.enabled) return false;
    if (filters.enabled === "disabled" && item.enabled) return false;
    if (filters.steam === "bound" && !item.steam64) return false;
    if (filters.steam === "unbound" && item.steam64) return false;
    if (!needle) return true;
    return [item.username, item.displayName, item.steam64, item.note]
      .some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

onMounted(loadUsers);

async function loadUsers() {
  loading.value = true;
  error.value = "";
  try {
    const response = await fetchAdminUsers();
    users.value = response.items ?? [];
    Object.assign(stats, response.stats ?? buildStats(users.value));
  } catch (err: any) {
    error.value = err?.message ?? "加载账号失败";
  } finally {
    loading.value = false;
  }
}

function buildStats(items: AdminUser[]): AdminUserStats {
  return {
    total: items.length,
    enabled: items.filter((item) => item.enabled).length,
    superAdmins: items.filter((item) => item.role === "SuperAdmin").length,
    steamBound: items.filter((item) => Boolean(item.steam64)).length,
  };
}

function openCreateDialog() {
  editingUser.value = null;
  Object.assign(form, {
    username: "",
    displayName: "",
    role: "Admin",
    steam64: "",
    viewerTeamAutoSwapEnabled: true,
    enabled: true,
    note: "",
    password: "",
    confirmPassword: "",
  });
  showCreatePassword.value = false;
  dialogError.value = "";
  editorOpen.value = true;
}

function openEditDialog(user: AdminUser) {
  editingUser.value = user;
  Object.assign(form, {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    steam64: user.steam64 ?? "",
    viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled,
    enabled: user.enabled,
    note: user.note,
    password: "",
    confirmPassword: "",
  });
  dialogError.value = "";
  editorOpen.value = true;
}

function closeEditor() {
  editorOpen.value = false;
}

async function submitEditor() {
  dialogError.value = "";
  if (!editingUser.value && form.password !== form.confirmPassword) {
    dialogError.value = "两次输入的密码不一致";
    return;
  }

  saving.value = true;
  try {
    if (editingUser.value) {
      await updateAdminUser(editingUser.value.id, {
        displayName: form.displayName,
        role: form.role,
        steam64: form.steam64 || null,
        viewerTeamAutoSwapEnabled: form.viewerTeamAutoSwapEnabled,
        enabled: form.enabled,
        note: form.note,
      });
    } else {
      await createAdminUser({
        username: form.username,
        displayName: form.displayName,
        role: form.role,
        steam64: form.steam64 || null,
        viewerTeamAutoSwapEnabled: form.viewerTeamAutoSwapEnabled,
        enabled: form.enabled,
        note: form.note,
        password: form.password,
      });
    }
    closeEditor();
    await loadUsers();
  } catch (err: any) {
    dialogError.value = err?.message ?? "保存失败";
  } finally {
    saving.value = false;
  }
}

function openResetDialog(user: AdminUser) {
  resetUser.value = user;
  resetForm.password = "";
  resetForm.confirmPassword = "";
  showResetPassword.value = false;
  dialogError.value = "";
  resetOpen.value = true;
}

function closeReset() {
  resetOpen.value = false;
}

async function submitReset() {
  if (!resetUser.value) return;
  dialogError.value = "";
  if (resetForm.password !== resetForm.confirmPassword) {
    dialogError.value = "两次输入的密码不一致";
    return;
  }

  saving.value = true;
  try {
    await resetAdminUserPassword(resetUser.value.id, resetForm.password);
    closeReset();
    await loadUsers();
  } catch (err: any) {
    dialogError.value = err?.message ?? "重置失败";
  } finally {
    saving.value = false;
  }
}

async function deleteUser(user: AdminUser) {
  const ok = window.confirm(`确认删除管理员 ${user.username}？\n删除后该账号将无法登录，此操作不可撤销。`);
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await deleteAdminUser(user.id);
    await loadUsers();
  } catch (err: any) {
    error.value = err?.message ?? "删除失败";
  } finally {
    saving.value = false;
  }
}

function generateCreatePassword() {
  const password = generatePassword();
  form.password = password;
  form.confirmPassword = password;
  showCreatePassword.value = true;
}

function generateResetPassword() {
  const password = generatePassword();
  resetForm.password = password;
  resetForm.confirmPassword = password;
  showResetPassword.value = true;
}

function generatePassword() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  const bytes = new Uint32Array(18);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function formatDate(value: number) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function getAccountInitial(user: AdminUser) {
  const source = user.displayName || user.username || user.steam64 || "?";
  return source.trim().slice(0, 1).toUpperCase();
}
</script>

<style scoped>
.admin-users-page {
  min-height: 100%;
  padding: 24px;
  color: var(--color-text-primary);
}

.admin-users-header,
.toolbar,
.table-shell,
.modal-panel {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-panel);
}

.admin-users-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px;
  border-radius: 8px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--color-text-muted);
  font-size: 12px;
  text-transform: uppercase;
}

h1,
h2,
.subtitle {
  margin: 0;
}

h1 {
  font-size: 28px;
}

h2 {
  font-size: 20px;
}

.subtitle,
.hint {
  color: var(--color-text-muted);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.stat-card {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.035);
}

.stat-card span {
  display: block;
  color: var(--color-text-muted);
  font-size: 13px;
}

.stat-card strong {
  display: block;
  margin-top: 8px;
  font-size: 26px;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(120px, 160px)) auto;
  gap: 12px;
  align-items: end;
  padding: 14px;
  border-radius: 8px;
}

label {
  display: grid;
  gap: 6px;
  color: var(--color-text-secondary);
  font-size: 13px;
}

input,
select,
textarea {
  width: 100%;
  min-height: 38px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
  background: rgba(0, 0, 0, 0.2);
  color: var(--color-text-primary);
  padding: 8px 10px;
  font: inherit;
}

textarea {
  resize: vertical;
}

button {
  border: 0;
  color: var(--color-text-primary);
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.primary-button,
.ghost-button {
  min-height: 38px;
  border-radius: 6px;
  padding: 0 14px;
  font-weight: 700;
}

.primary-button {
  background: var(--color-status-info);
}

.ghost-button {
  border: 1px solid var(--color-border-default);
  background: rgba(255, 255, 255, 0.04);
}

.table-shell {
  margin-top: 16px;
  border-radius: 8px;
  overflow: auto;
}

table {
  width: 100%;
  min-width: 920px;
  border-collapse: collapse;
}

th,
td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--color-border-soft);
  text-align: left;
  vertical-align: middle;
}

th {
  color: var(--color-text-muted);
  font-size: 12px;
  text-transform: uppercase;
}

td small {
  display: block;
  margin-top: 4px;
  color: var(--color-status-info);
}

.account-cell {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.admin-avatar {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  object-fit: cover;
  border: 1px solid var(--color-border-soft);
  background: rgba(255, 255, 255, 0.04);
  flex: 0 0 auto;
}

.admin-avatar.fallback {
  display: inline-grid;
  place-items: center;
  color: var(--color-text-secondary);
  font-size: 13px;
  font-weight: 800;
}

.empty-cell {
  text-align: center;
  color: var(--color-text-muted);
}

.role-badge,
.status-pill {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 700;
}

.role-badge[data-role="SuperAdmin"] {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.14);
}

.role-badge[data-role="Admin"] {
  color: #93c5fd;
  background: rgba(147, 197, 253, 0.12);
}

.status-pill[data-enabled="true"] {
  color: #86efac;
  background: rgba(134, 239, 172, 0.12);
}

.status-pill[data-enabled="false"] {
  color: #fca5a5;
  background: rgba(252, 165, 165, 0.12);
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.link-button,
.danger-link,
.icon-button {
  background: transparent;
}

.link-button {
  color: var(--color-status-info);
}

.danger-link {
  color: #fca5a5;
}

.error-banner {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 6px;
  color: #fecaca;
  background: rgba(239, 68, 68, 0.12);
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.62);
}

.modal-panel {
  width: min(640px, 100%);
  max-height: calc(100vh - 48px);
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 8px;
}

.modal-panel.compact {
  width: min(480px, 100%);
}

.modal-panel header,
.modal-panel footer,
.password-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.modal-panel footer {
  justify-content: flex-end;
}

.icon-button {
  width: 34px;
  height: 34px;
  border-radius: 6px;
  font-size: 24px;
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.checkbox-row input {
  width: 16px;
  min-height: 16px;
}

@media (max-width: 900px) {
  .stats-grid,
  .toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .admin-users-header {
    flex-direction: column;
  }
}

@media (max-width: 620px) {
  .admin-users-page {
    padding: 14px;
  }

  .stats-grid,
  .toolbar {
    grid-template-columns: 1fr;
  }
}
</style>
