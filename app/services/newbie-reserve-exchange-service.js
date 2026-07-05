import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

import { open } from "sqlite";
import sqlite3 from "sqlite3";
import { verifyPassword } from "../core/auth-crypto.js";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 12865;
const DEFAULT_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const DEFAULT_DB_FILE = "data/reserve-exchange/store.sqlite3";
const DEFAULT_CLAIM_LOCK_MINUTES = 10;
const DEFAULT_GROUP = "BZSSVIP";
const SESSION_COOKIE_NAME = "reserve_exchange_session";
const STEAM64_RE = /^7656119\d{10}$/;
const QQ_RE = /^\d{5,12}$/;

const DEFAULT_SETTINGS = {
  enabled: true,
  claimEnabled: true,
  defaultDays: 7,
  randomMinDays: 3,
  randomMaxDays: 60,
  defaultWeight: 50,
  randomWeight: 50,
};

export class NewbieReserveExchangeService {
  constructor({ core, modules, config, logger } = {}) {
    this.core = core ?? {};
    this.modules = modules ?? {};
    this.config = config ?? {};
    this.logger = logger ?? this.core.logger ?? console;
    const reserveConfig = this.getReserveConfig();

    this.enabled = reserveConfig.enabled !== false;
    this.host = String(reserveConfig.host ?? DEFAULT_HOST).trim() || DEFAULT_HOST;
    const configuredPort = Number(reserveConfig.port ?? DEFAULT_PORT);
    this.port = Number.isFinite(configuredPort) ? configuredPort : DEFAULT_PORT;
    this.sessionTtlMs = Math.max(60_000, Number(reserveConfig.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS) || DEFAULT_SESSION_TTL_MS);
    this.databaseFilePath = resolveConfigPath(reserveConfig.databaseFilePath ?? DEFAULT_DB_FILE);
    this.claimLockMinutes = Math.max(1, Number(reserveConfig.claimLockMinutes ?? DEFAULT_CLAIM_LOCK_MINUTES) || DEFAULT_CLAIM_LOCK_MINUTES);
    this.sessionCookieName = String(reserveConfig.sessionCookieName ?? SESSION_COOKIE_NAME).trim() || SESSION_COOKIE_NAME;
    this.secureCookie = Boolean(reserveConfig.secureCookie ?? false);

    this.server = null;
    this.db = null;
    this.sessions = new Map();
    this.baseUrl = "";
  }

  getReserveConfig() {
    if (typeof this.config?.get === "function") {
      return this.config.get("reserveExchange", {}) ?? {};
    }
    return this.config?.reserveExchange ?? {};
  }

  async start() {
    if (!this.enabled) {
      this.logger?.info?.("[ReserveExchange] disabled.");
      return;
    }

    await this.initDatabase();
    await this.ensureSettingsRow();
    await this.reconcileStaleProcessingClaims();

    this.server = http.createServer((req, res) => {
      void this.handleRequest(req, res).catch((error) => {
        const statusCode = error?.statusCode ?? 500;
        if (statusCode >= 500) {
          this.logger?.error?.(`[ReserveExchange] request failed: ${error?.stack ?? error}`);
        } else {
          this.logger?.warn?.(`[ReserveExchange] request rejected: ${statusCode} ${error?.code ?? error?.message ?? error}`);
        }
        this.sendJson(res, statusCode, {
          ok: false,
          error: error?.code ?? "InternalServerError",
          message: error?.message ?? "Internal error.",
        });
      });
    });

    await new Promise((resolve) => {
      this.server.listen(this.port, this.host, resolve);
    });

    const address = this.server.address();
    const actualPort = typeof address === "object" && address ? address.port : this.port;
    this.port = Number(actualPort) || this.port;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.logger?.info?.(`[ReserveExchange] listening on ${this.baseUrl}`);
  }

  async stop() {
    for (const session of this.sessions.values()) {
      session.revoked = true;
    }
    this.sessions.clear();

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
      this.server = null;
    }

    if (this.db) {
      await this.db.exec("PRAGMA wal_checkpoint(TRUNCATE);").catch(() => {});
      await this.db.close().catch(() => {});
      this.db = null;
    }
  }

  async handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === "/" || url.pathname === "/claim") {
      return this.serveHtml(res, renderPublicPage());
    }

    if (url.pathname === "/admin") {
      const user = await this.getSessionUser(req);
      const loginFailed = url.searchParams.get("login") === "failed";
      return this.serveHtml(res, renderAdminPage(user ? await this.buildAdminState(user) : null, { loginFailed }));
    }

    if (url.pathname === "/admin/client.js" && req.method === "GET") {
      return this.serveJavaScript(res, await this.getAdminClientScript());
    }

    if (url.pathname === "/health" || url.pathname === "/api/health") {
      return this.sendJson(res, 200, {
        ok: true,
        service: "Reserve Exchange",
        host: this.host,
        port: this.port,
        enabled: this.enabled,
        databaseFilePath: this.databaseFilePath,
      });
    }

    if (url.pathname === "/api/public/state" && req.method === "GET") {
      return this.sendJson(res, 200, await this.getPublicState());
    }

    if (url.pathname === "/api/public/claim" && req.method === "POST") {
      const body = await this.readJsonBody(req);
      const result = await this.createClaim(body ?? {}, {
        request: req,
        source: "public",
      });
      return this.sendJson(res, result.statusCode, result.body);
    }

    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      const body = await this.readRequestBody(req);
      const isFormPost = String(req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded");
      const result = await this.login({
        username: body?.username,
        password: body?.password,
        ip: this.getRequestIp(req),
      });

      if (!result.ok) {
        if (isFormPost) {
          res.writeHead(303, {
            "Location": "/admin?login=failed",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "strict-origin-when-cross-origin",
          });
          return res.end();
        }
        return this.sendJson(res, 401, result.body);
      }

      if (isFormPost) {
        res.writeHead(303, {
          "Location": "/admin",
          "Set-Cookie": result.cookie,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "X-Frame-Options": "DENY",
          "Referrer-Policy": "strict-origin-when-cross-origin",
        });
        return res.end();
      }

      return this.sendJson(res, 200, result.body, {
        "Set-Cookie": result.cookie,
      });
    }

    if (url.pathname === "/api/auth/logout" && req.method === "POST") {
      const expiredCookie = this.logout(req);
      return this.sendJson(res, 200, {
        ok: true,
        authenticated: false,
      }, {
        "Set-Cookie": expiredCookie,
      });
    }

    if (url.pathname === "/api/auth/session" && req.method === "GET") {
      const user = await this.getSessionUser(req);
      return this.sendJson(res, 200, {
        authenticated: Boolean(user),
        user,
      });
    }

    if (url.pathname === "/api/admin/state" && req.method === "GET") {
      const user = await this.requireSessionUser(req);
      return this.sendJson(res, 200, await this.buildAdminState(user));
    }

    if (url.pathname === "/api/admin/settings" && req.method === "PUT") {
      const user = await this.requireSessionUser(req);
      if (!this.isSuperAdmin(user)) {
        return this.sendJson(res, 403, {
          ok: false,
          error: "Forbidden",
          message: "SuperAdmin permission is required.",
        });
      }

      const body = await this.readJsonBody(req);
      const result = await this.updateSettings(body ?? {}, { actor: user });
      return this.sendJson(res, 200, result);
    }

    if (url.pathname === "/api/admin/claims" && req.method === "GET") {
      const user = await this.requireSessionUser(req);
      return this.sendJson(res, 200, {
        ok: true,
        claims: await this.listClaims({
          limit: Number(url.searchParams.get("limit") ?? 50) || 50,
        }),
        user,
      });
    }

    if (url.pathname === "/api/admin/random-preview" && req.method === "GET") {
      const user = await this.requireSessionUser(req);
      const count = clampNumber(Number(url.searchParams.get("count") ?? 10), 1, 100);
      const settings = await this.readSettings();
      const samples = Array.from({ length: count }, (_, index) => {
        const plan = pickGrantPlan(settings);
        return {
          index: index + 1,
          mode: plan.mode,
          days: plan.days,
        };
      });
      const defaultCount = samples.filter((item) => item.mode === "default").length;
      const randomCount = samples.length - defaultCount;
      const minDays = samples.length > 0 ? Math.min(...samples.map((item) => item.days)) : null;
      const maxDays = samples.length > 0 ? Math.max(...samples.map((item) => item.days)) : null;
      const averageDays = samples.length > 0
        ? Number((samples.reduce((sum, item) => sum + item.days, 0) / samples.length).toFixed(2))
        : null;

      return this.sendJson(res, 200, {
        ok: true,
        user,
        count,
        settings,
        summary: {
          defaultCount,
          randomCount,
          minDays,
          maxDays,
          averageDays,
        },
        samples,
      });
    }

    return this.sendJson(res, 404, {
      ok: false,
      error: "NotFound",
      message: "Route not found.",
    });
  }

  async initDatabase() {
    await fs.mkdir(path.dirname(this.databaseFilePath), { recursive: true });
    this.db = await open({
      filename: this.databaseFilePath,
      driver: sqlite3.Database,
    });

    await this.db.exec("PRAGMA journal_mode = WAL;");
    await this.db.exec("PRAGMA foreign_keys = ON;");
    await this.db.exec("PRAGMA busy_timeout = 5000;");
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS exchange_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL DEFAULT 1,
        claim_enabled INTEGER NOT NULL DEFAULT 1,
        default_days INTEGER NOT NULL DEFAULT 7,
        random_min_days INTEGER NOT NULL DEFAULT 3,
        random_max_days INTEGER NOT NULL DEFAULT 60,
        default_weight INTEGER NOT NULL DEFAULT 50,
        random_weight INTEGER NOT NULL DEFAULT 50,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS exchange_claims (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        qq_number TEXT NOT NULL,
        steam64 TEXT NOT NULL,
        status TEXT NOT NULL,
        requested_days INTEGER,
        selected_mode TEXT,
        selected_days INTEGER,
        expire_at TEXT,
        failure_reason TEXT,
        reserve_group TEXT,
        reserve_name TEXT,
        reserve_result_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        granted_at INTEGER,
        failed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS exchange_audits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        claim_id INTEGER,
        qq_number TEXT,
        steam64 TEXT,
        raw_qq_number TEXT,
        raw_steam64 TEXT,
        status TEXT NOT NULL,
        result_code TEXT NOT NULL,
        result_message TEXT NOT NULL,
        selected_mode TEXT,
        selected_days INTEGER,
        expire_at TEXT,
        source TEXT NOT NULL DEFAULT 'public',
        ip TEXT,
        user_agent TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_claims_qq_active
      ON exchange_claims(qq_number)
      WHERE status IN ('processing', 'granted');

      CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_claims_steam_active
      ON exchange_claims(steam64)
      WHERE status IN ('processing', 'granted');

      CREATE INDEX IF NOT EXISTS idx_exchange_claims_created_at
      ON exchange_claims(created_at DESC);

      CREATE INDEX IF NOT EXISTS idx_exchange_audits_created_at
      ON exchange_audits(created_at DESC);
    `);
  }

  async getAdminClientScript() {
    if (!this.adminClientScript) {
      this.adminClientScript = await fs.readFile(new URL("./newbie-reserve-exchange-admin-client.js", import.meta.url), "utf8");
    }
    return this.adminClientScript;
  }

  async ensureSettingsRow() {
    const row = await this.db.get("SELECT id FROM exchange_settings WHERE id = 1");
    if (row) return;
    const now = Date.now();
    await this.db.run(
      `INSERT INTO exchange_settings (
        id, enabled, claim_enabled, default_days, random_min_days, random_max_days, default_weight, random_weight, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      1,
      DEFAULT_SETTINGS.enabled ? 1 : 0,
      DEFAULT_SETTINGS.claimEnabled ? 1 : 0,
      DEFAULT_SETTINGS.defaultDays,
      DEFAULT_SETTINGS.randomMinDays,
      DEFAULT_SETTINGS.randomMaxDays,
      DEFAULT_SETTINGS.defaultWeight,
      DEFAULT_SETTINGS.randomWeight,
      now,
    );
  }

  async readSettings() {
    const row = await this.db.get("SELECT * FROM exchange_settings WHERE id = 1");
    return normalizeSettingsRow(row);
  }

  async updateSettings(input = {}, { actor = null } = {}) {
    const current = await this.readSettings();
    const next = normalizeSettingsInput(input, current);
    const now = Date.now();
    await this.db.run(
      `UPDATE exchange_settings
       SET enabled = ?,
           claim_enabled = ?,
           default_days = ?,
           random_min_days = ?,
           random_max_days = ?,
           default_weight = ?,
           random_weight = ?,
           updated_at = ?
       WHERE id = 1`,
      next.enabled ? 1 : 0,
      next.claimEnabled ? 1 : 0,
      next.defaultDays,
      next.randomMinDays,
      next.randomMaxDays,
      next.defaultWeight,
      next.randomWeight,
      now,
    );

    this.logReserveEvent("info", `settings updated by ${actor?.username ?? "system"}`, {
      actor: actor?.username ?? "system",
      enabled: next.enabled,
      claimEnabled: next.claimEnabled,
      defaultDays: next.defaultDays,
      randomMinDays: next.randomMinDays,
      randomMaxDays: next.randomMaxDays,
      defaultWeight: next.defaultWeight,
      randomWeight: next.randomWeight,
    }, "settings");
    return {
      ok: true,
      settings: next,
    };
  }

  async getPublicState() {
    const settings = await this.readSettings();
    const summary = await this.buildSummary();
    return {
      ok: true,
      service: {
        enabled: this.enabled,
        host: this.host,
        port: this.port,
      },
      settings: {
        enabled: settings.enabled,
        claimEnabled: settings.claimEnabled,
        defaultDays: settings.defaultDays,
        randomMinDays: settings.randomMinDays,
        randomMaxDays: settings.randomMaxDays,
        defaultWeight: settings.defaultWeight,
        randomWeight: settings.randomWeight,
      },
      summary: {
        ...summary,
        enabled: settings.enabled,
      },
    };
  }

  async buildAdminState(user) {
    const settings = await this.readSettings();
    const summary = await this.buildSummary();
    const recentClaims = await this.listClaims({ limit: 50 });
    const recentAudits = await this.listAudits({ limit: 50 });
    return {
      ok: true,
      authenticated: true,
      canManage: this.isSuperAdmin(user),
      user,
      settings,
      summary,
      claims: recentClaims,
      audits: recentAudits,
    };
  }

  async buildSummary() {
    const [claims, audits] = await Promise.all([
      this.db.get("SELECT COUNT(*) AS value FROM exchange_claims"),
      this.db.get("SELECT COUNT(*) AS value FROM exchange_audits"),
    ]);
    const active = await this.db.get("SELECT COUNT(*) AS value FROM exchange_claims WHERE status IN ('processing', 'granted')");
    const granted = await this.db.get("SELECT COUNT(*) AS value FROM exchange_claims WHERE status = 'granted'");
    const failed = await this.db.get("SELECT COUNT(*) AS value FROM exchange_claims WHERE status = 'failed'");
    return {
      claimCount: Number(claims?.value ?? 0),
      auditCount: Number(audits?.value ?? 0),
      activeCount: Number(active?.value ?? 0),
      grantedCount: Number(granted?.value ?? 0),
      failedCount: Number(failed?.value ?? 0),
    };
  }

  async listClaims({ limit = 50 } = {}) {
    const rows = await this.db.all(
      `SELECT *
       FROM exchange_claims
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      clampNumber(limit, 1, 500),
    );
    return rows.map(normalizeClaimRow);
  }

  async listAudits({ limit = 50 } = {}) {
    const rows = await this.db.all(
      `SELECT *
       FROM exchange_audits
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      clampNumber(limit, 1, 500),
    );
    return rows.map(normalizeAuditRow);
  }

  async login({ username, password, ip = "" }) {
    if (!this.core?.authManager?.userStore) {
      return {
        ok: false,
        body: {
          ok: false,
          error: "AuthUnavailable",
          message: "Authentication service is unavailable.",
        },
      };
    }

    this.core.authManager.userStore.refreshFromDiskIfChangedSync?.();
    const normalizedUsername = String(username ?? "").trim();
    const rawPassword = String(password ?? "");
    const user = this.core.authManager.userStore.findByUsername(normalizedUsername);
    const passwordHash = user?.passwordHash ?? "";
    const passwordOk = await verifyPassword(rawPassword, passwordHash);

    if (!user || !user.enabled || !passwordOk) {
      this.logReserveEvent("warn", `login failed username=${normalizedUsername || "<empty>"} ip=${ip}`, {
        username: normalizedUsername || null,
        ip,
        result: "invalid_credentials",
      }, "auth");
      return {
        ok: false,
        body: {
          ok: false,
          error: "InvalidCredentials",
          message: "Invalid username or password.",
        },
      };
    }

    this.logReserveEvent("info", `login success username=${normalizedUsername} ip=${ip}`, {
      username: normalizedUsername,
      ip,
      userId: user.id,
      role: user.role,
    }, "auth");

    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const now = Date.now();
    const expiresAt = now + this.sessionTtlMs;

    this.sessions.set(tokenHash, {
      tokenHash,
      userId: user.id,
      authVersion: Number(user.authVersion ?? 1),
      expiresAt,
      createdAt: now,
      revoked: false,
      ip,
    });

    return {
      ok: true,
      cookie: this.makeSessionCookie(token, expiresAt),
      body: {
        ok: true,
        authenticated: true,
        user: this.safeUser(user),
        sessionExpiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }

  logout(req) {
    const token = this.getTokenFromRequest(req);
    if (token) {
      this.sessions.delete(hashToken(token));
    }
    return `${this.sessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0`;
  }

  async getSessionUser(req) {
    if (!this.core?.authManager?.userStore) return null;
    this.core.authManager.userStore.refreshFromDiskIfChangedSync?.();

    const token = this.getTokenFromRequest(req);
    if (!token) return null;

    const session = this.sessions.get(hashToken(token));
    if (!session || session.revoked || session.expiresAt <= Date.now()) {
      this.sessions.delete(hashToken(token));
      return null;
    }

    const user = this.core.authManager.userStore.getUserById(session.userId);
    if (!user || !user.enabled || Number(user.authVersion ?? 1) !== Number(session.authVersion ?? 0)) {
      this.sessions.delete(hashToken(token));
      return null;
    }

    return this.safeUser(user);
  }

  async requireSessionUser(req) {
    const user = await this.getSessionUser(req);
    if (!user) {
      throw createHttpError(401, "Unauthorized", "Authentication required.");
    }
    return user;
  }

  isSuperAdmin(user) {
    return Boolean(user?.isSuperAdmin || user?.role === "SuperAdmin");
  }

  safeUser(user) {
    if (typeof this.core?.authManager?.safeUser === "function") {
      return this.core.authManager.safeUser(user);
    }

    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName ?? "",
      role: user.role,
      isSuperAdmin: this.isSuperAdmin(user),
      steam64: String(user.steam64 ?? "").trim() || null,
      permissions: Array.isArray(user.permissions) ? [...user.permissions] : [],
    };
  }

  async createClaim(input = {}, { request = null, source = "public" } = {}) {
    if (!this.enabled) {
      return {
        statusCode: 503,
        body: {
          ok: false,
          error: "ServiceDisabled",
          message: "Reserve exchange service is disabled.",
        },
      };
    }

    const settings = await this.readSettings();
    if (!settings.enabled) {
      return {
        statusCode: 503,
        body: {
          ok: false,
          error: "ExchangeDisabled",
          message: "Reserve exchange is disabled.",
        },
      };
    }
    if (!settings.claimEnabled) {
      return {
        statusCode: 403,
        body: {
          ok: false,
          error: "ClaimDisabled",
          message: "Exchange is currently closed.",
        },
      };
    }

    const rawQQ = String(input?.qq_number ?? input?.qq ?? input?.qqNumber ?? "").trim();
    const rawSteam64 = String(input?.steam64 ?? input?.steamID ?? input?.steamId ?? input?.steam64ID ?? "").trim();
    const qqNumber = normalizeQQ(rawQQ);
    const steam64 = normalizeSteam64(rawSteam64);
    const ip = this.getRequestIp(request);
    const userAgent = String(request?.headers?.["user-agent"] ?? "").trim();
    const requestSummary = {
      source,
      ip,
      qqNumber: qqNumber || null,
      steam64: steam64 || null,
      rawQQ,
      rawSteam64,
      userAgent: userAgent || null,
    };

    this.logReserveEvent("info", "claim request received", requestSummary);

    if (!qqNumber || !steam64) {
      this.logReserveEvent("warn", "claim request rejected: invalid input", {
        ...requestSummary,
        reason: "validation_failed",
      });
      const auditId = await this.insertAudit({
        claimId: null,
        qqNumber: qqNumber ?? null,
        steam64: steam64 ?? null,
        rawQQ,
        rawSteam64,
        status: "failed",
        resultCode: "invalid_input",
        resultMessage: "QQ number or Steam64 is invalid.",
        source,
        selectedMode: null,
        selectedDays: null,
        expireAt: null,
        metadata: {
          reason: "validation_failed",
        },
        request,
      });

      return {
        statusCode: 400,
        body: {
          ok: false,
          error: "InvalidInput",
          message: "Invalid QQ number or Steam64 format.",
          auditId,
        },
      };
    }

    await this.reconcileStaleProcessingClaims();

    const activeClaim = await this.findActiveClaimByKey({ qqNumber, steam64 });
    if (activeClaim) {
      this.logReserveEvent("warn", `claim request rejected: already redeemed claimId=${activeClaim.id}`, {
        ...requestSummary,
        claimId: activeClaim.id,
        status: activeClaim.status,
        selectedMode: activeClaim.selected_mode ?? null,
        selectedDays: activeClaim.selected_days ?? null,
        expireAt: activeClaim.expire_at ?? null,
      });
      const auditId = await this.insertAudit({
        claimId: activeClaim.id,
        qqNumber,
        steam64,
        rawQQ,
        rawSteam64,
        status: "failed",
        resultCode: "already_redeemed",
        resultMessage: "QQ or Steam64 is already redeemed.",
        source,
        selectedMode: activeClaim.selected_mode ?? null,
        selectedDays: activeClaim.selected_days ?? null,
        expireAt: activeClaim.expire_at ?? null,
        metadata: {
          activeClaimId: activeClaim.id,
          activeStatus: activeClaim.status,
        },
        request,
      });

      return {
        statusCode: 409,
        body: {
          ok: false,
          error: "AlreadyRedeemed",
          message: "This QQ number or Steam64 has already been redeemed.",
          alreadyRedeemed: true,
          claim: normalizeClaimRow(activeClaim),
          auditId,
        },
      };
    }

    const currentReserveMember = await this.findActiveReserveMember(steam64);
    if (currentReserveMember) {
      this.logReserveEvent("info", `claim request found existing reserve slot steam64=${steam64}`, {
        ...requestSummary,
        reserveName: currentReserveMember.name ?? "",
        reserveGroup: currentReserveMember.group ?? "",
        expireAt: currentReserveMember.expireAt ?? null,
      });
    }

    const grantPlan = pickGrantPlan(settings);
    this.logReserveEvent("info", `claim queued claimMode=${grantPlan.mode} days=${grantPlan.days}`, {
      ...requestSummary,
      selectedMode: grantPlan.mode,
      requestedDays: grantPlan.days,
    });
    let attempt;
    try {
      attempt = await this.insertClaim({
        qqNumber,
        steam64,
        status: "processing",
        requestedDays: grantPlan.days,
        selectedMode: grantPlan.mode,
        source,
      });
    } catch (error) {
      if (isSqliteConstraintError(error)) {
        const raceClaim = await this.findActiveClaimByKey({ qqNumber, steam64 });
        const auditId = await this.insertAudit({
          claimId: raceClaim?.id ?? null,
          qqNumber,
          steam64,
          rawQQ,
          rawSteam64,
          status: "failed",
          resultCode: "already_redeemed",
          resultMessage: "QQ or Steam64 is already redeemed.",
          source,
          selectedMode: raceClaim?.selected_mode ?? grantPlan.mode,
          selectedDays: raceClaim?.selected_days ?? grantPlan.days,
          expireAt: raceClaim?.expire_at ?? null,
          metadata: {
            race: true,
            activeClaimId: raceClaim?.id ?? null,
          },
          request,
        });

        return {
          statusCode: 409,
        body: {
          ok: false,
          error: "AlreadyRedeemed",
          message: "This QQ number or Steam64 has already been redeemed.",
          alreadyRedeemed: true,
          claim: raceClaim ? normalizeClaimRow(raceClaim) : null,
          auditId,
          },
        };
      }
      throw error;
    }

    const auditId = await this.insertAudit({
      claimId: attempt.id,
      qqNumber,
      steam64,
      rawQQ,
      rawSteam64,
      status: "processing",
      resultCode: "processing",
      resultMessage: "Claim processing started.",
      source,
      selectedMode: grantPlan.mode,
      selectedDays: grantPlan.days,
      expireAt: null,
      metadata: {
        claimId: attempt.id,
      },
      request,
    });
    this.logReserveEvent("info", `claim processing started claimId=${attempt.id}`, {
      ...requestSummary,
      claimId: attempt.id,
      auditId,
      selectedMode: grantPlan.mode,
      selectedDays: grantPlan.days,
    });

    const reserveName = await this.resolveReserveName(steam64, qqNumber);
    try {
      const reserveSlots = this.modules?.reserveSlots;
      if (!reserveSlots?.upsertMember) {
        this.logReserveEvent("error", `claim grant failed: reserveSlots unavailable claimId=${attempt.id}`, {
          ...requestSummary,
          claimId: attempt.id,
          auditId,
        });
        throw createHttpError(503, "ReserveSlotsUnavailable", "Reserve slots module is unavailable.");
      }

      this.logReserveEvent("info", `claim grant dispatch claimId=${attempt.id} group=${DEFAULT_GROUP} days=${grantPlan.days}`, {
        ...requestSummary,
        claimId: attempt.id,
        auditId,
        group: DEFAULT_GROUP,
        days: grantPlan.days,
      });
      const reserveResult = await reserveSlots.upsertMember({
        steamId: steam64,
        group: DEFAULT_GROUP,
        durationDays: grantPlan.days,
        name: reserveName,
        reason: "newbie_reserve_exchange",
      });

      await this.bindReserveQQToPlayer(steam64, qqNumber, reserveName);

      const expireAt = String(reserveResult?.savedMember?.expireAt ?? reserveResult?.members?.find?.((item) => item.steamId === steam64)?.expireAt ?? "").trim() || null;
      await this.updateClaim(attempt.id, {
        status: "granted",
        selectedDays: grantPlan.days,
        expireAt,
        failureReason: "",
        reserveGroup: DEFAULT_GROUP,
        reserveName,
        reserveResult: reserveResult ?? {},
        grantedAt: Date.now(),
      });
      this.logReserveEvent("info", `claim granted claimId=${attempt.id} expireAt=${expireAt || "<unknown>"}`, {
        ...requestSummary,
        claimId: attempt.id,
        auditId,
        selectedMode: grantPlan.mode,
        selectedDays: grantPlan.days,
        expireAt,
        reserveGroup: DEFAULT_GROUP,
      });
      await this.updateAudit(auditId, {
        status: "granted",
        resultCode: "success",
        resultMessage: "Reserve slot granted successfully.",
        expireAt,
        selectedDays: grantPlan.days,
        metadata: {
          claimId: attempt.id,
          reserveGroup: DEFAULT_GROUP,
          reserveName,
        },
      });

      return {
        statusCode: 200,
        body: {
          ok: true,
          status: "granted",
          claimId: attempt.id,
          auditId,
          qqNumber,
          steam64,
          grantMode: grantPlan.mode,
          grantedDays: grantPlan.days,
          expireAt,
          alreadyRedeemed: false,
        },
      };
    } catch (error) {
      const failureReason = error?.message ?? "Failed to grant reserve slot.";
      this.logReserveEvent("error", `claim grant failed claimId=${attempt.id} reason=${failureReason}`, {
        ...requestSummary,
        claimId: attempt.id,
        auditId,
        errorCode: error?.code ?? null,
        selectedMode: grantPlan.mode,
        selectedDays: grantPlan.days,
      });
      await this.updateClaim(attempt.id, {
        status: "failed",
        selectedDays: grantPlan.days,
        expireAt: null,
        failureReason,
        reserveGroup: DEFAULT_GROUP,
        reserveName,
        reserveResult: {
          error: error?.code ?? "GrantFailed",
          message: failureReason,
        },
        failedAt: Date.now(),
      });
      await this.updateAudit(auditId, {
        status: "failed",
        resultCode: error?.code ?? "grant_failed",
        resultMessage: failureReason,
        expireAt: null,
        selectedDays: grantPlan.days,
        metadata: {
          claimId: attempt.id,
          errorCode: error?.code ?? null,
        },
      });

      return {
        statusCode: error?.statusCode ?? 500,
        body: {
          ok: false,
          error: error?.code ?? "GrantFailed",
          message: failureReason,
          claimId: attempt.id,
          auditId,
        },
      };
    }
  }

  async resolveReserveName(steam64, fallbackQQ = "") {
    const trimmedSteam64 = String(steam64 ?? "").trim();
    const playerDatabase = this.modules?.playerDatabase;
    if (trimmedSteam64 && playerDatabase?.findByIdentity) {
      try {
        const player = await playerDatabase.findByIdentity({ steamID: trimmedSteam64 });
        const candidate = String(player?.name ?? player?.displayName ?? player?.nickname ?? "").trim();
        if (candidate) {
          return candidate;
        }
      } catch (error) {
        this.logReserveEvent("warn", `resolve reserve name from player database failed steam64=${trimmedSteam64}`, {
          steam64: trimmedSteam64,
          error: error?.message ?? String(error),
        }, "claim");
      }
    }

    return trimmedSteam64 || `QQ:${String(fallbackQQ ?? "").trim()}`;
  }

  async bindReserveQQToPlayer(steam64, qqNumber, qqName) {
    const playerDatabase = this.modules?.playerDatabase;
    if (!playerDatabase?.findByIdentity || !playerDatabase?.bindQQToPlayer) {
      this.logReserveEvent("warn", `player database unavailable for QQ bind steam64=${steam64}`, {
        steam64,
        qqNumber,
        qqName,
      }, "claim");
      return null;
    }

    const player = await playerDatabase.findByIdentity({ steamID: steam64 });
    if (!player?.id) {
      this.logReserveEvent("warn", `player not found for QQ bind steam64=${steam64}`, {
        steam64,
        qqNumber,
        qqName,
      }, "claim");
      return null;
    }

    if (player.qq_number && String(player.qq_number).trim() !== String(qqNumber).trim()) {
      this.logReserveEvent("warn", `player already bound to another QQ steam64=${steam64}`, {
        steam64,
        playerId: player.id,
        existingQQ: String(player.qq_number).trim(),
        incomingQQ: String(qqNumber).trim(),
      }, "claim");
      return null;
    }

    const updated = await playerDatabase.bindQQToPlayer(player.id, {
      qqNumber,
      qqName,
    });
    this.logReserveEvent("info", `player QQ bound by reserve exchange steam64=${steam64}`, {
      steam64,
      playerId: player.id,
      qqNumber,
      qqName,
    }, "claim");
    return updated;
  }

  async insertClaim({
    qqNumber,
    steam64,
    status,
    requestedDays,
    selectedMode,
    source = "public",
  }) {
    const now = Date.now();
    const result = await this.db.run(
      `INSERT INTO exchange_claims (
        qq_number, steam64, status, requested_days, selected_mode, selected_days, expire_at,
        failure_reason, reserve_group, reserve_name, reserve_result_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      qqNumber,
      steam64,
      status,
      Number.isFinite(Number(requestedDays)) ? Number(requestedDays) : null,
      selectedMode ?? null,
      status === "processing" ? Number(requestedDays) : null,
      null,
      null,
      null,
      null,
      "{}",
      now,
      now,
    );

    return {
      id: Number(result.lastID),
      qq_number: qqNumber,
      steam64,
      status,
      requested_days: Number.isFinite(Number(requestedDays)) ? Number(requestedDays) : null,
      selected_mode: selectedMode ?? null,
      created_at: now,
      updated_at: now,
      source,
    };
  }

  async updateClaim(claimId, changes = {}) {
    const current = await this.db.get("SELECT * FROM exchange_claims WHERE id = ?", claimId);
    if (!current) return null;

    const next = {
      ...current,
      status: changes.status ?? current.status,
      selected_days: changes.selectedDays === undefined ? current.selected_days : changes.selectedDays,
      expire_at: changes.expireAt === undefined ? current.expire_at : changes.expireAt,
      failure_reason: changes.failureReason === undefined ? current.failure_reason : changes.failureReason,
      reserve_group: changes.reserveGroup === undefined ? current.reserve_group : changes.reserveGroup,
      reserve_name: changes.reserveName === undefined ? current.reserve_name : changes.reserveName,
      reserve_result_json: changes.reserveResult === undefined ? current.reserve_result_json : JSON.stringify(changes.reserveResult ?? {}),
      updated_at: Date.now(),
      granted_at: changes.grantedAt === undefined ? current.granted_at : changes.grantedAt,
      failed_at: changes.failedAt === undefined ? current.failed_at : changes.failedAt,
    };

    await this.db.run(
      `UPDATE exchange_claims
       SET status = ?,
           selected_days = ?,
           expire_at = ?,
           failure_reason = ?,
           reserve_group = ?,
           reserve_name = ?,
           reserve_result_json = ?,
           updated_at = ?,
           granted_at = ?,
           failed_at = ?
       WHERE id = ?`,
      next.status,
      next.selected_days ?? null,
      next.expire_at ?? null,
      next.failure_reason ?? null,
      next.reserve_group ?? null,
      next.reserve_name ?? null,
      next.reserve_result_json ?? "{}",
      next.updated_at,
      next.granted_at ?? null,
      next.failed_at ?? null,
      claimId,
    );

    return next;
  }

  async insertAudit({
    claimId,
    qqNumber,
    steam64,
    rawQQ,
    rawSteam64,
    status,
    resultCode,
    resultMessage,
    selectedMode,
    selectedDays,
    expireAt,
    source = "public",
    metadata = {},
    request = null,
  }) {
    const now = Date.now();
    const result = await this.db.run(
      `INSERT INTO exchange_audits (
        claim_id, qq_number, steam64, raw_qq_number, raw_steam64, status,
        result_code, result_message, selected_mode, selected_days, expire_at,
        source, ip, user_agent, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      claimId ?? null,
      qqNumber ?? null,
      steam64 ?? null,
      rawQQ ?? null,
      rawSteam64 ?? null,
      status,
      resultCode,
      resultMessage,
      selectedMode ?? null,
      selectedDays ?? null,
      expireAt ?? null,
      source,
      this.getRequestIp(request),
      String(request?.headers?.["user-agent"] ?? "").trim(),
      JSON.stringify(metadata ?? {}),
      now,
      now,
    );

    return Number(result.lastID);
  }

  async updateAudit(auditId, changes = {}) {
    const current = await this.db.get("SELECT * FROM exchange_audits WHERE id = ?", auditId);
    if (!current) return null;
    const next = {
      ...current,
      status: changes.status ?? current.status,
      result_code: changes.resultCode ?? current.result_code,
      result_message: changes.resultMessage ?? current.result_message,
      selected_mode: changes.selectedMode === undefined ? current.selected_mode : changes.selectedMode,
      selected_days: changes.selectedDays === undefined ? current.selected_days : changes.selectedDays,
      expire_at: changes.expireAt === undefined ? current.expire_at : changes.expireAt,
      metadata_json: changes.metadata === undefined ? current.metadata_json : JSON.stringify(changes.metadata ?? {}),
      updated_at: Date.now(),
    };

    await this.db.run(
      `UPDATE exchange_audits
       SET status = ?,
           result_code = ?,
           result_message = ?,
           selected_mode = ?,
           selected_days = ?,
           expire_at = ?,
           metadata_json = ?,
           updated_at = ?
       WHERE id = ?`,
      next.status,
      next.result_code,
      next.result_message,
      next.selected_mode ?? null,
      next.selected_days ?? null,
      next.expire_at ?? null,
      next.metadata_json ?? "{}",
      next.updated_at,
      auditId,
    );
    return next;
  }

  async findActiveClaimByKey({ qqNumber, steam64 }) {
    return this.db.get(
      `SELECT *
       FROM exchange_claims
       WHERE status IN ('processing', 'granted')
         AND (qq_number = ? OR steam64 = ?)
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
      qqNumber,
      steam64,
    );
  }

  async findActiveReserveMember(steam64) {
    const reserveSlots = this.modules?.reserveSlots;
    if (!reserveSlots?.getState) return null;
    const state = await reserveSlots.getState();
    const members = Array.isArray(state?.members) ? state.members : [];
    return members.find((member) => String(member?.steamId ?? "").trim() === steam64 && member?.isExpired !== true) ?? null;
  }

  async reconcileStaleProcessingClaims() {
    const staleThreshold = Date.now() - (this.claimLockMinutes * 60_000);
    const rows = await this.db.all(
      `SELECT *
       FROM exchange_claims
       WHERE status = 'processing'
         AND created_at <= ?
       ORDER BY created_at ASC`,
      staleThreshold,
    );

    if (!rows.length) return;
    this.logReserveEvent("info", `reconcile stale claims count=${rows.length}`, {
      count: rows.length,
      staleThreshold,
    });

    const reserveSlots = this.modules?.reserveSlots;
    const reserveState = reserveSlots?.getState ? await reserveSlots.getState() : null;
    const members = Array.isArray(reserveState?.members) ? reserveState.members : [];

    for (const row of rows) {
      const existing = members.find((member) => String(member?.steamId ?? "").trim() === String(row.steam64 ?? "").trim() && member?.isExpired !== true) ?? null;
      if (existing) {
        this.logReserveEvent("warn", `reconcile stale claim recovered as granted claimId=${row.id} steam64=${row.steam64}`, {
          claimId: row.id,
          steam64: row.steam64,
          selectedDays: row.selected_days ?? null,
          reserveGroup: existing.group ?? DEFAULT_GROUP,
          expireAt: existing.expireAt ?? null,
        });
        await this.updateClaim(row.id, {
          status: "granted",
          expireAt: existing.expireAt ?? null,
          selectedDays: row.selected_days ?? null,
          reserveGroup: existing.group ?? DEFAULT_GROUP,
          reserveName: existing.name ?? row.reserve_name ?? "",
          reserveResult: safeJsonParse(row.reserve_result_json, {}),
          grantedAt: Date.now(),
        });
        continue;
      }

      this.logReserveEvent("warn", `reconcile stale claim timed out claimId=${row.id} steam64=${row.steam64}`, {
        claimId: row.id,
        steam64: row.steam64,
        selectedDays: row.selected_days ?? null,
        reserveGroup: row.reserve_group ?? null,
      });
      await this.updateClaim(row.id, {
        status: "failed",
        failureReason: "processing_timeout",
        reserveResult: {
          ...(safeJsonParse(row.reserve_result_json, {})),
          recovered: true,
          reason: "stale_processing_timeout",
        },
        failedAt: Date.now(),
      });
    }
  }

  logReserveEvent(level, message, data = {}, operation = "claim") {
    const fn = this.logger?.[level];
    if (typeof fn !== "function") return;

    fn.call(this.logger, `[ReserveExchange] ${message}`, {
      moduleId: "core.reserveExchange",
      source: "core.reserveExchange",
      channel: "service",
      operation,
      data,
    });
  }

  getRequestIp(req) {
    return String(req?.socket?.remoteAddress ?? "").trim() || "127.0.0.1";
  }

  getTokenFromRequest(req) {
    const cookies = parseCookies(req?.headers?.cookie ?? "");
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

  async readJsonBody(req) {
    const text = await this.readTextBody(req);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw createHttpError(400, "InvalidJson", "Request body must be valid JSON.");
    }
  }

  async readRequestBody(req) {
    const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
    const text = await this.readTextBody(req);
    if (!text) return {};

    if (contentType.includes("application/json")) {
      try {
        return JSON.parse(text);
      } catch {
        throw createHttpError(400, "InvalidJson", "Request body must be valid JSON.");
      }
    }

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(text);
      const body = {};
      for (const [key, value] of params.entries()) {
        body[key] = value;
      }
      return body;
    }

    return {};
  }

  async readTextBody(req) {
    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 1024 * 1024) {
        throw createHttpError(413, "RequestBodyTooLarge", "Request body too large.");
      }
      chunks.push(buf);
    }
    return Buffer.concat(chunks).toString("utf8");
  }

  sendJson(res, status, body, extraHeaders = {}) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self';",
      ...extraHeaders,
    });
    res.end(payload);
  }

  serveJavaScript(res, script) {
    res.writeHead(200, {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    });
    res.end(script);
  }

  serveHtml(res, html) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self';",
    });
    res.end(html);
  }
}

export function pickGrantPlan(settings = {}, randomFn = Math.random) {
  const normalized = normalizeSettingsInput(settings, DEFAULT_SETTINGS);
  const defaultWeight = Math.max(0, Number(normalized.defaultWeight ?? 0) || 0);
  const randomWeight = Math.max(0, Number(normalized.randomWeight ?? 0) || 0);
  const totalWeight = defaultWeight + randomWeight;
  const roll = totalWeight > 0 ? randomFn() * totalWeight : 0;
  const useRandom = totalWeight > 0 && randomWeight > 0 && roll >= defaultWeight;

  if (!useRandom) {
    return {
      mode: "default",
      days: clampNumber(normalized.defaultDays, 1, 3650),
    };
  }

  const minDays = Math.min(normalized.randomMinDays, normalized.randomMaxDays);
  const maxDays = Math.max(normalized.randomMinDays, normalized.randomMaxDays);
  const span = maxDays - minDays + 1;
  const offset = Math.floor(clampNumber(randomFn(), 0, 0.999999999) * span);
  return {
    mode: "random",
    days: clampNumber(minDays + offset, 1, 3650),
  };
}

function normalizeSettingsRow(row = {}) {
  const base = normalizeSettingsInput(row, DEFAULT_SETTINGS);
  return {
    enabled: toBoolean(row?.enabled, base.enabled),
    claimEnabled: toBoolean(row?.claim_enabled, base.claimEnabled),
    defaultDays: clampNumber(Number(row?.default_days ?? base.defaultDays ?? DEFAULT_SETTINGS.defaultDays), 1, 3650),
    randomMinDays: clampNumber(Number(row?.random_min_days ?? base.randomMinDays ?? DEFAULT_SETTINGS.randomMinDays), 1, 3650),
    randomMaxDays: clampNumber(Number(row?.random_max_days ?? base.randomMaxDays ?? DEFAULT_SETTINGS.randomMaxDays), 1, 3650),
    defaultWeight: clampNumber(Number(row?.default_weight ?? base.defaultWeight ?? DEFAULT_SETTINGS.defaultWeight), 0, 100000),
    randomWeight: clampNumber(Number(row?.random_weight ?? base.randomWeight ?? DEFAULT_SETTINGS.randomWeight), 0, 100000),
    updatedAt: Number(row?.updated_at ?? Date.now()),
  };
}

function normalizeSettingsInput(input = {}, fallback = DEFAULT_SETTINGS) {
  const defaultDays = clampNumber(Number(input?.defaultDays ?? input?.default_days ?? fallback.defaultDays ?? DEFAULT_SETTINGS.defaultDays), 1, 3650);
  const randomMinDays = clampNumber(Number(input?.randomMinDays ?? input?.random_min_days ?? fallback.randomMinDays ?? DEFAULT_SETTINGS.randomMinDays), 1, 3650);
  const randomMaxDays = clampNumber(Number(input?.randomMaxDays ?? input?.random_max_days ?? fallback.randomMaxDays ?? DEFAULT_SETTINGS.randomMaxDays), 1, 3650);
  const minDays = Math.min(randomMinDays, randomMaxDays);
  const maxDays = Math.max(randomMinDays, randomMaxDays);

  return {
    enabled: toBoolean(input?.enabled, fallback.enabled),
    claimEnabled: toBoolean(input?.claimEnabled ?? input?.claim_enabled, fallback.claimEnabled),
    defaultDays,
    randomMinDays: minDays,
    randomMaxDays: maxDays,
    defaultWeight: clampNumber(Number(input?.defaultWeight ?? input?.default_weight ?? fallback.defaultWeight ?? DEFAULT_SETTINGS.defaultWeight), 0, 100000),
    randomWeight: clampNumber(Number(input?.randomWeight ?? input?.random_weight ?? fallback.randomWeight ?? DEFAULT_SETTINGS.randomWeight), 0, 100000),
  };
}

function normalizeClaimRow(row = {}) {
  return {
    id: Number(row?.id ?? 0),
    qqNumber: String(row?.qq_number ?? "").trim(),
    steam64: String(row?.steam64 ?? "").trim(),
    status: String(row?.status ?? "").trim(),
    requestedDays: row?.requested_days == null ? null : Number(row.requested_days),
    selectedMode: String(row?.selected_mode ?? "").trim() || null,
    selectedDays: row?.selected_days == null ? null : Number(row.selected_days),
    expireAt: String(row?.expire_at ?? "").trim() || null,
    failureReason: String(row?.failure_reason ?? "").trim() || null,
    reserveGroup: String(row?.reserve_group ?? "").trim() || null,
    reserveName: String(row?.reserve_name ?? "").trim() || null,
    reserveResult: safeJsonParse(row?.reserve_result_json, {}),
    createdAt: Number(row?.created_at ?? 0),
    updatedAt: Number(row?.updated_at ?? 0),
    grantedAt: row?.granted_at == null ? null : Number(row.granted_at),
    failedAt: row?.failed_at == null ? null : Number(row.failed_at),
  };
}

function normalizeAuditRow(row = {}) {
  return {
    id: Number(row?.id ?? 0),
    claimId: row?.claim_id == null ? null : Number(row.claim_id),
    qqNumber: String(row?.qq_number ?? "").trim() || null,
    steam64: String(row?.steam64 ?? "").trim() || null,
    rawQQNumber: String(row?.raw_qq_number ?? "").trim() || null,
    rawSteam64: String(row?.raw_steam64 ?? "").trim() || null,
    status: String(row?.status ?? "").trim(),
    resultCode: String(row?.result_code ?? "").trim(),
    resultMessage: String(row?.result_message ?? "").trim(),
    selectedMode: String(row?.selected_mode ?? "").trim() || null,
    selectedDays: row?.selected_days == null ? null : Number(row.selected_days),
    expireAt: String(row?.expire_at ?? "").trim() || null,
    source: String(row?.source ?? "").trim(),
    ip: String(row?.ip ?? "").trim() || null,
    userAgent: String(row?.user_agent ?? "").trim() || null,
    metadata: safeJsonParse(row?.metadata_json, {}),
    createdAt: Number(row?.created_at ?? 0),
    updatedAt: Number(row?.updated_at ?? 0),
  };
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function toBoolean(value, fallback = false) {
  if (value === null || value === undefined || value === "") return Boolean(fallback);
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (text === "1" || text === "true" || text === "yes" || text === "on") return true;
  if (text === "0" || text === "false" || text === "no" || text === "off") return false;
  return Boolean(fallback);
}

function normalizeSteam64(value) {
  const text = String(value ?? "").trim();
  return STEAM64_RE.test(text) ? text : "";
}

function normalizeQQ(value) {
  const text = String(value ?? "").trim();
  return QQ_RE.test(text) ? text : "";
}

function parseCookies(cookieHeader) {
  const result = {};
  for (const part of String(cookieHeader ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    result[key] = decodeURIComponent(value);
  }
  return result;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64url");
}

function resolveConfigPath(value) {
  const text = String(value ?? "").trim();
  if (!text) return path.resolve(process.cwd(), DEFAULT_DB_FILE);
  return path.isAbsolute(text) ? text : path.resolve(process.cwd(), text);
}

function safeJsonParse(text, fallback = {}) {
  try {
    if (text == null || text === "") return fallback;
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function isSqliteConstraintError(error) {
  return error?.code === "SQLITE_CONSTRAINT" || /constraint/i.test(String(error?.message ?? ""));
}

function createHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function renderPublicPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>新人预留位兑换</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b1020;
      --panel: rgba(12, 18, 36, 0.82);
      --panel-2: rgba(17, 26, 49, 0.9);
      --line: rgba(148, 163, 184, 0.18);
      --text: #e5eefc;
      --muted: #97a6c6;
      --accent: #7dd3fc;
      --accent-2: #a78bfa;
      --good: #4ade80;
      --warn: #fbbf24;
      --bad: #fb7185;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(125, 211, 252, 0.18), transparent 30%),
        radial-gradient(circle at bottom right, rgba(167, 139, 250, 0.14), transparent 28%),
        linear-gradient(160deg, #050816 0%, #0b1020 60%, #111827 100%);
    }
    .wrap {
      width: min(960px, calc(100vw - 32px));
      margin: 0 auto;
      padding: 32px 0 56px;
    }
    .hero, .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(12px);
    }
    .hero { padding: 28px; margin-bottom: 18px; }
    .eyebrow {
      color: var(--accent);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 12px;
      margin-bottom: 10px;
    }
    h1 { margin: 0; font-size: clamp(30px, 4vw, 52px); line-height: 1.06; }
    .lead { margin: 14px 0 0; color: var(--muted); max-width: 58ch; line-height: 1.7; }
    .grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr); gap: 18px; }
    .grid > .card:last-child { display: none; }
    .card { padding: 22px; }
    .field { display: grid; gap: 8px; margin-bottom: 16px; }
    label { font-size: 14px; color: #cbd5e1; }
    input {
      width: 100%;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 14px;
      background: var(--panel-2);
      color: var(--text);
      padding: 14px 16px;
      font-size: 16px;
      outline: none;
    }
    input:focus { border-color: rgba(125, 211, 252, 0.65); box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.12); }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 18px; }
    button {
      border: 0;
      border-radius: 14px;
      padding: 14px 18px;
      font-weight: 700;
      font-size: 15px;
      cursor: pointer;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #06111f;
    }
    button.secondary {
      background: transparent;
      color: var(--text);
      border: 1px solid rgba(148, 163, 184, 0.22);
    }
    .panel {
      margin-top: 16px;
      padding: 16px;
      border-radius: 16px;
      background: rgba(2, 6, 23, 0.35);
      border: 1px solid rgba(148, 163, 184, 0.18);
      min-height: 96px;
      white-space: pre-wrap;
      line-height: 1.7;
    }
    .stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .stat { padding: 14px; border-radius: 16px; background: rgba(15, 23, 42, 0.72); border: 1px solid rgba(148, 163, 184, 0.18); }
    .stat .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .stat .v { font-size: 18px; font-weight: 700; margin-top: 6px; }
    @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Reserve Exchange</div>
      <h1>新人预留位兑换</h1>
      <p class="lead">输入 Steam64 和 QQ 号即可兑换。兑换成功后会同时写入兑换记录和当前预留位数据源。</p>
    </section>
    <div class="grid">
      <section class="card">
        <form id="claim-form">
          <div class="field">
            <label for="qq_number">QQ 号</label>
            <input id="qq_number" name="qq_number" inputmode="numeric" autocomplete="off" placeholder="请输入 QQ 号">
          </div>
          <div class="field">
            <label for="steam64">Steam64</label>
            <input id="steam64" name="steam64" inputmode="numeric" autocomplete="off" placeholder="17 位 Steam64">
          </div>
          <div class="actions">
            <button type="submit">立即兑换</button>
            <button type="button" class="secondary" id="refresh-state">刷新规则</button>
          </div>
        </form>
        <div class="panel" id="result">等待提交。</div>
      </section>
      <section class="card">
        <div class="stats" id="stats"></div>
        <div class="panel" id="rules"></div>
      </section>
    </div>
  </main>
  <script>
    function pick(value, fallback) {
      return value === null || value === undefined ? fallback : value;
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"]/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
      });
    }

    var claimForm = document.getElementById("claim-form");
    var qqInput = document.getElementById("qq_number");
    var steamInput = document.getElementById("steam64");
    var refreshBtn = document.getElementById("refresh-state");
    var resultEl = document.getElementById("result");
    var statsEl = document.getElementById("stats");
    var rulesEl = document.getElementById("rules");

    function request(path, options) {
      var reqOptions = options || {};
      return fetch(path, {
        cache: "no-store",
        credentials: "include",
        headers: Object.assign({ "Content-Type": "application/json" }, reqOptions.headers || {}),
        method: reqOptions.method || "GET",
        body: reqOptions.body,
      }).then(function (response) {
        return response.json().catch(function () { return {}; }).then(function (body) {
          if (!response.ok) {
            var err = new Error(body.message || body.error || ("Request failed (" + response.status + ")"));
            err.body = body;
            err.response = response;
            throw err;
          }
          return body;
        });
      });
    }

    function fmtTime(ms) {
      if (!ms) return "-";
      var date = new Date(Number(ms));
      return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString();
    }

    function renderStats(summary) {
      var data = summary || {};
      statsEl.innerHTML = [
        ["服务", pick(data.enabled ? "启用" : "停用", "-")],
        ["当前记录", pick(data.claimCount, 0)],
        ["有效兑换", pick(data.grantedCount, 0)],
        ["失败记录", pick(data.failedCount, 0)]
      ].map(function (item) {
        return '<div class="stat"><div class="k">' + escapeHtml(item[0]) + '</div><div class="v">' + escapeHtml(item[1]) + '</div></div>';
      }).join("");
    }

    function renderRules(state) {
      var settings = state.settings || {};
      rulesEl.textContent = [
        "兑换开关: " + (settings.claimEnabled ? "开启" : "关闭"),
        "默认天数: " + pick(settings.defaultDays, 7),
        "随机范围: " + pick(settings.randomMinDays, 3) + " - " + pick(settings.randomMaxDays, 60) + " 天",
        "权重: 默认 " + pick(settings.defaultWeight, 50) + " / 随机 " + pick(settings.randomWeight, 50)
      ].join("\\n");
    }

    async function loadState() {
      var state = await request("/api/public/state");
      renderStats(state.summary || {});
      renderRules(state);
      return state;
    }

    claimForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      resultEl.textContent = "提交中...";
      try {
        var body = await request("/api/public/claim", {
          method: "POST",
          body: JSON.stringify({
            qq_number: qqInput.value.trim(),
            steam64: steamInput.value.trim(),
          }),
        });
        resultEl.textContent = body.message || "兑换成功。";
        await loadState();
      } catch (error) {
        resultEl.textContent = error.message || "兑换失败";
      }
    });

    refreshBtn.addEventListener("click", async function () {
      try {
        await loadState();
        resultEl.textContent = "规则已刷新。";
      } catch (error) {
        resultEl.textContent = error.message || "刷新失败";
      }
    });

    loadState().catch(function (error) {
      resultEl.textContent = error.message || "加载失败";
    });
  </script>
</body>
</html>`;
}

function renderAdminPage(initialState = null, { loginFailed = false } = {}) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>新人预留位兑换后台</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0a0f18;
      --panel: rgba(13, 18, 30, 0.88);
      --line: rgba(148, 163, 184, 0.18);
      --text: #e6edf8;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --accent-2: #a78bfa;
      --bad: #fb7185;
      --good: #4ade80;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at top left, rgba(56, 189, 248, 0.12), transparent 28%),
        radial-gradient(circle at bottom right, rgba(167, 139, 250, 0.10), transparent 30%),
        linear-gradient(160deg, #050814 0%, #0a0f18 58%, #111827 100%);
    }
    .wrap { width: min(1180px, calc(100vw - 28px)); margin: 0 auto; padding: 28px 0 56px; }
    .hero, .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 22px;
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      backdrop-filter: blur(12px);
    }
    .hero { padding: 26px; margin-bottom: 18px; }
    .eyebrow { color: var(--accent); letter-spacing: 0.16em; font-size: 12px; text-transform: uppercase; margin-bottom: 10px; }
    h1 { margin: 0; font-size: clamp(28px, 4vw, 46px); line-height: 1.06; }
    .lead { margin: 12px 0 0; color: var(--muted); line-height: 1.7; max-width: 64ch; }
    .grid { display: grid; grid-template-columns: 330px minmax(0, 1fr); gap: 18px; }
    .card { padding: 20px; }
    .field { display: grid; gap: 8px; margin-bottom: 14px; }
    label { font-size: 14px; color: #cbd5e1; }
    input[type="text"], input[type="number"], input[type="password"] {
      width: 100%;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 14px;
      background: rgba(15, 23, 42, 0.92);
      color: var(--text);
      padding: 13px 14px;
      font-size: 15px;
      outline: none;
    }
    input:focus { border-color: rgba(56, 189, 248, 0.65); box-shadow: 0 0 0 4px rgba(56, 189, 248, 0.12); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    button {
      border: 0;
      border-radius: 14px;
      padding: 13px 16px;
      font-weight: 700;
      cursor: pointer;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #08111b;
    }
    button.secondary { background: transparent; color: var(--text); border: 1px solid rgba(148, 163, 184, 0.22); }
    .panel {
      margin-top: 14px;
      padding: 14px;
      border-radius: 16px;
      background: rgba(2, 6, 23, 0.35);
      border: 1px solid rgba(148, 163, 184, 0.18);
      min-height: 92px;
      white-space: pre-wrap;
      line-height: 1.7;
    }
    .notice {
      margin-top: 14px;
      padding: 12px 14px;
      border-radius: 16px;
      border: 1px solid rgba(251, 113, 133, 0.28);
      background: rgba(127, 29, 29, 0.2);
      color: #fecdd3;
      line-height: 1.6;
    }
    .muted { color: var(--muted); }
    .hidden { display: none !important; }
    .stats {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .stat {
      padding: 14px;
      border-radius: 16px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.18);
    }
    .stat .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
    .stat .v { font-size: 18px; font-weight: 700; margin-top: 6px; }
    .table-wrap { overflow: auto; border-radius: 16px; border: 1px solid rgba(148, 163, 184, 0.16); }
    .test-grid { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: end; margin-top: 6px; }
    .sample-list { display: grid; gap: 8px; margin-top: 12px; }
    .sample-item {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 12px;
      background: rgba(15, 23, 42, 0.72);
      border: 1px solid rgba(148, 163, 184, 0.14);
      font-size: 14px;
    }
    .sample-item strong { font-weight: 700; }
    .mini { color: var(--muted); font-size: 12px; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th, td {
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid rgba(148, 163, 184, 0.12);
      font-size: 14px;
      vertical-align: top;
    }
    th { color: #dbeafe; background: rgba(15, 23, 42, 0.85); position: sticky; top: 0; }
    .tag {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 12px;
      border: 1px solid rgba(148, 163, 184, 0.18);
      background: rgba(15, 23, 42, 0.8);
    }
    .tag.good { color: var(--good); }
    .tag.bad { color: var(--bad); }
    .tag.warn { color: #fbbf24; }
    @media (max-width: 1040px) {
      .grid { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <main class="wrap">
    <section class="hero">
      <div class="eyebrow">Reserve Exchange Admin</div>
      <h1>新人预留位兑换后台</h1>
      <p class="lead">使用现有面板账号密码登录后，可查看兑换状态、调整默认天数和随机权重，并检查最近兑换记录。</p>
    </section>
    <section class="card${initialState ? ' hidden' : ''}" id="login-card">
      <form id="login-form" action="/api/auth/login" method="POST">
        <div class="field">
          <label for="username">账号</label>
          <input id="username" name="username" type="text" autocomplete="username" placeholder="面板账号">
        </div>
        <div class="field">
          <label for="password">密码</label>
          <input id="password" name="password" type="password" autocomplete="current-password" placeholder="面板密码">
        </div>
        <div class="actions">
          <button type="submit">登录</button>
        </div>
      </form>
      ${loginFailed ? '<div class="notice" id="login-notice">登录失败，请检查账号或密码后重试。</div>' : ""}
      <noscript>
        <div class="panel">当前浏览器不支持页面脚本，登录表单会直接提交。</div>
      </noscript>
      <div class="panel" id="login-message">未登录。</div>
    </section>
    <section class="card${initialState ? '' : ' hidden'}" id="admin-card">
      <div class="stats" id="stats"></div>
      <form id="settings-form">
        <div class="field"><label><input type="checkbox" name="enabled"> 服务启用</label></div>
        <div class="field"><label><input type="checkbox" name="claimEnabled"> 兑换启用</label></div>
        <div class="field"><label for="defaultDays">默认天数</label><input id="defaultDays" name="defaultDays" type="number" min="1" max="3650"></div>
        <div class="field"><label for="randomMinDays">随机范围最小天数</label><input id="randomMinDays" name="randomMinDays" type="number" min="1" max="3650"></div>
        <div class="field"><label for="randomMaxDays">随机范围最大天数</label><input id="randomMaxDays" name="randomMaxDays" type="number" min="1" max="3650"></div>
        <div class="field"><label for="defaultWeight">默认权重</label><input id="defaultWeight" name="defaultWeight" type="number" min="0" max="100000"></div>
        <div class="field"><label for="randomWeight">随机权重</label><input id="randomWeight" name="randomWeight" type="number" min="0" max="100000"></div>
        <div class="actions">
          <button type="submit">保存设置</button>
          <button type="button" class="secondary" id="reload-btn">刷新</button>
          <button type="button" class="secondary" id="logout-btn">退出</button>
        </div>
      </form>
      <div class="panel" id="admin-message">等待加载。</div>
      <section style="margin-top: 18px;">
        <div class="muted" style="margin-bottom: 10px;">随机测试窗口</div>
        <div class="test-grid">
          <div class="field" style="margin-bottom: 0;">
            <label for="previewCount">测试次数</label>
            <input id="previewCount" name="previewCount" type="number" min="1" max="100" value="10">
          </div>
          <div class="actions" style="margin-top: 0;">
            <button type="button" class="secondary" id="preview-btn">生成随机预览</button>
          </div>
        </div>
        <div class="panel" id="preview-message">点击生成后查看随机分布。</div>
        <div class="sample-list" id="preview-samples"></div>
      </section>
      <div style="margin-top: 18px;">
        <div class="muted" style="margin-bottom: 10px;">最近兑换记录</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>时间</th>
                <th>QQ</th>
                <th>Steam64</th>
                <th>状态</th>
                <th>结果</th>
                <th>天数</th>
                <th>到期</th>
                <th>原因</th>
              </tr>
            </thead>
            <tbody id="claims-body"></tbody>
          </table>
        </div>
      </div>
    </section>
  </main>
  <script id="initial-admin-state" type="application/json">${escapeHtml(JSON.stringify(initialState ?? null))}</script>
  <script src="/admin/client.js"></script>
</body>
</html>`;
}

