// -*- coding: utf-8 -*-

import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { WEB_PAGE_PERMISSION_MATRIX } from "../../web-client/src/shared/web-page-permissions.js";

const DEFAULT_USERS_FILE = "./config/auth/users.json";
const LEGACY_USERS_FILE = "./data/auth/users.json";
const PERMISSION_ALIASES = Object.freeze({});

export class AuthUserStore {
  constructor({ config = {}, logger } = {}) {
    this.logger = logger;
    this.filePath = resolveUsersFilePath(config);
    this.version = 1;
    this.users = [];
    this.usersById = new Map();
    this.usersByUsername = new Map();
    this.permissionGroups = [];
    this.permissionGroupsById = new Map();
    this.writeQueue = Promise.resolve();
    this.lastLoadedMtimeMs = 0;
  }

  async start() {
    await migrateLegacyUsersFileIfNeeded(this.filePath, this.logger);
    await this.load();
  }

  async load() {
    try {
      const text = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(text);
      const stats = await fs.stat(this.filePath);
      this.applyLoadedDocument(parsed, stats.mtimeMs);
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.version = 1;
        this.replaceUsers([]);
        this.replacePermissionGroups([]);
        this.lastLoadedMtimeMs = 0;
        return;
      }
      throw error;
    }
  }

  refreshFromDiskIfChangedSync() {
    let stats = null;
    try {
      stats = fsSync.statSync(this.filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return false;
      }
      throw error;
    }

    if (!stats || stats.mtimeMs <= this.lastLoadedMtimeMs) {
      return false;
    }

    const text = fsSync.readFileSync(this.filePath, "utf8");
    const parsed = JSON.parse(text);
    this.applyLoadedDocument(parsed, stats.mtimeMs);
    return true;
  }

  hasEnabledSuperAdmin() {
    return this.users.some((user) => user.enabled && user.role === "SuperAdmin");
  }

  countEnabledSuperAdmins(excludeUserId = "") {
    return this.users.filter((user) => user.enabled && user.role === "SuperAdmin" && user.id !== excludeUserId).length;
  }

  getUserById(userId) {
    const user = this.usersById.get(String(userId ?? "").trim());
    return user ? cloneUser(user) : null;
  }

  findByUsername(username) {
    const key = normalizeUsername(username);
    if (!key) return null;
    const user = this.usersByUsername.get(key);
    return user ? cloneUser(user) : null;
  }

  listUsers() {
    return this.users
      .slice()
      .sort((left, right) => left.usernameNormalized.localeCompare(right.usernameNormalized))
      .map((user) => cloneUser(user));
  }

  listPermissionGroups() {
    return this.permissionGroups
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((group) => clonePermissionGroup(group));
  }

  getPermissionGroupById(groupId) {
    const group = this.permissionGroupsById.get(String(groupId ?? "").trim());
    return group ? clonePermissionGroup(group) : null;
  }

  async createUser(input) {
    const username = normalizeUsernameForDisplay(input?.username);
    const usernameNormalized = normalizeUsername(username);
    if (!usernameNormalized) {
      throw createAuthUserStoreError(400, "InvalidUsername", "Username is required.");
    }
    if (this.usersByUsername.has(usernameNormalized)) {
      throw createAuthUserStoreError(409, "UserAlreadyExists", "Username already exists.");
    }

    const now = Date.now();
    const user = normalizeStoredUser({
      id: String(input?.id ?? `user:${usernameNormalized}`),
      username,
      usernameNormalized,
      passwordHash: String(input?.passwordHash ?? ""),
      role: input?.role,
      displayName: input?.displayName,
      steam64: input?.steam64,
      viewerTeamAutoSwapEnabled: input?.viewerTeamAutoSwapEnabled,
      note: input?.note,
      permissionGroupId: input?.permissionGroupId,
      enabled: input?.enabled ?? true,
      authVersion: Number(input?.authVersion ?? 1),
      permissions: input?.permissions ?? [],
      createdAt: now,
      updatedAt: now,
      passwordChangedAt: Number(input?.passwordChangedAt ?? now),
    });

    this.replaceUsers([...this.users, user]);
    await this.save();
    return cloneUser(user);
  }

  async setUserEnabled(usernameOrId, enabled) {
    const current = this.requireExistingUser(usernameOrId);
    const nextEnabled = Boolean(enabled);
    if (current.enabled === nextEnabled) return cloneUser(current);
    if (!nextEnabled && current.role === "SuperAdmin" && this.countEnabledSuperAdmins(current.id) < 1) {
      throw createAuthUserStoreError(400, "LastSuperAdmin", "Cannot disable the last enabled SuperAdmin.");
    }

    const nextUser = normalizeStoredUser({
      ...current,
      enabled: nextEnabled,
      authVersion: Number(current.authVersion ?? 1) + 1,
      updatedAt: Date.now(),
    });

    this.replaceUser(nextUser);
    await this.save();
    return cloneUser(nextUser);
  }

  async updateUser(usernameOrId, changes = {}) {
    const current = this.requireExistingUser(usernameOrId);
    const nextRole = changes.role === undefined ? current.role : normalizeRole(changes.role);
    const nextEnabled = changes.enabled === undefined ? current.enabled : Boolean(changes.enabled);

    if (current.role === "SuperAdmin" && current.enabled && (nextRole !== "SuperAdmin" || !nextEnabled) && this.countEnabledSuperAdmins(current.id) < 1) {
      throw createAuthUserStoreError(400, "LastSuperAdmin", "Cannot remove the last enabled SuperAdmin.");
    }

    const nextUser = normalizeStoredUser({
      ...current,
      displayName: changes.displayName === undefined ? current.displayName : changes.displayName,
      role: nextRole,
      steam64: changes.steam64 === undefined ? current.steam64 : changes.steam64,
      viewerTeamAutoSwapEnabled: changes.viewerTeamAutoSwapEnabled === undefined
        ? current.viewerTeamAutoSwapEnabled
        : changes.viewerTeamAutoSwapEnabled,
      enabled: nextEnabled,
      note: changes.note === undefined ? current.note : changes.note,
      permissionGroupId: changes.permissionGroupId === undefined ? current.permissionGroupId : changes.permissionGroupId,
      updatedAt: Date.now(),
      authVersion: nextEnabled === current.enabled && nextRole === current.role
        ? Number(current.authVersion ?? 1)
        : Number(current.authVersion ?? 1) + 1,
    });

    if (nextUser.steam64) {
      this.assertSteam64Available(nextUser.steam64, current.id);
    }

    this.replaceUser(nextUser);
    await this.save();
    return cloneUser(nextUser);
  }

  async updatePassword(usernameOrId, passwordHash) {
    const current = this.requireExistingUser(usernameOrId);
    const now = Date.now();
    const nextUser = normalizeStoredUser({
      ...current,
      passwordHash: String(passwordHash ?? ""),
      authVersion: Number(current.authVersion ?? 1) + 1,
      updatedAt: now,
      passwordChangedAt: now,
    });

    this.replaceUser(nextUser);
    await this.save();
    return cloneUser(nextUser);
  }

  async deleteUser(usernameOrId) {
    const current = this.requireExistingUser(usernameOrId);
    if (current.role === "SuperAdmin" && current.enabled && this.countEnabledSuperAdmins(current.id) < 1) {
      throw createAuthUserStoreError(400, "LastSuperAdmin", "Cannot delete the last enabled SuperAdmin.");
    }

    this.replaceUsers(this.users.filter((user) => user.id !== current.id));
    await this.save();
    return cloneUser(current);
  }

  findBySteam64(steam64) {
    const normalized = normalizeSteam64(steam64);
    if (!normalized) return null;
    const user = this.users.find((candidate) => candidate.steam64 === normalized);
    return user ? cloneUser(user) : null;
  }

  assertSteam64Available(steam64, excludeUserId = "") {
    const normalized = normalizeSteam64(steam64);
    if (!normalized) return true;
    const existing = this.users.find((user) => user.steam64 === normalized && user.id !== excludeUserId);
    if (existing) {
      throw createAuthUserStoreError(409, "SteamAlreadyBound", `Steam64 is already bound to user ${existing.username}.`);
    }
    return true;
  }

  requireExistingUser(usernameOrId) {
    const directId = String(usernameOrId ?? "").trim();
    const byId = directId ? this.usersById.get(directId) : null;
    if (byId) return cloneUser(byId);

    const byUsername = this.usersByUsername.get(normalizeUsername(usernameOrId));
    if (byUsername) return cloneUser(byUsername);

    throw createAuthUserStoreError(404, "UserNotFound", "User not found.");
  }

  replaceUser(nextUser) {
    this.replaceUsers(this.users.map((user) => (user.id === nextUser.id ? nextUser : user)));
  }

  replaceUsers(users) {
    this.users = users.map((user) => normalizeStoredUser(user));
    this.usersById = new Map();
    this.usersByUsername = new Map();

    for (const user of this.users) {
      if (this.usersById.has(user.id)) {
        throw createAuthUserStoreError(500, "DuplicateUserId", `Duplicate user id: ${user.id}`);
      }
      if (this.usersByUsername.has(user.usernameNormalized)) {
        throw createAuthUserStoreError(500, "DuplicateUsername", `Duplicate username: ${user.username}`);
      }
      this.usersById.set(user.id, user);
      this.usersByUsername.set(user.usernameNormalized, user);
    }
  }

  replacePermissionGroups(groups) {
    this.permissionGroups = groups.map((group) => normalizePermissionGroup(group));
    this.permissionGroupsById = new Map();

    for (const group of this.permissionGroups) {
      if (this.permissionGroupsById.has(group.id)) {
        throw createAuthUserStoreError(500, "DuplicatePermissionGroupId", `Duplicate permission group id: ${group.id}`);
      }
      this.permissionGroupsById.set(group.id, group);
    }
  }

  async createPermissionGroup(input = {}) {
    const now = Date.now();
    const group = normalizePermissionGroup({
      id: input?.id ?? `group:${cryptoSafeId()}`,
      name: input?.name,
      enabled: input?.enabled ?? true,
      permissions: input?.permissions ?? [],
      createdAt: now,
      updatedAt: now,
    });
    this.assertPermissionGroupNameAvailable(group.name);
    this.replacePermissionGroups([...this.permissionGroups, group]);
    await this.save();
    return clonePermissionGroup(group);
  }

  async updatePermissionGroup(groupId, changes = {}) {
    const current = this.requireExistingPermissionGroup(groupId);
    const nextGroup = normalizePermissionGroup({
      ...current,
      name: changes.name === undefined ? current.name : changes.name,
      enabled: changes.enabled === undefined ? current.enabled : changes.enabled,
      permissions: changes.permissions === undefined ? current.permissions : changes.permissions,
      updatedAt: Date.now(),
    });
    this.assertPermissionGroupNameAvailable(nextGroup.name, current.id);
    this.replacePermissionGroups(this.permissionGroups.map((group) => (group.id === nextGroup.id ? nextGroup : group)));
    await this.save();
    return clonePermissionGroup(nextGroup);
  }

  async deletePermissionGroup(groupId) {
    const current = this.requireExistingPermissionGroup(groupId);
    const usingUser = this.users.find((user) => user.permissionGroupId === current.id);
    if (usingUser) {
      throw createAuthUserStoreError(409, "PermissionGroupInUse", `Permission group is still assigned to user ${usingUser.username}.`);
    }
    this.replacePermissionGroups(this.permissionGroups.filter((group) => group.id !== current.id));
    await this.save();
    return clonePermissionGroup(current);
  }

  requireExistingPermissionGroup(groupId) {
    const id = String(groupId ?? "").trim();
    const group = id ? this.permissionGroupsById.get(id) : null;
    if (!group) {
      throw createAuthUserStoreError(404, "PermissionGroupNotFound", "Permission group not found.");
    }
    return clonePermissionGroup(group);
  }

  assertPermissionGroupNameAvailable(name, excludeGroupId = "") {
    const normalized = normalizePermissionGroupName(name);
    if (!normalized) {
      throw createAuthUserStoreError(400, "InvalidPermissionGroupName", "Permission group name is required.");
    }
    const existing = this.permissionGroups.find((group) => normalizePermissionGroupName(group.name) === normalized && group.id !== excludeGroupId);
    if (existing) {
      throw createAuthUserStoreError(409, "PermissionGroupAlreadyExists", "Permission group name already exists.");
    }
    return true;
  }

  async save() {
    return this.runWriteQueue(() => this.performSave());
  }

  async performSave() {
    const payload = {
      version: this.version,
      users: this.users.map((user) => ({
        id: user.id,
        username: user.username,
        usernameNormalized: user.usernameNormalized,
        passwordHash: user.passwordHash,
        role: user.role,
        displayName: user.displayName,
        steam64: user.steam64,
        viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled,
        enabled: user.enabled,
        note: user.note,
        permissionGroupId: user.permissionGroupId,
        authVersion: user.authVersion,
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        passwordChangedAt: user.passwordChangedAt,
      })),
      permissionGroups: this.permissionGroups.map((group) => ({
        id: group.id,
        name: group.name,
        enabled: group.enabled,
        permissions: Array.isArray(group.permissions) ? [...group.permissions] : [],
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      })),
    };

    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    const tempPath = path.join(dir, `${path.basename(this.filePath)}.${process.pid}.${Date.now()}.tmp`);

    try {
      await fs.writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, this.filePath);
      const stats = await fs.stat(this.filePath);
      this.lastLoadedMtimeMs = stats.mtimeMs;
      return {
        ok: true,
        filePath: this.filePath,
      };
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => {});
    }
  }

  runWriteQueue(task) {
    const run = this.writeQueue.then(() => task());
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  applyLoadedDocument(parsed, mtimeMs = 0) {
    const rawUsers = Array.isArray(parsed?.users) ? parsed.users : [];
    const rawGroups = Array.isArray(parsed?.permissionGroups) ? parsed.permissionGroups : [];
    this.version = Number(parsed?.version ?? 1) || 1;
    this.replacePermissionGroups(rawGroups.map((group) => normalizePermissionGroup(group)));
    this.replaceUsers(rawUsers.map((user) => normalizeStoredUser(user)));
    this.lastLoadedMtimeMs = Number(mtimeMs ?? 0) || 0;
  }
}

export function normalizeRole(role) {
  const text = String(role ?? "").trim().toLowerCase();
  if (text === "superadmin") return "SuperAdmin";
  if (text === "admin") return "Admin";
  throw createAuthUserStoreError(400, "InvalidRole", "Role must be SuperAdmin or Admin.");
}

export function normalizeUsername(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeUsernameForDisplay(value) {
  return String(value ?? "").trim();
}

function normalizeStoredUser(input) {
  const username = normalizeUsernameForDisplay(input?.username);
  const usernameNormalized = normalizeUsername(input?.usernameNormalized ?? username);
  if (!username || !usernameNormalized) {
    throw createAuthUserStoreError(400, "InvalidUsername", "Username is required.");
  }

  return {
    id: String(input?.id ?? `user:${usernameNormalized}`),
    username,
    usernameNormalized,
    passwordHash: String(input?.passwordHash ?? ""),
    role: normalizeRole(input?.role),
    displayName: String(input?.displayName ?? "").trim(),
    steam64: normalizeSteam64(input?.steam64),
    viewerTeamAutoSwapEnabled: input?.viewerTeamAutoSwapEnabled !== false,
    enabled: input?.enabled !== false,
    note: String(input?.note ?? ""),
    permissionGroupId: normalizePermissionGroupId(input?.permissionGroupId),
    authVersion: Math.max(1, Math.floor(Number(input?.authVersion ?? 1) || 1)),
    permissions: normalizePermissions(input?.permissions),
    createdAt: Number(input?.createdAt ?? Date.now()),
    updatedAt: Number(input?.updatedAt ?? Date.now()),
    passwordChangedAt: Number(input?.passwordChangedAt ?? 0),
  };
}

export const ALLOWED_ADMIN_PERMISSIONS = Object.freeze([
  "rcon.tb",
  "rcon.warn",
  "rcon.broadcast",
  "rcon.kick",
  "rcon.disband",
  "rcon.remove",
  "settings.manage",
  "admin_users.manage",
  "bzss_core.use",
  "tactical_map_replay.view",
  "tactical_map_replay.export",
  ...WEB_PAGE_PERMISSION_MATRIX.map((entry) => String(entry.requiredPermission ?? "").trim()).filter(Boolean),
]);

function normalizePermissionGroup(input) {
  const name = String(input?.name ?? "").trim();
  if (!name) {
    throw createAuthUserStoreError(400, "InvalidPermissionGroupName", "Permission group name is required.");
  }

  return {
    id: String(input?.id ?? `group:${cryptoSafeId()}`).trim(),
    name,
    enabled: input?.enabled !== false,
    permissions: normalizePermissionGroupPermissions(input?.permissions),
    createdAt: Number(input?.createdAt ?? Date.now()),
    updatedAt: Number(input?.updatedAt ?? Date.now()),
  };
}

function normalizePermissionGroupPermissions(value) {
  const items = normalizePermissions(value);
  const invalid = items.find((item) => !ALLOWED_ADMIN_PERMISSIONS.includes(item));
  if (invalid) {
    throw createAuthUserStoreError(400, "InvalidPermission", `Unsupported permission: ${invalid}`);
  }
  return [...new Set(items)];
}

function normalizePermissionGroupId(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function normalizePermissionGroupName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeSteam64(value) {
  if (value === null || value === undefined) return null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (!/^\d{17}$/.test(text)) {
    throw createAuthUserStoreError(400, "InvalidSteam64", "Steam64 must be a 17-digit number.");
  }
  return text;
}

function normalizePermissions(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => normalizePermissionName(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => normalizePermissionName(item)).filter(Boolean);
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => normalizePermissionName(key))
      .filter(Boolean);
  }
  return [];
}

function resolveUsersFilePath(config) {
  const configured = String(config?.usersFilePath ?? "").trim();
  const target = configured || DEFAULT_USERS_FILE;
  return path.resolve(process.cwd(), target);
}

async function migrateLegacyUsersFileIfNeeded(filePath, logger) {
  const normalizedTarget = path.resolve(filePath);
  const defaultTarget = path.resolve(process.cwd(), DEFAULT_USERS_FILE);
  if (normalizedTarget !== defaultTarget) return;

  const legacyPath = path.resolve(process.cwd(), LEGACY_USERS_FILE);
  if (legacyPath === normalizedTarget) return;

  const targetExists = await pathExists(normalizedTarget);
  if (targetExists) return;

  const legacyExists = await pathExists(legacyPath);
  if (!legacyExists) return;

  await fs.mkdir(path.dirname(normalizedTarget), { recursive: true });
  try {
    await fs.rename(legacyPath, normalizedTarget);
  } catch {
    await fs.copyFile(legacyPath, normalizedTarget);
    await fs.rm(legacyPath, { force: true }).catch(() => {});
  }

  logger?.warn?.(`[AuthUserStore] migrated legacy users file from ${legacyPath} to ${normalizedTarget}.`);
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function normalizePermissionName(value) {
  const permission = String(value ?? "").trim();
  if (!permission) return "";
  return PERMISSION_ALIASES[permission] ?? permission;
}

function cloneUser(user) {
  return {
    ...user,
    permissions: Array.isArray(user.permissions) ? [...user.permissions] : [],
  };
}

function clonePermissionGroup(group) {
  return {
    ...group,
    permissions: Array.isArray(group.permissions) ? [...group.permissions] : [],
  };
}

function cryptoSafeId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function createAuthUserStoreError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}
