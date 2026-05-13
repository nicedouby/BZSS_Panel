import type { PluginManifest } from "./plugin.types";

const API_BASE = "/api/plugins";

async function requestJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function fetchPlugins(): Promise<PluginManifest[]> {
  return requestJson<PluginManifest[]>(API_BASE);
}

export function setPluginEnabled(pluginId: string, enabled: boolean): Promise<PluginManifest> {
  return requestJson<PluginManifest>(`${API_BASE}/${pluginId}/enabled`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function updatePluginConfig(
  pluginId: string,
  config: Record<string, unknown>,
): Promise<PluginManifest> {
  return requestJson<PluginManifest>(`${API_BASE}/${pluginId}/config`, {
    method: "PATCH",
    body: JSON.stringify({ config }),
  });
}
