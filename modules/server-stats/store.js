// -*- coding: utf-8 -*-

import crypto from "node:crypto";

export class ServerMetricStore {
  constructor(db) {
    this.db = db;
  }

  async init() {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS server_metric_samples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        metrics_json TEXT NOT NULL,
        metrics_hash TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL
      )
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_server_metric_samples_server_time
      ON server_metric_samples(server_id, timestamp_ms)
    `);

    await this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_server_metric_samples_hash
      ON server_metric_samples(server_id, metrics_hash)
    `);
  }

  async insertSample({ serverId, timestampMs, metrics, metricsHash }) {
    await this.db.run(
      `
      INSERT INTO server_metric_samples
      (server_id, timestamp_ms, metrics_json, metrics_hash, created_at_ms)
      VALUES (?, ?, ?, ?, ?)
      `,
      [
        serverId,
        timestampMs,
        JSON.stringify(metrics),
        metricsHash,
        Date.now(),
      ],
    );
  }

  async getHistory({ serverId, fromMs, toMs, includeCurrent = false }) {
    // Get the sample just before the start time to ensure a continuous line
    const previous = await this.db.get(
      `
      SELECT timestamp_ms, metrics_json
      FROM server_metric_samples
      WHERE server_id = ?
        AND timestamp_ms < ?
      ORDER BY timestamp_ms DESC
      LIMIT 1
      `,
      [serverId, fromMs],
    );

    const rows = await this.db.all(
      `
      SELECT timestamp_ms, metrics_json
      FROM server_metric_samples
      WHERE server_id = ?
        AND timestamp_ms >= ?
        AND timestamp_ms <= ?
      ORDER BY timestamp_ms ASC
      `,
      [serverId, fromMs, toMs],
    );

    const result = [];

    if (previous) {
      result.push({
        timestamp_ms: Number(fromMs),
        metrics: JSON.parse(previous.metrics_json),
        virtual: true,
      });
    }

    for (const row of rows) {
      result.push({
        timestamp_ms: Number(row.timestamp_ms),
        metrics: JSON.parse(row.metrics_json),
        virtual: false,
      });
    }

    return {
      server_id: serverId,
      from_ms: Number(fromMs),
      to_ms: Number(toMs),
      samples: result,
      summary: {
        sampleCount: result.length,
        firstAt: result[0]?.timestamp_ms ?? null,
        lastAt: result.at(-1)?.timestamp_ms ?? null,
        latest: result.length > 0 ? {
          timestamp_ms: result.at(-1).timestamp_ms,
          metrics: result.at(-1).metrics,
        } : null,
      },
    };
  }

  async listAvailableDates({ serverId }) {
    const rows = await this.db.all(
      `
      SELECT DISTINCT date(timestamp_ms / 1000, 'unixepoch', 'localtime') as date
      FROM server_metric_samples
      WHERE server_id = ?
      ORDER BY date DESC
      LIMIT 30
      `,
      [serverId],
    );
    return rows.map((r) => r.date);
  }
}

export function hashMetrics(metrics) {
  const text = JSON.stringify(metrics);
  return crypto.createHash("sha1").update(text).digest("hex");
}
