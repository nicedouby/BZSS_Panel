import { apiDelete, apiGet, apiPatch, apiPost } from "./apiClient";

export const SUPER_WEATHER_NAMES = [
  "Clear_Skies", "Cloudy", "Foggy", "Overcast", "Partly_Cloudy", "Rain",
  "Rain_Light", "Rain_Thunders", "Sand_Dust_Calm", "Sand_Dust_Storm",
  "Snow", "Snow_Blizzard", "Snow_Light",
] as const;

export interface SuperWeatherWeatherSegment {
  id: string;
  type: "weather";
  weatherType: number;
  durationSeconds: number;
  /** SetWeather transition parameter used when switching to the next weather. */
  transitionToNextSeconds: number;
}

export type SuperWeatherSegment = SuperWeatherWeatherSegment;

export interface SuperWeatherPreset {
  id: string;
  name: string;
  version: number;
  timeline: SuperWeatherSegment[];
  endBehavior: "hold_last";
  createdAt?: string;
  updatedAt?: string;
}

export interface SuperWeatherResolvedSegment {
  type: "weather";
  segmentId: string;
  transitionNodeId?: string | null;
  startSeconds: number;
  endSeconds: number | null;
  currentWeather: number;
  targetWeather: number;
  transitionTotalSeconds: number;
  transitionRemainingSeconds: number;
  timelinePositionSeconds: number;
  held?: boolean;
  segmentIndex?: number;
}

export interface SuperWeatherState {
  running: boolean;
  clockState: string;
  activePresetId: string | null;
  activePresetVersion?: number | null;
  roundKey: string;
  rawRconSeconds: number | null;
  logicalSeconds: number | null;
  clockDriftSeconds: number;
  currentSegment: SuperWeatherResolvedSegment | null;
  nextSegment: Record<string, any> | null;
  nextActionSeconds?: number | null;
  lastWeather: number | null;
  lastCommand: string;
  lastCommandAt: string;
  lastRconUpdateAt: string;
  totalDurationSeconds: number;
  diagnostics: Array<{ at: string; type: string; message: string; data?: unknown }>;
}

export function fetchState() {
  return apiGet<SuperWeatherState>("/api/plugins/bzss-super-weather/state");
}

export async function fetchPresets() {
  const result = await apiGet<{ presets: SuperWeatherPreset[] }>("/api/plugins/bzss-super-weather/presets");
  return result.presets;
}

export function createPreset(input: Partial<SuperWeatherPreset>) {
  return apiPost<SuperWeatherPreset>("/api/plugins/bzss-super-weather/presets", input);
}

export function updatePreset(id: string, input: Partial<SuperWeatherPreset>) {
  return apiPatch<SuperWeatherPreset>(`/api/plugins/bzss-super-weather/presets/${encodeURIComponent(id)}`, input);
}

export function deletePreset(id: string) {
  return apiDelete<{ ok: boolean }>(`/api/plugins/bzss-super-weather/presets/${encodeURIComponent(id)}`);
}

export function duplicatePreset(id: string, name?: string) {
  return apiPost<SuperWeatherPreset>(`/api/plugins/bzss-super-weather/presets/${encodeURIComponent(id)}/duplicate`, { name });
}

export function activatePreset(presetId: string) {
  return apiPost<SuperWeatherState>("/api/plugins/bzss-super-weather/activate", { presetId });
}

export function stopSuperWeather() {
  return apiPost<SuperWeatherState>("/api/plugins/bzss-super-weather/stop", {});
}

export function reconcile() {
  return apiPost<SuperWeatherState>("/api/plugins/bzss-super-weather/reconcile", {});
}

export function testWeather(weatherType: number, transitionSeconds = 0) {
  return apiPost<{ ok: boolean; message?: string }>("/api/plugins/bzss-super-weather/test-weather", {
    weatherType,
    transitionSeconds,
  });
}
