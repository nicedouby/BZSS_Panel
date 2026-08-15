// -*- coding: utf-8 -*-

import fsp from "node:fs/promises";
import { parentPort, workerData } from "node:worker_threads";
import { parseReplaySquadCreateLine } from "../modules/squad-lifecycle/log-adapter.js";

const READ_CHUNK_BYTES = Math.max(4096, Number(workerData?.readChunkBytes) || 4 * 1024 * 1024);
const BATCH_SIZE = Math.max(1, Number(workerData?.batchSize) || 100);
let currentOffset = Math.max(0, Number(workerData?.startOffset) || 0);

void run().catch((error) => {
  parentPort?.postMessage({ type: "error", message: error?.message ?? String(error), stack: error?.stack ?? "", offset: currentOffset });
  process.exitCode = 1;
});

async function run() {
  const sourcePath = String(workerData?.sourcePath ?? "");
  const initialStat = await fsp.stat(sourcePath);
  const sourceFileId = String(workerData?.sourceFileId ?? makeFileId(initialStat));
  const cutoff = Math.min(initialStat.size, Math.max(currentOffset, Number(workerData?.endOffset) || initialStat.size));
  const handle = await fsp.open(sourcePath, "r");
  const startedAt = Date.now();
  const roundBoundaryOffset = await findLastRoundBoundaryOffset(handle, cutoff);
  if (roundBoundaryOffset == null) {
    parentPort?.postMessage({ type: "boundaryUnknown", boundaryFound: false, roundBoundaryOffset: null, cutoffOffset: cutoff });
    await handle.close();
    return;
  }
  currentOffset = roundBoundaryOffset;
  parentPort?.postMessage({ type: "boundaryFound", boundaryFound: true, roundBoundaryOffset, cutoffOffset: cutoff });
  let partial = Buffer.alloc(0);
  let partialOffset = currentOffset;
  let scannedLines = 0;
  let squadCreatesFound = 0;
  let batch = [];
  try {
    while (currentOffset < cutoff) {
      const latest = await fsp.stat(sourcePath);
      if (makeFileId(latest) !== sourceFileId || latest.size < cutoff) {
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
        collect(lineBytes, blobStart + cursor);
        cursor = newline + 1;
      }
      partial = cursor < blob.length ? Buffer.from(blob.subarray(cursor)) : Buffer.alloc(0);
      partialOffset = blobStart + cursor;
      parentPort?.postMessage({ type: "progress", scannedBytes: Math.max(0, currentOffset - Number(workerData?.startOffset || 0)), completedOffset: currentOffset, totalBytes: Math.max(0, cutoff - Number(workerData?.startOffset || 0)), scannedLines, squadCreatesFound, percentage: cutoff === Number(workerData?.startOffset || 0) ? 100 : Math.min(100, ((currentOffset - Number(workerData?.startOffset || 0)) / Math.max(1, cutoff - Number(workerData?.startOffset || 0))) * 100) });
    }
    if (partial.length && partialOffset < cutoff) collect(partial, partialOffset);
    flush();
    parentPort?.postMessage({ type: "complete", scannedBytes: Math.max(0, currentOffset - Number(workerData?.startOffset || 0)), completedOffset: currentOffset, totalBytes: Math.max(0, cutoff - Number(workerData?.startOffset || 0)), scannedLines, squadCreatesFound, accepted: squadCreatesFound, duplicates: 0, pendingTeamResolution: 0, roundBoundaryOffset, durationMs: Date.now() - startedAt });
  } finally { await handle.close(); }

  function collect(lineBytes, sourceOffset) {
    if (!lineBytes.length) return;
    scannedLines += 1;
    const line = lineBytes.toString("utf8");
    if (!/LogSquad:/i.test(line) || !/has created Squad/i.test(line)) return;
    const record = parseReplaySquadCreateLine(line, { serverId: workerData?.serverId, matchId: workerData?.matchId, sourceFile: sourcePath, sourceFileId, sourceOffset });
    if (!record) return;
    record.sourceMode = "replay";
    record.isReplay = true;
    record.canTriggerActions = false;
    batch.push(record);
    squadCreatesFound += 1;
    if (batch.length >= BATCH_SIZE) flush();
  }
  function flush() { if (batch.length) { parentPort?.postMessage({ type: "squadCreateBatch", records: batch }); batch = []; } }
}
function makeFileId(stat) { const ino=String(stat?.ino??0), dev=String(stat?.dev??0); return ino !== "0" ? `${dev}:${ino}` : `${dev}:0:${Math.trunc(Number(stat?.ctimeMs)||0)}`; }

async function findLastRoundBoundaryOffset(handle, cutoff) {
  let end = cutoff;
  let suffix = Buffer.alloc(0);
  while (end > 0) {
    const start = Math.max(0, end - READ_CHUNK_BYTES);
    const length = end - start;
    const buffer = Buffer.allocUnsafe(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    if (!bytesRead) break;
    const chunk = buffer.subarray(0, bytesRead);
    const blob = suffix.length ? Buffer.concat([chunk, suffix]) : chunk;
    let cursor = 0;
    let found = null;
    while (cursor < blob.length) {
      const newline = blob.indexOf(0x0a, cursor);
      const lineEnd = newline < 0 ? blob.length : newline;
      let lineBytes = blob.subarray(cursor, lineEnd);
      if (lineBytes.at(-1) === 0x0d) lineBytes = lineBytes.subarray(0, -1);
      if (isCurrentRoundBoundary(lineBytes.toString("utf8"))) found = start + cursor;
      if (newline < 0) break;
      cursor = newline + 1;
    }
    if (found != null) return found;
    suffix = Buffer.from(chunk.subarray(0, Math.min(1024, chunk.length)));
    end = start;
  }
  return null;
}

function isCurrentRoundBoundary(line) {
  const text = String(line ?? "");
  return /LogWorld:\s+(?:SeamlessTravel to:|Bringing World\s+\S+\s+up for play)/i.test(text)
    || /(?:^|\W)(?:GAME_START|MATCH_START|ROUND_START|NEW_GAME)(?:\W|$)/i.test(text);
}
