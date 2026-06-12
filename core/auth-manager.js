// -*- coding: utf-8 -*-

import crypto from "node:crypto";

import { hashPassword, hashToken, INVALID_PASSWORD_HASH, verifyPassword } from "./auth-crypto.js";
import { AuthUserStore, normalizeRole } from "./auth-user-store.js";
import { hasPermission as hasSharedPermission } from "../web-client/src/shared/rcon-permissions.js";

const DEFAULT_USERNAME = "DoubyBear";
const DEFAULT_ROLE = "SuperAdmin";
const DEFAULT_PASSWORD_HASH = "scrypt$bzss-default-v1$1ZZCEAyPd4n5hgfHwMsYr9ftwYX2yS-VzBhU0tZRr1olmbHtTdDGO-dHJw43NGv0fg2meuR3LbLHOqdxNsQPvQ";

/**
 * Core: AuthManager
 *
 * 只负责密码校验、Session 生命周期和请求鉴权。
 * 账号持久化由 AuthUserStore 单独承担。
 */
export class AuthManager {
  constructor({ config = {}, logger }) {
    this.config = config;
    this.enabled = config.enabled ?? true;
    this.logger = logger;
    this.authorizationMode = String(config.authorizationMode ?? "transitional").trim() || "transitional";
    this.sessionCookieName = config.sessionCookieName ?? "bzss_session";
    this.sessionTtlMs = Number(config.sessionTtlMs ?? 1000 * 60 * 60 * 12);
    this.secureCookie = Boolean(config.secureCookie ?? false);

    this.userStore = new AuthUserStore({ config, logger });
    this.sessions = new Map();
  }

  async start() {
    await this.userStore.start();

    if (!this.enabled) {
      this.logger?.warn?.("AuthManager disabled. No authenticated web session will be created.");
      return;
    }

    await this.bootstrapInitialUsersIfNeeded();
    await this.migrateDefaultSteam64ToSuperAdminIfNeeded();

    if (!this.userStore.hasEnabledSuperAdmin()) {
      throw new Error(`Auth startup aborted: no enabled SuperAdmin found in ${this.userStore.filePath}`);
    }

    this.logger?.info?.("AuthManager started.");
  }

  async stop() {
    this.sessions.clear();
  }

  async login({ username, password, ip = "" }) {
    if (!this.enabled) {
      return {
        ok: false,
        error: "AuthDisabled",
      };
    }

    this.userStore.refreshFromDiskIfChangedSync();

    const normalizedUsername = String(username ?? "").trim();
    const rawPassword = String(password ?? "");
    const user = this.userStore.findByUsername(normalizedUsername);

    const passwordHash = user?.passwordHash ?? INVALID_PASSWORD_HASH;
    const passwordOk = await verifyPassword(rawPassword, passwordHash);

    if (!user || !user.enabled || !passwordOk) {
      this.logger?.warn?.(`Login failed username=${normalizedUsername || "<empty>"} ip=${ip}`);
      return { ok: false, error: "InvalidCredentials" };
    }

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + this.sessionTtlMs;

    this.sessions.set(tokenHash, {
      tokenHash,
      userId: user.id,
      authVersion: Number(user.authVersion ?? 1),
      createdAt: now,
      expiresAt,
      ip,
    });

    this.logger?.info?.(`Login success username=${user.username} role=${user.role} ip=${ip}`);

    return {
      ok: true,
      user: this.safeUser(user),
      cookie: this.makeSessionCookie(token, expiresAt),
    };
  }

  logout(req) {
    const token = this.getTokenFromRequest(req);
    if (token) this.sessions.delete(hashToken(token));
    return this.makeExpiredCookie();
  }

  getUserFromRequest(req) {
    if (!this.enabled) return null;
    this.userStore.refreshFromDiskIfChangedSync();

    const token = this.getTokenFromRequest(req);
    if (!token) return null;

    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }

    const user = this.userStore.getUserById(session.userId);
    if (!user || !user.enabled || Number(user.authVersion ?? 1) !== Number(session.authVersion ?? 0)) {
      this.sessions.delete(tokenHash);
      return null;
    }

    return this.safeUser(user);
  }

  requireLogin(req) {
    const user = this.getUserFromRequest(req);
    if (!user) {
      const error = new Error("Authentication required.");
      error.statusCode = 401;
      error.code = "Unauthorized";
      throw error;
    }
    return user;
  }

  hasEverything(user) {
    return Boolean(user && this.isSuperAdminRole(user.role));
  }

  hasPermission(user, permission) {
    if (!user) return false;
    if (this.hasEverything(user)) return true;

    const wanted = String(permission ?? "").trim();
    if (!wanted) return false;

    const permissions = this.resolveEffectivePermissions(user);

    if (hasSharedPermission(permissions, wanted)) return true;

    const [namespace] = wanted.split(".");
    if (namespace && permissions.includes(`${namespace}.*`)) return true;

    return false;
  }

  isSuperAdminRole(role) {
    return normalizeRole(role) === "SuperAdmin";
  }

  safeUser(user) {
    const permissionGroup = user?.permissionGroupId ? this.userStore.getPermissionGroupById(user.permissionGroupId) : null;
    const permissions = this.resolveEffectivePermissions(user);
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? "",
      role: user.role,
      isSuperAdmin: this.isSuperAdminRole(user.role),
      steam64: normalizeSteam64(user.steam64 ?? this.config?.defaultSteam64),
      viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled ?? (this.config?.viewerTeamAutoSwapEnabled !== false),
      permissions,
      permissionGroupId: user.permissionGroupId ?? null,
      permissionGroupName: permissionGroup?.name ?? "",
      authorizationMode: this.authorizationMode,
    };
  }

  resolveEffectivePermissions(user) {
    if (!user) return [];
    if (this.hasEverything(user)) return ["*"];

    const groupId = String(user.permissionGroupId ?? "").trim();
    if (groupId) {
      const group = this.userStore.getPermissionGroupById(groupId);
      if (group?.enabled !== false) {
        return normalizePermissions(group.permissions);
      }
    }

    return normalizePermissions(user.permissions ?? user.permission);
  }

  getTokenFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie ?? "");
    return cookies[this.sessionCookieName] ?? "";
  }

  makeSessionCookie(token, expiresAt) {
    const parts = [
      `${this.sessionCookieName}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      `Expires=${new Date(expiresAt).toUTCString()}`,
      `Max-Age=${Math.floor(this.sessionTtlMs / 1000)}`,
    ];

    if (this.secureCookie) parts.push("Secure");
    return parts.join("; ");
  }

  makeExpiredCookie() {
    return `${this.sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
  }

  async bootstrapInitialUsersIfNeeded() {
    if (this.userStore.listUsers().length > 0) return false;

    const configuredUsers = Array.isArray(this.config?.users) ? this.config.users : [];
    if (configuredUsers.length > 0) {
      for (const user of configuredUsers) {
        const username = String(user?.username ?? "").trim();
        if (!username) continue;
        await this.userStore.createUser({
          id: String(user?.id ?? `user:${username.toLowerCase()}`),
          username,
          passwordHash: String(user?.passwordHash ?? INVALID_PASSWORD_HASH),
          role: user?.role ?? DEFAULT_ROLE,
          displayName: user?.displayName ?? "",
          steam64: user?.steam64 ?? (this.isSuperAdminRole(user?.role ?? DEFAULT_ROLE) ? this.config?.defaultSteam64 : null),
          viewerTeamAutoSwapEnabled: user?.viewerTeamAutoSwapEnabled ?? (this.config?.viewerTeamAutoSwapEnabled !== false),
          note: user?.note ?? "",
          enabled: user?.enabled ?? true,
          authVersion: Number(user?.authVersion ?? 1),
          permissions: user?.permissions ?? [],
          createdAt: Number(user?.createdAt ?? Date.now()),
          updatedAt: Number(user?.updatedAt ?? Date.now()),
          passwordChangedAt: Number(user?.passwordChangedAt ?? Date.now()),
        });
      }
      this.logger?.warn?.(`AuthManager bootstrapped ${this.userStore.listUsers().length} user(s) from auth.users into ${this.userStore.filePath}.`);
      return true;
    }

    await this.userStore.createUser({
      id: "user:superadmin",
      username: DEFAULT_USERNAME,
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: DEFAULT_ROLE,
      displayName: DEFAULT_USERNAME,
      steam64: this.config?.defaultSteam64 ?? null,
      viewerTeamAutoSwapEnabled: this.config?.viewerTeamAutoSwapEnabled !== false,
      note: "",
      enabled: true,
      authVersion: 1,
      permissions: ["*"],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      passwordChangedAt: Date.now(),
    });
    this.logger?.warn?.(`AuthManager bootstrapped legacy default SuperAdmin into ${this.userStore.filePath}.`);
    return true;
  }

  async migrateDefaultSteam64ToSuperAdminIfNeeded() {
    const defaultSteam64 = normalizeSteam64(this.config?.defaultSteam64);
    if (!defaultSteam64) return false;

    const users = this.userStore.listUsers();
    if (users.some((user) => user.steam64 === defaultSteam64)) return false;
    if (users.some((user) => user.steam64)) return false;

    const target = users.find((user) => user.enabled && this.isSuperAdminRole(user.role))
      ?? users.find((user) => this.isSuperAdminRole(user.role));
    if (!target) return false;

    await this.userStore.updateUser(target.id, {
      steam64: defaultSteam64,
      viewerTeamAutoSwapEnabled: this.config?.viewerTeamAutoSwapEnabled !== false,
    });
    this.logger?.warn?.(`AuthManager migrated auth.defaultSteam64 to SuperAdmin account ${target.username}.`);
    return true;
  }

  async hashPassword(password) {
    return hashPassword(password);
  }
}

function parseCookies(cookieHeader) {
  const result = {};
  for (const part of String(cookieHeader).split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function normalizeSteam64(value) {
  const text = String(value ?? "").trim();
  return /^\d{17}$/.test(text) ? text : "";
}

function normalizePermissions(value) {
  if (!value) return [];

  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => String(key).trim())
      .filter(Boolean);
  }

  return [];
}
