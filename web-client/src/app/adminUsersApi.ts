import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient";

export type AdminUserRole = "Admin" | "SuperAdmin";

export interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: AdminUserRole;
  steam64: string | null;
  steamAvatar: string | null;
  viewerTeamAutoSwapEnabled: boolean;
  enabled: boolean;
  note: string;
  createdAt: number;
  updatedAt: number;
  passwordChangedAt: number;
}

export interface AdminUserStats {
  total: number;
  enabled: number;
  superAdmins: number;
  steamBound: number;
}

export interface AdminUsersResponse {
  ok: boolean;
  items: AdminUser[];
  stats: AdminUserStats;
}

export interface AdminUserResponse {
  ok: boolean;
  user: AdminUser;
}

export interface CreateAdminUserPayload {
  username: string;
  displayName?: string;
  password: string;
  role: AdminUserRole;
  steam64?: string | null;
  viewerTeamAutoSwapEnabled?: boolean;
  enabled?: boolean;
  note?: string;
}

export interface UpdateAdminUserPayload {
  displayName?: string;
  role?: AdminUserRole;
  steam64?: string | null;
  viewerTeamAutoSwapEnabled?: boolean;
  enabled?: boolean;
  note?: string;
}

export function fetchAdminUsers() {
  return apiGet<AdminUsersResponse>("/api/admin/users");
}

export function createAdminUser(payload: CreateAdminUserPayload) {
  return apiPost<AdminUserResponse>("/api/admin/users", payload);
}

export function updateAdminUser(userId: string, payload: UpdateAdminUserPayload) {
  return apiPatch<AdminUserResponse>(`/api/admin/users/${encodeURIComponent(userId)}`, payload);
}

export function resetAdminUserPassword(userId: string, password: string) {
  return apiPost<AdminUserResponse>(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, { password });
}

export function deleteAdminUser(userId: string) {
  return apiDelete<AdminUserResponse>(`/api/admin/users/${encodeURIComponent(userId)}`);
}
