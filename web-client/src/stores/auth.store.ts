import { defineStore } from "pinia";
import { apiGet, apiPost, ApiError } from "../app/apiClient";

let restoreSessionPromise: Promise<void> | null = null;

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
        const data = await apiGet<{ authenticated: boolean; user: AuthUser | null }>("/api/auth/session", {}, { timeoutMs: 8_000 });
        this.authenticated = Boolean(data.authenticated);
        this.user = data.user ?? null;
      } catch (error: any) {
        this.authenticated = false;
        this.user = null;
        this.error = renderAuthError(error);
      } finally {
        this.checked = true;
      }
    },

    async login(username: string, password: string) {
      this.error = null;
      const data = await apiPost<{ authenticated: boolean; user: AuthUser | null }>("/api/auth/login", { username, password });
      this.authenticated = Boolean(data.authenticated);
      this.user = data.user ?? null;
      this.checked = true;
      return data;
    },

    async logout() {
      try {
        await apiPost("/api/auth/logout", {});
      } catch {}
      this.logoutLocal();
    },

    logoutLocal(message = null as string | null) {
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
