// -*- coding: utf-8 -*-

export class SquadSnapshotValidator {
  constructor(config) {
    this.config = config;
  }

  validate(snapshot) {
    if (!snapshot) {
      return { ok: false, reason: "snapshot_null" };
    }

    if (!snapshot.serverId) {
      return { ok: false, reason: "missing_server_id" };
    }

    if (!snapshot.matchId) {
      return { ok: false, reason: "missing_match_id" };
    }

    if (!Array.isArray(snapshot.squads)) {
      return { ok: false, reason: "squads_not_array" };
    }

    if (snapshot.isMatchChanging) {
      return { ok: false, reason: "match_changing" };
    }

    if (this.config.emptySnapshotGuard) {
      const playerCount = snapshot.playerCount ?? null;
      if (
        playerCount !== null
        && playerCount >= this.config.suspiciousEmptySnapshotPlayerThreshold
        && snapshot.squads.length === 0
      ) {
        return { ok: false, reason: "suspicious_empty_snapshot" };
      }
    }

    return { ok: true };
  }
}
