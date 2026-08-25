<template>
  <div class="admin-users-page">
    <header class="admin-users-header">
      <div>
        <p class="eyebrow">System</p>
        <h1>管理员账号</h1>
        <p class="subtitle">管理 Web 登录账号、RCON 权限组以及账号绑定关系。</p>
      </div>
      <div class="header-actions">
        <button class="ghost-button" type="button" :disabled="loading" @click="loadAll">刷新</button>
        <button class="primary-button" type="button" @click="openCreateDialog">添加管理员</button>
      </div>
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
        <span>权限组</span>
        <strong>{{ permissionGroups.length }}</strong>
      </div>
    </section>

    <section class="permission-groups-shell">
      <div class="section-title-row">
        <div>
          <h2>权限组</h2>
          <p class="subtitle">权限组同时控制页面入口显示与已开放的手动 RCON 能力。</p>
        </div>
        <button class="primary-button" type="button" @click="openCreateGroupDialog">新建权限组</button>
      </div>

      <p v-if="error" class="error-banner">{{ error }}</p>

      <div v-if="permissionGroups.length === 0" class="empty-card">
        还没有权限组。普通管理员未绑定权限组时，将无法执行手动 RCON 命令。
      </div>

      <div v-else class="group-grid">
        <article v-for="group in permissionGroups" :key="group.id" class="group-card">
          <div class="group-card-head">
            <div>
              <h3>{{ group.name }}</h3>
              <p class="group-meta">
                <span class="status-pill" :data-enabled="String(group.enabled)">{{ group.enabled ? "启用" : "禁用" }}</span>
                <span>{{ group.assignedUsers }} 个账号绑定</span>
              </p>
            </div>
            <div class="action-row">
              <button class="link-button" type="button" @click="openEditGroupDialog(group)">编辑</button>
              <button class="danger-link" type="button" @click="deletePermissionGroupAction(group)">删除</button>
            </div>
          </div>
          <div class="permission-summary-row" aria-label="权限摘要">
            <span
              v-for="section in permissionSections"
              :key="section.key"
              class="permission-count-pill"
              :data-empty="String(countGroupSectionPermissions(group, section) === 0)"
            >
              {{ section.label }} {{ countGroupSectionPermissions(group, section) }}/{{ section.options.length }}
            </span>
          </div>
        </article>
      </div>
    </section>

    <section class="toolbar">
      <label>
        <span>搜索账号</span>
        <input v-model.trim="filters.search" type="search" placeholder="用户名 / 显示名 / Steam64 / 权限组" />
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
        <span>权限组</span>
        <select v-model="filters.permissionGroupId">
          <option value="">全部</option>
          <option value="__none__">未绑定</option>
          <option v-for="group in permissionGroups" :key="group.id" :value="group.id">{{ group.name }}</option>
        </select>
      </label>
    </section>

    <section class="table-shell">
      <table>
        <thead>
          <tr>
            <th>账号</th>
            <th>角色</th>
            <th>权限组</th>
            <th>权限</th>
            <th>Steam64</th>
            <th>状态</th>
            <th>最后修改</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loading">
            <td colspan="8" class="empty-cell">正在加载账号...</td>
          </tr>
          <tr v-else-if="filteredUsers.length === 0">
            <td colspan="8" class="empty-cell">没有匹配的账号</td>
          </tr>
          <template v-else>
            <tr v-for="item in filteredUsers" :key="item.id">
              <td>
                <div class="account-cell">
                  <img v-if="item.steamAvatar" class="admin-avatar" :src="item.steamAvatar" alt="" referrerpolicy="no-referrer" />
                  <span v-else class="admin-avatar fallback">{{ getAccountInitial(item) }}</span>
                  <div>
                    <strong>{{ item.username }}</strong>
                    <small v-if="item.displayName">{{ item.displayName }}</small>
                    <small v-if="item.id === auth.user?.id">当前账号</small>
                  </div>
                </div>
              </td>
              <td><span class="role-badge" :data-role="item.role">{{ item.role }}</span></td>
              <td>
                <span v-if="item.role === 'SuperAdmin'" class="superadmin-note">全权限</span>
                <span v-else>{{ item.permissionGroupName || "未绑定" }}</span>
              </td>
              <td>
                <span
                  class="permission-count-pill"
                  :data-empty="String(item.role !== 'SuperAdmin' && countKnownPermissions(item.permissions) === 0)"
                >
                  {{ renderUserPermissionSummary(item) }}
                </span>
              </td>
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

    <div v-if="editorOpen" class="modal-backdrop" v-backdrop-close="closeEditor">
      <form class="modal-panel" @submit.prevent="submitEditor">
        <header>
          <div>
            <h2>{{ editingUser ? "编辑管理员" : "添加管理员" }}</h2>
            <p class="subtitle">普通管理员只能绑定一个 RCON 权限组；SuperAdmin 不受权限组限制。</p>
          </div>
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
          <span>权限组</span>
          <select v-model="form.permissionGroupId" :disabled="form.role === 'SuperAdmin'">
            <option value="">未绑定</option>
            <option v-for="group in permissionGroups" :key="group.id" :value="group.id">
              {{ group.name }}{{ group.enabled ? "" : " (已禁用)" }}
            </option>
          </select>
        </label>
        <p v-if="form.role === 'SuperAdmin'" class="hint">SuperAdmin 始终拥有全部权限，不依赖权限组。</p>
        <label>
          <span>Steam64</span>
          <input v-model.trim="form.steam64" inputmode="numeric" pattern="\d{17}" maxlength="17" placeholder="17 位 Steam64，可留空" />
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

    <div v-if="groupEditorOpen" class="modal-backdrop" v-backdrop-close="closeGroupEditor">
      <form class="modal-panel compact" @submit.prevent="submitGroupEditor">
        <header>
          <div>
            <h2>{{ editingPermissionGroup ? "编辑权限组" : "新建权限组" }}</h2>
            <p class="subtitle">勾选页面访问权限后，该权限组账号才能在左侧导航看到并进入对应页面。</p>
          </div>
          <button class="icon-button" type="button" @click="closeGroupEditor">×</button>
        </header>

        <label>
          <span>权限组名称</span>
          <input v-model.trim="groupForm.name" required placeholder="例如：实习管理员" />
        </label>
        <label class="checkbox-row">
          <input v-model="groupForm.enabled" type="checkbox" />
          <span>权限组启用</span>
        </label>
        <div class="permission-section-list">
          <section
            v-for="section in permissionSections"
            :key="section.key"
            class="permission-editor-section"
          >
            <div class="permission-editor-head">
              <div>
                <h3>{{ section.label }}</h3>
                <p class="hint">{{ section.description }}</p>
              </div>
              <button class="ghost-button small" type="button" @click="togglePermissionSection(section)">
                {{ isPermissionSectionFullySelected(section) ? "清空" : "全选" }}
              </button>
            </div>
            <div class="permission-option-grid">
              <label v-for="option in section.options" :key="option.value" class="permission-option">
                <input v-model="groupForm.permissions" type="checkbox" :value="option.value" />
                <span>{{ option.label }}</span>
              </label>
            </div>
          </section>
        </div>

        <p v-if="dialogError" class="error-banner">{{ dialogError }}</p>

        <footer>
          <button class="ghost-button" type="button" @click="closeGroupEditor">取消</button>
          <button class="primary-button" type="submit" :disabled="saving">{{ saving ? "保存中..." : "保存" }}</button>
        </footer>
      </form>
    </div>

    <div v-if="resetOpen && resetUser" class="modal-backdrop" v-backdrop-close="closeReset">
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
        <p class="hint">关闭窗口后将无法再次查看密码，只能重新重置。</p>
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
  createPermissionGroup,
  deleteAdminUser,
  deletePermissionGroup,
  fetchAdminUsers,
  resetAdminUserPassword,
  updateAdminUser,
  updatePermissionGroup,
  type AdminUser,
  type AdminUserRole,
  type AdminUserStats,
  type PermissionGroup,
} from "../app/adminUsersApi";
import { WEB_PAGE_PERMISSION_MATRIX } from "../shared/web-page-permissions.js";
import { useAuthStore } from "../stores/auth.store";

interface PermissionOption {
  value: string;
  label: string;
}

interface PermissionSection {
  key: string;
  label: string;
  description: string;
  options: PermissionOption[];
}

const rconPermissionOptions: PermissionOption[] = [
  { value: "rcon.tb", label: "跳边 TB" },
  { value: "rcon.warn", label: "警告 Warn" },
  { value: "rcon.broadcast", label: "广播 Broadcast" },
  { value: "rcon.kick", label: "踢出 Kick" },
  { value: "rcon.disband", label: "解散 Disband" },
  { value: "rcon.remove", label: "移出队伍 Remove" },
  { value: "rcon.settickets", label: "修改票数 Tickets" },
];

const pagePermissionLabels = new Map([
  ["match_state.view", "对局状态"],
  ["console.view", "控制台"],
  ["chat_monitor.view", "聊天监控"],
  ["player_session_records.view", "进出服记录"],
  ["player_database.view", "玩家数据库"],
  ["reserve_slots.view", "预留位：查看"],
  ["combat_manager.view", "战斗管理 / 战斗日志"],
  ["admin_warn.view", "警告记录"],
  ["scheduled_broadcast.view", "定时广播"],
  ["squad_management.view", "小队管理"],
  ["plugin:panel-ban:view", "面板封禁"],
  ["group_report.view", "抱团报备"],
  ["plugin:tactical-report:view", "战术报点页面"],
  ["plugin:tactical-report:update", "战术报点配置"],
  ["plugin:tactical-report:logs", "战术报点日志"],
  ["plugin:tactical-report:user-codes", "战术报点玩家自定义码"],
  ["server_stats.view", "服务器统计"],
  ["tactical_map_replay.view", "战术地图回放"],
  ["tactical_map_replay.export", "战术地图回放导出"],
  ["debug.udp_forwarder.view", "UDP 转发日志"],
  ["debug.match_snapshots.view", "快照录制"],
  ["debug.pjsc_average_duration.view", "PJSC 平均时长"],
  ["debug.draw_vote_guard.view", "平局投票提示"],
  ["debug.welcome_join_warning.view", "入服欢迎警告"],
  ["debug.squad_name_policy.view", "队名规范"],
  ["audit.view", "操作记录"],
]);

const pagePermissionOptions = buildPagePermissionOptions();
const reserveSlotPermissionOptions: PermissionOption[] = [
  { value: "reserve_slots.view", label: "查看预留位" },
  { value: "reserve_slots.manage", label: "管理成员 / 时长" },
  { value: "reserve_slots.cdk.manage", label: "管理 CDK 批次" },
  { value: "reserve_slots.export", label: "导出 CSV" },
  { value: "reserve_slots.config.manage", label: "修改系统设置" },
];

const systemPermissionOptions: PermissionOption[] = [
  { value: "settings.manage", label: "系统设置 / 插件订阅" },
  { value: "admin_users.manage", label: "管理员账号" },
  { value: "bzss_core.use", label: "BZSS-Core" },
  { value: "tactical_map_replay.view", label: "战术地图回放" },
  { value: "tactical_map_replay.export", label: "战术地图回放导出" },
];

const permissionSections: PermissionSection[] = [
  {
    key: "page",
    label: "页面访问",
    description: "控制账号能看到哪些页面入口，并限制直接访问对应路由。",
    options: pagePermissionOptions,
  },
  {
    key: "reserve-slots",
    label: "预留位操作",
    description: "先授予“查看预留位”，再按需分配成员、CDK、导出和设置权限。",
    options: reserveSlotPermissionOptions,
  },
  {
    key: "rcon",
    label: "RCON 操作",
    description: "只开放这些手动 RCON 命令，其余命令仍仅允许 SuperAdmin。",
    options: rconPermissionOptions,
  },
  {
    key: "system",
    label: "系统权限",
    description: "用于插件订阅、系统配置、审计与账号管理等系统能力。",
    options: systemPermissionOptions,
  },
];

const permissionOptions = permissionSections.flatMap((section) => section.options);
const knownPermissionValues = new Set(permissionOptions.map((item) => item.value));

const auth = useAuthStore();
const users = ref<AdminUser[]>([]);
const permissionGroups = ref<PermissionGroup[]>([]);
const stats = reactive<AdminUserStats>({ total: 0, enabled: 0, superAdmins: 0, steamBound: 0 });
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const dialogError = ref("");
const editorOpen = ref(false);
const groupEditorOpen = ref(false);
const resetOpen = ref(false);
const editingUser = ref<AdminUser | null>(null);
const editingPermissionGroup = ref<PermissionGroup | null>(null);
const resetUser = ref<AdminUser | null>(null);
const showCreatePassword = ref(false);
const showResetPassword = ref(false);

const filters = reactive({
  search: "",
  role: "",
  enabled: "",
  permissionGroupId: "",
});

const form = reactive({
  username: "",
  displayName: "",
  role: "Admin" as AdminUserRole,
  permissionGroupId: "",
  steam64: "",
  viewerTeamAutoSwapEnabled: true,
  enabled: true,
  note: "",
  password: "",
  confirmPassword: "",
});

const groupForm = reactive({
  name: "",
  enabled: true,
  permissions: [] as string[],
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
    if (filters.permissionGroupId === "__none__" && item.role !== "SuperAdmin" && item.permissionGroupId) return false;
    if (filters.permissionGroupId && filters.permissionGroupId !== "__none__" && item.permissionGroupId !== filters.permissionGroupId) return false;
    if (!needle) return true;
    return [
      item.username,
      item.displayName,
      item.steam64,
      item.note,
      item.permissionGroupName,
    ].some((value) => String(value ?? "").toLowerCase().includes(needle));
  });
});

onMounted(loadAll);

async function loadAll() {
  loading.value = true;
  error.value = "";
  try {
    const response = await fetchAdminUsers();
    users.value = response.items ?? [];
    permissionGroups.value = response.permissionGroups ?? [];
    Object.assign(stats, response.stats ?? buildStats(users.value));
  } catch (err: any) {
    error.value = err?.message ?? "加载管理员数据失败";
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
    permissionGroupId: "",
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
    permissionGroupId: user.permissionGroupId ?? "",
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
    dialogError.value = "两次输入的密码不一致。";
    return;
  }

  saving.value = true;
  try {
    const permissionGroupId = form.role === "SuperAdmin" ? null : (form.permissionGroupId || null);
    if (editingUser.value) {
      await updateAdminUser(editingUser.value.id, {
        displayName: form.displayName,
        role: form.role,
        permissionGroupId,
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
        permissionGroupId,
        steam64: form.steam64 || null,
        viewerTeamAutoSwapEnabled: form.viewerTeamAutoSwapEnabled,
        enabled: form.enabled,
        note: form.note,
        password: form.password,
      });
    }
    closeEditor();
    await loadAll();
  } catch (err: any) {
    dialogError.value = err?.message ?? "保存失败";
  } finally {
    saving.value = false;
  }
}

function openCreateGroupDialog() {
  editingPermissionGroup.value = null;
  Object.assign(groupForm, {
    name: "",
    enabled: true,
    permissions: [],
  });
  dialogError.value = "";
  groupEditorOpen.value = true;
}

function openEditGroupDialog(group: PermissionGroup) {
  editingPermissionGroup.value = group;
  Object.assign(groupForm, {
    name: group.name,
    enabled: group.enabled,
    permissions: [...group.permissions],
  });
  dialogError.value = "";
  groupEditorOpen.value = true;
}

function closeGroupEditor() {
  groupEditorOpen.value = false;
}

function buildPagePermissionOptions(): PermissionOption[] {
  const seen = new Set<string>();
  const options: PermissionOption[] = [];

  for (const entry of WEB_PAGE_PERMISSION_MATRIX) {
    const value = String(entry.requiredPermission ?? "").trim();
    if (!value || seen.has(value)) continue;
    if (value === "settings.manage" || value === "admin_users.manage") continue;

    seen.add(value);
    options.push({
      value,
      label: pagePermissionLabels.get(value) ?? value,
    });
  }

  return options;
}

function isPermissionSectionFullySelected(section: PermissionSection) {
  return section.options.every((option) => groupForm.permissions.includes(option.value));
}

function togglePermissionSection(section: PermissionSection) {
  const values = section.options.map((option) => option.value);
  const next = new Set(groupForm.permissions);

  if (isPermissionSectionFullySelected(section)) {
    for (const value of values) next.delete(value);
  } else {
    for (const value of values) next.add(value);
  }

  groupForm.permissions = permissionOptions
    .map((option) => option.value)
    .filter((value) => next.has(value));
}

async function submitGroupEditor() {
  dialogError.value = "";
  saving.value = true;
  const permissions = permissionOptions
    .map((option) => option.value)
    .filter((value) => groupForm.permissions.includes(value));
  try {
    if (editingPermissionGroup.value) {
      await updatePermissionGroup(editingPermissionGroup.value.id, {
        name: groupForm.name,
        enabled: groupForm.enabled,
        permissions,
      });
    } else {
      await createPermissionGroup({
        name: groupForm.name,
        enabled: groupForm.enabled,
        permissions,
      });
    }
    closeGroupEditor();
    await loadAll();
  } catch (err: any) {
    dialogError.value = err?.message ?? "保存权限组失败";
  } finally {
    saving.value = false;
  }
}

async function deletePermissionGroupAction(group: PermissionGroup) {
  const ok = window.confirm(`确认删除权限组 ${group.name}？`);
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await deletePermissionGroup(group.id);
    await loadAll();
  } catch (err: any) {
    error.value = err?.message ?? "删除权限组失败";
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
    dialogError.value = "两次输入的密码不一致。";
    return;
  }

  saving.value = true;
  try {
    await resetAdminUserPassword(resetUser.value.id, resetForm.password);
    closeReset();
    await loadAll();
  } catch (err: any) {
    dialogError.value = err?.message ?? "重置失败";
  } finally {
    saving.value = false;
  }
}

async function deleteUser(user: AdminUser) {
  const ok = window.confirm(`确认删除管理员 ${user.username}？删除后该账号将无法登录，此操作不可撤销。`);
  if (!ok) return;
  saving.value = true;
  error.value = "";
  try {
    await deleteAdminUser(user.id);
    await loadAll();
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

function countGroupSectionPermissions(group: PermissionGroup, section: PermissionSection) {
  return section.options.filter((option) => group.permissions.includes(option.value)).length;
}

function countKnownPermissions(permissions: string[] | null | undefined) {
  if (!Array.isArray(permissions)) return 0;
  return permissions.filter((permission) => knownPermissionValues.has(permission)).length;
}

function renderUserPermissionSummary(user: AdminUser) {
  if (user.role === "SuperAdmin") return "全权限";
  const count = countKnownPermissions(user.permissions);
  return count > 0 ? `${count} 项权限` : "无权限";
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
.modal-panel,
.permission-groups-shell {
  border: 1px solid var(--color-border-default);
  background: var(--color-bg-panel);
}

.admin-users-header,
.section-title-row,
.modal-panel header,
.modal-panel footer,
.password-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.admin-users-header {
  align-items: flex-start;
  padding: 20px;
  border-radius: 8px;
}

.header-actions,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--color-text-muted);
  font-size: 12px;
  text-transform: uppercase;
}

h1,
h2,
h3,
.subtitle {
  margin: 0;
}

h1 {
  font-size: 28px;
}

h2 {
  font-size: 20px;
}

h3 {
  font-size: 18px;
}

.subtitle,
.hint,
.group-meta {
  color: var(--color-text-muted);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin: 16px 0;
}

.stat-card,
.group-card,
.empty-card {
  padding: 16px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: color-mix(in srgb, var(--color-bg-card) 84%, white 16%);
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

.permission-groups-shell {
  margin-bottom: 16px;
  padding: 16px;
  border-radius: 8px;
}

.group-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.group-card {
  display: grid;
  gap: 14px;
}

.group-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.group-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 13px;
}

.toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) repeat(3, minmax(120px, 180px));
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
  background: color-mix(in srgb, var(--color-bg-elevated) 88%, transparent);
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
  background: color-mix(in srgb, var(--color-bg-elevated) 82%, transparent);
}

.ghost-button.small {
  min-height: 30px;
  padding: 0 10px;
  font-size: 12px;
}

.table-shell {
  margin-top: 16px;
  border-radius: 8px;
  overflow: auto;
}

table {
  width: 100%;
  min-width: 1100px;
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
.status-pill,
.permission-count-pill,
.superadmin-note {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  border-radius: 999px;
  padding: 0 8px;
  font-size: 12px;
  font-weight: 700;
}

.role-badge[data-role="SuperAdmin"],
.superadmin-note {
  color: #fbbf24;
  background: rgba(251, 191, 36, 0.14);
}

.role-badge[data-role="Admin"] {
  color: #93c5fd;
  background: rgba(147, 197, 253, 0.12);
}

.status-pill[data-enabled="true"],
.permission-count-pill[data-empty="false"] {
  color: #86efac;
  background: rgba(134, 239, 172, 0.12);
}

.status-pill[data-enabled="false"],
.permission-count-pill[data-empty="true"] {
  color: #fca5a5;
  background: rgba(252, 165, 165, 0.12);
}

.permission-summary-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.permission-section-list {
  display: grid;
  gap: 12px;
}

.permission-editor-section {
  display: grid;
  gap: 8px;
}

.permission-editor-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.permission-option-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.permission-option {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--color-border-soft);
  background: color-mix(in srgb, var(--color-bg-card) 86%, white 14%);
}

.permission-option input,
.checkbox-row input {
  width: 16px;
  min-height: 16px;
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
  background: color-mix(in srgb, var(--color-bg-page) 74%, transparent);
}

.modal-panel {
  width: min(720px, 100%);
  max-height: 100%;
  overflow: auto;
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 8px;
}

.modal-panel.compact {
  width: min(520px, 100%);
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

@media (max-width: 900px) {
  .stats-grid,
  .toolbar,
  .permission-option-grid {
    grid-template-columns: 1fr 1fr;
  }

  .admin-users-header,
  .section-title-row,
  .group-card-head {
    flex-direction: column;
  }
}

@media (max-width: 620px) {
  .admin-users-page {
    padding: 14px;
  }

  .stats-grid,
  .toolbar,
  .permission-option-grid {
    grid-template-columns: 1fr;
  }
}
</style>
