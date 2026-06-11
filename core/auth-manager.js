// -*- coding: utf-8 -*-

import crypto from "node:crypto";
import { WebSecurityConfigurationError } from "./web-security.js";

const DEFAULT_USERNAME = "DoubyBear";
const DEFAULT_ROLE = "SuperAdmin";
const DEFAULT_PASSWORD_HASH = "scrypt$bzss-default-v1$1ZZCEAyPd4n5hgfHwMsYr9ftwYX2yS-VzBhU0tZRr1olmbHtTdDGO-dHJw43NGv0fg2meuR3LbLHOqdxNsQPvQ";
const INVALID_PASSWORD_HASH = "scrypt$bzss-invalid-v1$UpgdHuTdcHnUYRfcBTFvC0by9qv9iboyj_VwZCfhJH5Xg1ZceJ637AMeDSSBZKSphN2Z_uIfGyl_AaOkBENdZw";

/**
 * Core: AuthManager
 *
 * 简单但安全的 Web 登录系统：
 * - 密码只保存 scrypt 哈希，不保存明文。
 * - Session token 只保存 SHA-256 哈希，不保存原始 token。
 * - Cookie 使用 HttpOnly / SameSite=Strict。
 *
 * 注意：绝对安全不存在。生产环境仍应使用 HTTPS、强密码、反向代理限流和定期改密。
 */
export class AuthManager {
  constructor({ config = {}, logger }) {
    this.config = config;
    this.enabled = config.enabled ?? true;
    this.logger = logger;
    this.sessionCookieName = config.sessionCookieName ?? "__Host-bzss_session";
    this.sessionTtlMs = Number(config.sessionTtlMs ?? 1000 * 60 * 60 * 12);
    this.secureCookie = Boolean(config.secureCookie ?? false);
    this.environment = String(config.environment ?? "development").trim().toLowerCase();
    this.legacySessionCookieName = "bzss_session";

    this.users = new Map();
    this.sessions = new Map();
  }

  async start() {
    if (!this.enabled) {
      this.logger?.warn?.("AuthManager disabled. Web API will not require login.");
      return;
    }

    if (this.environment === "production" && !this.secureCookie) {
      throw new WebSecurityConfigurationError("production auth requires secureCookie=true");
    }

    this.seedConfiguredUsers();
    await this.ensureDefaultSuperAdmin();
    this.logger?.info?.("AuthManager started.");
  }

  async stop() {
    this.sessions.clear();
  }

  async ensureDefaultSuperAdmin() {
    if (this.users.has(DEFAULT_USERNAME)) return;

    this.users.set(DEFAULT_USERNAME, {
      id: "user:superadmin",
      username: DEFAULT_USERNAME,
      passwordHash: DEFAULT_PASSWORD_HASH,
      role: DEFAULT_ROLE,
      steam64: normalizeSteam64(this.config?.defaultSteam64),
      viewerTeamAutoSwapEnabled: this.config?.viewerTeamAutoSwapEnabled !== false,
      permissions: ["*"],
      enabled: true,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  seedConfiguredUsers() {
    const configuredUsers = Array.isArray(this.config?.users) ? this.config.users : [];
    for (const user of configuredUsers) {
      const username = String(user?.username ?? "").trim();
      if (!username || this.users.has(username)) continue;

      this.users.set(username, {
        id: String(user?.id ?? `user:${username}`),
        username,
        passwordHash: String(user?.passwordHash ?? INVALID_PASSWORD_HASH),
        role: String(user?.role ?? DEFAULT_ROLE),
        steam64: normalizeSteam64(user?.steam64 ?? user?.steamID ?? user?.steamId ?? user?.steam64ID ?? user?.steam64Id),
        viewerTeamAutoSwapEnabled: user?.viewerTeamAutoSwapEnabled !== false,
        permissions: normalizePermissions(user?.permissions),
        enabled: user?.enabled !== false,
        createdAt: Number(user?.createdAt ?? Date.now()),
        updatedAt: Number(user?.updatedAt ?? Date.now()),
      });
    }
  }

  async login({ username, password, ip = "" }) {
    if (!this.enabled) {
      return {
        ok: true,
        user: this.safeUser({
          id: "auth-disabled",
          username: "disabled-auth",
          role: DEFAULT_ROLE,
          steam64: "",
          viewerTeamAutoSwapEnabled: false,
        }),
        cookie: "",
      };
    }

    const normalizedUsername = String(username ?? "").trim();
    const rawPassword = String(password ?? "");
    const user = this.users.get(normalizedUsername);

    // 固定做一次 hash 校验，降低用户名枚举的 timing 差异。
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
      username: user.username,
      role: user.role,
      steam64: normalizeSteam64(user.steam64 ?? user.steamID ?? user.steamId ?? user.steam64ID ?? user.steam64Id),
      viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled !== false,
      permissions: normalizePermissions(user.permissions),
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
    return [
      this.makeExpiredCookie(),
      this.makeExpiredCookie(this.legacySessionCookieName),
    ];
  }

  getUserFromRequest(req) {
    if (!this.enabled) {
      return {
        id: "auth-disabled",
        username: "auth-disabled",
        role: DEFAULT_ROLE,
        isSuperAdmin: true,
        steam64: "",
        viewerTeamAutoSwapEnabled: false,
        permissions: ["*"],
      };
    }

    const token = this.getTokenFromRequest(req);
    if (!token) return null;

    const tokenHash = hashToken(token);
    const session = this.sessions.get(tokenHash);
    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(tokenHash);
      return null;
    }

    return {
      id: session.userId,
      username: session.username,
      role: session.role,
      isSuperAdmin: this.isSuperAdminRole(session.role),
      steam64: normalizeSteam64(session.steam64),
      viewerTeamAutoSwapEnabled: session.viewerTeamAutoSwapEnabled !== false,
      permissions: normalizePermissions(session.permissions),
    };
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

    const permissions = normalizePermissions(user.permissions ?? user.permission);

    if (permissions.includes("*")) return true;
    if (permissions.includes(wanted)) return true;

    const [namespace] = wanted.split(".");
    if (namespace && permissions.includes(`${namespace}.*`)) return true;

    return false;
  }

  isSuperAdminRole(role) {
    return String(role ?? "").toLowerCase().includes("superadmin");
  }

  safeUser(user) {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      isSuperAdmin: this.isSuperAdminRole(user.role),
      steam64: normalizeSteam64(user.steam64 ?? user.steamID ?? user.steamId ?? user.steam64ID ?? user.steam64Id),
      viewerTeamAutoSwapEnabled: user.viewerTeamAutoSwapEnabled !== false,
      permissions: normalizePermissions(user.permissions),
    };
  }

  getTokenFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie ?? "");
    return cookies[this.sessionCookieName] ?? cookies[this.legacySessionCookieName] ?? "";
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
    return [
      parts.join("; "),
      this.makeExpiredCookie(this.legacySessionCookieName),
    ];
  }

  makeExpiredCookie(cookieName = this.sessionCookieName) {
    const parts = [
      `${cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Strict",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      "Max-Age=0",
    ];
    if (this.secureCookie) parts.push("Secure");
    return parts.join("; ");
  }
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = await scrypt(password, salt);
  return `scrypt$${salt}$${hash}`;
}

async function verifyPassword(password, encoded) {
  const [kind, salt, expected] = String(encoded ?? "").split("$");
  if (kind !== "scrypt" || !salt || !expected) return false;

  const actual = await scrypt(password, salt);
  return timingSafeEqual(actual, expected);
}

function scrypt(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password), String(salt), 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey.toString("base64url"));
    });
  });
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
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
