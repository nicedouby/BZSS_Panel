import { request } from "../../app/apiClient";

export interface GroupReportMember {
  playerKey: string;
  eosId?: string;
  steamId?: string;
  teamId?: number;
  squadId?: number;
  playtimeHours?: number | null;
  name: string;
  note?: string;
  addedAt: number;
  addedBy?: string;
}

export interface GroupReportGroup {
  id: string;
  number: number;
  name: string;
  note?: string;
  color?: string;
  anchorPlayerKey?: string;
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  members: GroupReportMember[];
}

export interface GroupReportSnapshot {
  plugin: "group-report";
  version: number;
  generatedAt: number;
  groups: GroupReportGroup[];
}

interface ApiResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

async function unwrap<T>(path: string, init?: RequestInit): Promise<T> {
  const payload = await request<ApiResult<T>>(path, init);
  if (!payload?.ok) {
    throw new Error(payload?.error || "Request failed.");
  }
  return payload.data as T;
}

export const groupReportApi = {
  getSnapshot(): Promise<GroupReportSnapshot> {
    return unwrap<GroupReportSnapshot>("/api/plugins/group-report/snapshot");
  },

  getGroups(): Promise<GroupReportGroup[]> {
    return unwrap<{ groups: GroupReportGroup[] }>("/api/plugins/group-report/groups")
      .then((result) => result.groups);
  },

  createGroup(input: { name?: string; note?: string; color?: string; anchorPlayerKey?: string }): Promise<GroupReportGroup> {
    return unwrap<GroupReportGroup>("/api/plugins/group-report/groups", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  },

  updateGroup(groupId: string, input: { name?: string; note?: string; color?: string; anchorPlayerKey?: string }): Promise<GroupReportGroup> {
    return unwrap<GroupReportGroup>(`/api/plugins/group-report/groups/${encodeURIComponent(groupId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  },

  deleteGroup(groupId: string): Promise<{ deleted: true }> {
    return unwrap<{ deleted: true }>(`/api/plugins/group-report/groups/${encodeURIComponent(groupId)}`, {
      method: "DELETE",
    });
  },

  deleteAllGroups(): Promise<{ deleted: number }> {
    return unwrap<{ deleted: number }>("/api/plugins/group-report/groups", {
      method: "DELETE",
    });
  },

  addMember(
    groupId: string,
    input: {
      eosId?: string;
      steamId?: string;
      teamId?: number;
      squadId?: number;
      playtimeHours?: number | null;
      name: string;
      note?: string;
    },
  ): Promise<GroupReportGroup> {
    return unwrap<GroupReportGroup>(`/api/plugins/group-report/groups/${encodeURIComponent(groupId)}/members`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    });
  },

  updateMember(
    groupId: string,
    playerKey: string,
    input: {
      eosId?: string;
      steamId?: string;
      teamId?: number;
      squadId?: number;
      playtimeHours?: number | null;
      name?: string;
      note?: string;
    },
  ): Promise<GroupReportGroup> {
    return unwrap<GroupReportGroup>(
      `/api/plugins/group-report/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(playerKey)}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      },
    );
  },

  removeMember(groupId: string, playerKey: string): Promise<GroupReportGroup> {
    return unwrap<GroupReportGroup>(
      `/api/plugins/group-report/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(playerKey)}`,
      {
        method: "DELETE",
      },
    );
  },

  clearGroupMembers(groupId: string): Promise<GroupReportGroup> {
    return unwrap<GroupReportGroup>(
      `/api/plugins/group-report/groups/${encodeURIComponent(groupId)}/members`,
      {
        method: "DELETE",
      },
    );
  },
};
