import { request } from "./apiClient";

export type SettingType = "boolean" | "number" | "string" | "select";
export type SettingValue = boolean | number | string;

export interface SettingOption {
  label: string;
  value: SettingValue;
}

export interface ExposedSetting {
  path: string;
  label: string;
  type: SettingType;
  description?: string;
  restartRequired?: boolean;
  advanced?: boolean;
  min?: number;
  max?: number;
  options?: SettingOption[];
  value: SettingValue;
}

export interface SettingsPayload {
  enabled: boolean;
  settings: ExposedSetting[];
}

export interface UpdateSettingsPayload extends SettingsPayload {
  restartRequired: boolean;
}

export async function fetchExposedSettings() {
  return request<SettingsPayload>("/api/settings/exposed", {
    method: "GET",
  });
}

export async function updateExposedSettings(changes: Record<string, SettingValue | unknown>) {
  return request<UpdateSettingsPayload>("/api/settings/exposed", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ changes }),
  });
}
