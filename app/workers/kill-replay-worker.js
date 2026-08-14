// -*- coding: utf-8 -*-

import fsp from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";

import { isLikelyDeathLine, parseReplayKillLine } from "../modules/kill-records/kill-record-normalizer.js";

const READ_CHUNK_BYTES = Math.max(4096, Number(workerData?.readChunkBytes) || 4 * 1024 * 1024);
const BATCH_SIZE = Math.max(1, Number(workerData?.batchSize) || 100);
const PROGRESS_BYTES = Math.max(1024 * 1024, Number(workerData?.progressBytes) || 8 * 1024 * 1024);

void run().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error?.message ?? String(error), stack: error?.stack ?? "", offset: currentOffset });
  process.exitCode = 1;
});

let currentOffset = Math.max(0, Number(workerData?.startOffset) || 0);

async function run() {
  const sourcePath = String(workerData?.sourcePath ?? "");
  const initialStat = await fsp.stat(sourcePath);
  const sourceFileId = String(workerData?.sourceFileId ?? makeFileId(initialStat));
  const cutoff = Math.min(initialStat.size, Math.max(currentOffset, Number(workerData?.endOffset) || initialStat.size));
  const handle = await fsp.open(sourcePath, "r");
  let partial = Buffer.alloc(0);
  let partialOffset = currentOffset;
  let scannedLines = 0;
  let killsFound = 0;
  let nextProgressAt = currentOffset + PROGRESS_BYTES;
  let batch = [];
  const identities = new Map();
  const startedAt = Date.now();

  try {
    while (currentOffset < cutoff) {
      const latestStat = await fsp.stat(sourcePath);
      if (makeFileId(latestStat) !== sourceFileId || latestStat.size < cutoff) {
        parentPort?.postMessage({ type: "sourceChanged", status: "source_changed", offset: currentOffset });
        return;
      }
      const length = Math.min(READ_CHUNK_BYTES, cutoff - currentOffset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, currentOffset);
      if (!bytesRead) break;
      const chunkStart = currentOffset;
      currentOffset += bytesRead;
      const blob = partial.length ? Buffer.concat([partial, buffer.subarray(0, bytesRead)]) : buffer.subarray(0, bytesRead);
      const blobStart = partial.length ? partialOffset : chunkStart;
      let cursor = 0;
      while (true) {
        const newline = blob.indexOf(0x0a, cursor);
        if (newline < 0) break;
        let lineBytes = blob.subarray(cursor, newline);
        if (lineBytes.at(-1) === 0x0d) lineBytes = lineBytes.subarray(0, -1);
        const lineOffset = blobStart + cursor;
        cursor = newline + 1;
        if (!lineBytes.length) continue;
        scannedLines += 1;
        const line = lineBytes.toString("utf8");
        rememberIdentity(line, identities);
        if (!isLikelyDeathLine(line)) continue;
        const record = parseReplayKillLine(line, {
          serverId: workerData?.serverId,
          sourceFile: sourcePath,
          sourceFileId,
          sourceOffset: lineOffset,
        });
        if (!record) continue;
        enrichAttacker(record, identities);
        rememberRecordIdentity(record, identities);
        batch.push(record);
        killsFound += 1;
        if (batch.length >= BATCH_SIZE) flushBatch();
      }
      partial = cursor < blob.length ? Buffer.from(blob.subarray(cursor)) : Buffer.alloc(0);
      partialOffset = blobStart + cursor;
      if (currentOffset >= nextProgressAt || currentOffset >= cutoff) {
        sendProgress();
        nextProgressAt = currentOffset + PROGRESS_BYTES;
      }
    }

    if (partial.length && partialOffset < cutoff) {
      scannedLines += 1;
      const line = partial.toString("utf8");
      rememberIdentity(line, identities);
      if (isLikelyDeathLine(line)) {
        const record = parseReplayKillLine(line, {
          serverId: workerData?.serverId,
          sourceFile: sourcePath,
          sourceFileId,
          sourceOffset: partialOffset,
        });
        if (record) {
          enrichAttacker(record, identities);
          rememberRecordIdentity(record, identities);
          batch.push(record);
          killsFound += 1;
        }
      }
    }
    flushBatch();
    parentPort?.postMessage({
      type: "complete",
      scannedBytes: Math.max(0, currentOffset - Number(workerData?.startOffset || 0)),
      completedOffset: currentOffset,
      totalBytes: Math.max(0, cutoff - Number(workerData?.startOffset || 0)),
      scannedLines,
      killsFound,
      durationMs: Date.now() - startedAt,
    });
  } finally {
    await handle.close();
  }

  function flushBatch() {
    if (!batch.length) return;
    parentPort?.postMessage({ type: "killBatch", records: batch });
    batch = [];
  }

  function sendProgress() {
    const scannedBytes = Math.max(0, currentOffset - Number(workerData?.startOffset || 0));
    const totalBytes = Math.max(0, cutoff - Number(workerData?.startOffset || 0));
    parentPort?.postMessage({
      type: "progress",
      scannedBytes,
      completedOffset: currentOffset,
      totalBytes,
      scannedLines,
      killsFound,
      percentage: totalBytes ? Math.min(100, (scannedBytes / totalBytes) * 100) : 100,
    });
  }
}

function makeFileId(stat) {
  const ino = String(stat?.ino ?? 0);
  const dev = String(stat?.dev ?? 0);
  return ino !== "0" ? `${dev}:${ino}` : `${dev}:0:${Math.trunc(Number(stat?.ctimeMs) || 0)}`;
}

function rememberIdentity(line, identities) {
  if (!line.includes("Online IDs:")) return;
  const name = capture(line, /ActualDamage=[-+]?\d+(?:\.\d+)?\s+from\s+(.*?)\s*\(Online IDs:/i)
    || capture(line, /KillingDamage=[-+]?\d+(?:\.\d+)?\s+from\s+(.*?)\s*\(Online IDs:/i);
  if (!name || /PlayerController|^BP_|^nullptr$/i.test(name)) return;
  const identity = {
    name,
    eosID: capture(line, /\bEOS:\s*([^\s|)]+)/i),
    steam64ID: capture(line, /\bsteam:\s*([^\s|)]+)/i),
    controllerID: capture(line, /(?:Player\s+)?Cont(?:r)?oller ID:\s*([^\s|)]+)/i),
  };
  indexIdentity(identity, identities);
}

function rememberRecordIdentity(record, identities) {
  if (record?.attacker?.name) indexIdentity(record.attacker, identities);
}

function enrichAttacker(record, identities) {
  if (record?.attacker?.name) return;
  const candidate = [record?.attacker?.controllerID, record?.attacker?.steam64ID, record?.attacker?.eosID]
    .map((value) => identities.get(String(value ?? "")))
    .find(Boolean);
  if (!candidate) return;
  record.attacker = { ...record.attacker, ...candidate };
  record.parse.identityConfidence = "High";
  record.parse.confidence = record.parse.parseConfidence === "High" ? "High" : "Medium";
}

function indexIdentity(identity, identities) {
  const normalized = {
    name: String(identity?.name ?? ""),
    eosID: String(identity?.eosID ?? ""),
    steam64ID: String(identity?.steam64ID ?? ""),
    controllerID: String(identity?.controllerID ?? ""),
  };
  for (const value of Object.values(normalized)) if (value) identities.set(value, normalized);
}

function capture(text, expression) {
  return String(text ?? "").match(expression)?.[1]?.trim() ?? "";
}
