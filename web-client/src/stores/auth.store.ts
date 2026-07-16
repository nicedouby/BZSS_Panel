import { defineStore } from "pinia";
import { apiGet, apiPost, ApiError } from "../app/apiClient";

const SESSION_RESTORE_TIMEOUT_MS = 3_000;
const PROFILE_REFRESH_TIMEOUT_MS = 2_500;
const PROFILE_REFRESH_DELAY_MS = 1_500;
const LOGIN_TIMEOUT_MS = 6_000;
const AUTH_BOOTSTRAP_CACHE_KEY = "bzss.auth.bootstrap.v1";
const AUTH_BOOTSTRAP_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1_000;
const SESSION_RESTORE_RETRY_DELAYS_MS = [1_200, 3_000, 7_000] as const;

let restoreSessionPromise: Promise<void> | null = null;
let profileRefreshTimer: number | null = null;
let sessionRestoreRetryTimer: number | null = null;
let sessionRestoreFailureCount = 0;

export interface AuthUser {
  id: string;
  username: string;
  role: string;
  isSuperAdmin: boolean;
  authorizationMode?: string;
  steam64?: string;
  steamAvatar?: string | null;
  viewerTeamAutoSwapEnabled?: boolean;
  permissions?: string[];
}

interface AuthBootstrapCache {
  savedAt: number;
  user: AuthUser;
}

const cachedAuthBootstrap = readAuthBootstrapCache();

export const useAuthStore = defineStore("auth", {
  state: () => ({
    checked: false,
    authenticated: Boolean(cachedAuthBootstrap?.user),
    user: (cachedAuthBootstrap?.user ?? null) as AuthUser | null,
    error: null as string | null,
    restoring: false,
    sessionVerified: false,
    usingCachedSession: Boolean(cachedAuthBootstrap?.user),
  }),
  actions: {
    async restoreSession() {
      if (restoreSessionPromise) return restoreSessionPromise;
      this.restoring = true;
      restoreSessionPromise = this.performRestoreSession();
      try {
        await restoreSessionPromise;
      } finally {
        this.restoring = false;
        restoreSessionPromise = null;
      }
    },

    async performRestoreSession() {
      this.error = null;
      try {
        const data = await apiGet<{ authenticated: boolean; user: AuthUser | null }>(
          "/api/auth/session",
          {},
          { timeoutMs: SESSION_RESTORE_TIMEOUT_MS },
        );
        const user = data.user ?? null;
        const authenticated = Boolean(data.authenticated && user);
        this.authenticated = authenticated;
        this.user = authenticated ? user : null;
        this.sessionVerified = authenticated;
        this.usingCachedSession = false;
        this.cancelSessionRestoreRetry();
        sessionRestoreFailureCount = 0;

        if (authenticated && user) {
          writeAuthBootstrapCache(user);
          this.scheduleProfileRefresh();
        } else {
          clearAuthBootstrapCache();
        }
      } catch (error: any) {
        const canKeepCachedShell = Boolean(this.usingCachedSession && this.authenticated && this.user);
        this.sessionVerified = false;
        this.error = renderAuthError(error);

        if (canKeepCachedShell) {
          this.scheduleSessionRestoreRetry();
        } else {
          this.authenticated = false;
          this.user = null;
          this.usingCachedSession = false;
          clearAuthBootstrapCache();
        }
      } finally {
        this.checked = true;
      }
    },

    scheduleSessionRestoreRetry() {
      this.cancelSessionRestoreRetry();
      if (!this.usingCachedSession || this.sessionVerified || typeof window === "undefined") return;
      if (sessionRestoreFailureCount >= SESSION_RESTORE_RETRY_DELAYS_MS.length) return;

      const delay = SESSION_RESTORE_RETRY_DELAYS_MS[sessionRestoreFailureCount];
      sessionRestoreFailureCount += 1;
      sessionRestoreRetryTimer = window.setTimeout(() => {
        sessionRestoreRetryTimer = null;
        if (this.usingCachedSession && !this.sessionVerified) void this.restoreSession();
      }, delay);
    },

    cancelSessionRestoreRetry() {
      if (sessionRestoreRetryTimer == null || typeof window === "undefined") return;
      window.clearTimeout(sessionRestoreRetryTimer);
      sessionRestoreRetryTimer = null;
    },

    scheduleProfileRefresh() {
      this.cancelScheduledProfileRefresh();
      if (!this.authenticated || !this.sessionVerified || typeof window === "undefined") return;
      profileRefreshTimer = window.setTimeout(() => {
        profileRefreshTimer = null;
        if (this.authenticated && this.sessionVerified) void this.refreshProfile();
      }, PROFILE_REFRESH_DELAY_MS);
    },

    cancelScheduledProfileRefresh() {
      if (profileRefreshTimer == null || typeof window === "undefined") return;
      window.clearTimeout(profileRefreshTimer);
      profileRefreshTimer = null;
    },

    async refreshProfile() {
      if (!this.authenticated || !this.sessionVerified) return;
      try {
        const data = await apiGet<{ authenticated: boolean; user: AuthUser | null }>(
          "/api/auth/me/profile",
          {},
          { timeoutMs: PROFILE_REFRESH_TIMEOUT_MS },
        );
        if (!data.authenticated || !data.user || !this.authenticated) return;
        this.user = this.user ? { ...this.user, ...data.user } : data.user;
        writeAuthBootstrapCache(this.user);
      } catch {}
    },

    async login(username: string, password: string) {
      this.error = null;
      this.cancelScheduledProfileRefresh();
      this.cancelSessionRestoreRetry();
      const data = await apiPost<{ authenticated: boolean; user: AuthUser | null }>(
        "/api/auth/login",
        { username, password },
        {},
        { timeoutMs: LOGIN_TIMEOUT_MS },
      );
      const user = data.user ?? null;
      this.authenticated = Boolean(data.authenticated && user);
      this.user = this.authenticated ? user : null;
      this.checked = true;
      this.sessionVerified = this.authenticated;
      this.usingCachedSession = false;
      sessionRestoreFailureCount = 0;

      if (this.authenticated && user) {
        writeAuthBootstrapCache(user);
        this.scheduleProfileRefresh();
      } else {
        clearAuthBootstrapCache();
      }
      return data;
    },

    async logout() {
      this.cancelScheduledProfileRefresh();
      this.cancelSessionRestoreRetry();
      try {
        await apiPost("/api/auth/logout", {});
      } catch {}
      this.logoutLocal();
    },

    logoutLocal(message = null as string | null) {
      this.cancelScheduledProfileRefresh();
      this.cancelSessionRestoreRetry();
      sessionRestoreFailureCount = 0;
      this.checked = true;
      this.authenticated = false;
      this.user = null;
      this.error = message;
      this.restoring = false;
      this.sessionVerified = false;
      this.usingCachedSession = false;
      clearAuthBootstrapCache();
    },

    markUnauthorized() {
      this.logoutLocal("登录状态已失效，请重新登录。");
    },
  },
});

function readAuthBootstrapCache(): AuthBootstrapCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_BOOTSTRAP_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthBootstrapCache>;
    const savedAt = Number(parsed.savedAt ?? 0);
    const user = parsed.user as AuthUser | undefined;
    if (!user?.id || !user.username || !Number.isFinite(savedAt)) {
      clearAuthBootstrapCache();
      return null;
    }
    if (Date.now() - savedAt > AUTH_BOOTSTRAP_CACHE_MAX_AGE_MS) {
      clearAuthBootstrapCache();
      return null;
    }
    return { savedAt, user };
  } catch {
    clearAuthBootstrapCache();
    return null;
  }
}

function writeAuthBootstrapCache(user: AuthUser | null) {
  if (!user || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(AUTH_BOOTSTRAP_CACHE_KEY, JSON.stringify({
      savedAt: Date.now(),
      user,
    } satisfies AuthBootstrapCache));
  } catch {}
}

function clearAuthBootstrapCache() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(AUTH_BOOTSTRAP_CACHE_KEY);
  } catch {}
}

function renderAuthError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.type === "network") return "API 未连接，正在保留当前页面并重试登录状态。";
    if (error.type === "timeout") return "检查登录状态超时，正在保留当前页面并重试。";
    return error.message;
  }
  return "登录状态检查失败，正在保留当前页面并重试。";
}
