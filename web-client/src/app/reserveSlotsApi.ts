import { request } from "./apiClient";

export interface ReserveSlotGroup {
  name: string;
  permission: string;
  rawLine: string;
}

export interface ReserveSlotMember {
  steamId: string;
  group: string;
  expireAt: string | null;
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
