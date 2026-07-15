import { defineStore } from "pinia";
import { apiGet, apiPost, ApiError } from "../app/apiClient";

const SESSION_RESTORE_TIMEOUT_MS = 3_000;
const PROFILE_REFRESH_TIMEOUT_MS = 2_500;
const PROFILE_REFRESH_DELAY_MS = 1_500;
const LOGIN_TIMEOUT_MS = 6_000;

let restoreSessionPromise: Promise<void> | null = null;
let profileRefreshTimer: number | null = null;

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

export const useAuthStore = defineStore("auth", {
  state: () => ({
    checked: false,
    authenticated: false,
    user: null as AuthUser | null,
    error: null as string | null,
  }),
  actions: {
    async restoreSession() {
      if (restoreSessionPromise) return restoreSessionPromise;
      restoreSessionPromise = this.performRestoreSession();
      try {
        await restoreSessionPromise;
      } finally {
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
        this.authenticated = Boolean(data.authenticated);
        this.user = data.user ?? null;
        if (this.authenticated) this.scheduleProfileRefresh();
      } catch (error: any) {
        this.authenticated = false;
        this.user = null;
        this.error = renderAuthError(error);
      } finally {
        this.checked = true;
      }
    },

    scheduleProfileRefresh() {
      this.cancelScheduledProfileRefresh();
      if (!this.authenticated || typeof window === "undefined") return;
      profileRefreshTimer = window.setTimeout(() => {
        profileRefreshTimer = null;
        if (this.authenticated) void this.refreshProfile();
      }, PROFILE_REFRESH_DELAY_MS);
    },

    cancelScheduledProfileRefresh() {
      if (profileRefreshTimer == null || typeof window === "undefined") return;
      window.clearTimeout(profileRefreshTimer);
      profileRefreshTimer = null;
    },

    async refreshProfile() {
      if (!this.authenticated) return;
      try {
        const data = await apiGet<{ authenticated: boolean; user: AuthUser | null }>(
          "/api/auth/me/profile",
          {},
          { timeoutMs: PROFILE_REFRESH_TIMEOUT_MS },
        );
        if (!data.authenticated || !data.user || !this.authenticated) return;
        this.user = this.user ? { ...this.user, ...data.user } : data.user;
      } catch {}
    },

    async login(username: string, password: string) {
      this.error = null;
      this.cancelScheduledProfileRefresh();
      const data = await apiPost<{ authenticated: boolean; user: AuthUser | null }>(
        "/api/auth/login",
        { username, password },
        {},
        { timeoutMs: LOGIN_TIMEOUT_MS },
      );
      this.authenticated = Boolean(data.authenticated);
      this.user = data.user ?? null;
      this.checked = true;
      return data;
    },

    async logout() {
      this.cancelScheduledProfileRefresh();
      try {
        await apiPost("/api/auth/logout", {});
      } catch {}
      this.logoutLocal();
    },

    logoutLocal(message = null as string | null) {
      this.cancelScheduledProfileRefresh();
      this.checked = true;
      this.authenticated = false;
      this.user = null;
      this.error = message;
    },

    markUnauthorized() {
      this.logoutLocal("登录状态已失效，请重新登录。");
    },
  },
});

function renderAuthError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.type === "network") return "API 未连接，无法检查登录状态。";
    if (error.type === "timeout") return "检查登录状态超时。";
    return error.message;
  }
  return "登录状态检查失败。";
}
