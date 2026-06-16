import { apiGet, apiPatch, apiPost } from "./apiClient";

export interface BzssCoreConfig {
  modifyScriptPath: string;
  remoteSaveGamePath: string;
}

export interface BzssCoreExecuteResult {
  ok: boolean;
  command?: string;
  directive?: string;
  message?: string;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
}

export async function fetchBzssCoreConfig() {
  const payload = await apiGet<{ ok?: boolean; config: BzssCoreConfig }>("/api/bzss-core/config");
  return normalizeConfig(payload.config);
}

export async function saveBzssCoreConfig(config: BzssCoreConfig) {
  const payload = await apiPatch<{ ok?: boolean; config: BzssCoreConfig }>("/api/bzss-core/config", { config });
  return normalizeConfig(payload.config);
}

export async function executeBzssCoreCommand(input: {
  directive?: string;
  parameter?: string;
  command?: string;
  raw?: boolean;
}) {
  return apiPost<BzssCoreExecuteResult>("/api/bzss-core/execute", input, {}, { timeoutMs: 20_000 });
}

function normalizeConfig(config: Partial<BzssCoreConfig> | null | undefined): BzssCoreConfig {
  return {
    modifyScriptPath: String(config?.modifyScriptPath ?? "").trim(),
    remoteSaveGamePath: String(config?.remoteSaveGamePath ?? "").trim(),
  };
}
