import { apiGet } from "./apiClient";

export type MemBridgeTarget = "formal" | "test";
export type MemBridgeVector = { x: number; y: number; z: number };

export interface MemBridgePlayer {
  id: string;
  playerId: number | null;
  name: string;
  teamId: number | null;
  squadId: number | null;
  connectionKind: string;
  hasPawn: boolean;
  position: MemBridgeVector | null;
  positionMeters: MemBridgeVector | null;
  positionStatus: string;
  positionSource?: string;
  yaw: number | null;
  fireteamIndex: number | null;
  fireteamPosition: number | null;
  isLeader: boolean;
  role: string | null;
  vitals: {
    current: number | null;
    maximum: number | null;
    percent: number | null;
    source: string | null;
    status: string;
  };
  combat: {
    kills: number | null;
    vehicleKills: number | null;
    deaths: number | null;
    woundeds: number | null;
    wounds: number | null;
    teamKills: number | null;
    healPoints: number | null;
    revives: number | null;
    teamworkScore: number | null;
    objectiveScore: number | null;
    combatScore: number | null;
  };
  combatStatus: string;
  combatSource: string | null;
  combatObservedAt: number | null;
}

export interface MemBridgeSnapshot {
  schema: number;
  module: "BZSS-MEM-BRIDGE";
  version: string;
  readOnly: true;
  target: MemBridgeTarget;
  observedAt: number;
  epoch: string | null;
  map: { worldName: string; mapName: string; units: string } | null;
  players: MemBridgePlayer[];
  mapPoints: any[];
  health?: { status?: string; message?: string; code?: string; playerStates?: number; playersWithPosition?: number };
}

/** Uses the same formal/test instance selector as native placeholder controls. */
export function memBridgePanelTarget(): MemBridgeTarget {
  return document.querySelector<HTMLMetaElement>('meta[name="bzss-native-target"]')?.content === "test" ? "test" : "formal";
}

export function readMemBridgeSnapshot(target: MemBridgeTarget = memBridgePanelTarget()) {
  return apiGet<MemBridgeSnapshot>(`/api/mem-bridge/snapshot?target=${target}`, {}, { timeoutMs: 4000 });
}
