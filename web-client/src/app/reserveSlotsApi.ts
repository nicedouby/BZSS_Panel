import { request } from "./apiClient";

export interface ReserveSlotGroup {
  name: string;
  permission: string;
  rawLine: string;
}

export interface ReserveSlotMember {
  steamId: string;
  group: string;
  name: string;
  expireAt: string | null;
  reasons: string[];
  remark: string;
  rawLine: string;
  isExpired: boolean;
}

export interface ReserveSlotStore {
  version: number;
  source: {
    adminFilePath: string;
    lastImportedAt: string | null;
  };
  groups: ReserveSlotGroup[];
  members: ReserveSlotMember[];
}

export interface ReserveSlotsState extends ReserveSlotStore {
  ok: true;
  enabled: boolean;
  adminFilePath: string;
  localReserveFilePath: string;
  adminFileExists: boolean;
  localReserveFileExists: boolean;
  lastImportedAt: string | null;
  summary: {
    groupCount: number;
    memberCount: number;
    expiredCount: number;
    noExpireCount: number;
    activeCount: number;
  };
  loadedAt: string | null;
  message?: string;
}

export interface UpdateReserveSlotsPayload {
  enabled: boolean;
  adminFilePath: string;
  localReserveFilePath: string;
}

export interface UpsertReserveSlotMemberPayload {
  steamId: string;
  group: string;
  expireAt: string;
  name?: string;
  reason?: string;
  sourcePage?: string;
}

export async function fetchReserveSlotsState() {
  return request<ReserveSlotsState>("/api/reserve-slots", {
    method: "GET",
  });
}

export async function importReserveSlotsFromAdmin() {
  return request<ReserveSlotsState & { success: boolean; message?: string }>(
    "/api/reserve-slots/import-from-admin",
    {
      method: "POST",
    },
  );
}

export async function updateReserveSlotsConfig(payload: UpdateReserveSlotsPayload) {
  return request<ReserveSlotsState & { success: boolean; message?: string }>(
    "/api/settings/reserve-slots",
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );
}

export async function upsertReserveSlotMember(payload: UpsertReserveSlotMemberPayload) {
  return request<ReserveSlotsState & { success: boolean; message?: string }>(
    "/api/reserve-slots/members",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...payload,
        sourcePage: payload.sourcePage ?? "reserve_slot_management",
      }),
    },
  );
}

export async function deleteReserveSlotMember(steamId: string) {
  return request<ReserveSlotsState & { success: boolean; message?: string }>(
    `/api/reserve-slots/members/${encodeURIComponent(String(steamId ?? "").trim())}`,
    {
      method: "DELETE",
    },
  );
}

export async function deleteExpiredReserveSlotMembers() {
  return request<ReserveSlotsState & { success: boolean; message?: string }>(
    "/api/reserve-slots/delete-expired",
    {
      method: "POST",
    },
  );
}

export async function exportReserveSlotsCsv() {
  const response = await fetch("/api/reserve-slots/export-csv", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  const body = await response.json().catch(() => null as any);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  }

  return {
    csv: String(body?.csv ?? ""),
    message: String(body?.message ?? ""),
  };
}

export async function importReserveSlotsCsv(csvText: string) {
  const response = await fetch("/api/reserve-slots/import-csv", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: csvText,
  });

  const body = await response.json().catch(() => null as any);
  if (!response.ok) {
    throw new Error(body?.message || body?.error || `Request failed (${response.status})`);
  }

  return body as ReserveSlotsState & { success: boolean; message?: string };
}
