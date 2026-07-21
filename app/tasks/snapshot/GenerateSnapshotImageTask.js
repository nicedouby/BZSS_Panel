import fs from "node:fs/promises";
import path from "node:path";
import { generateMatchEndSnapshotBundle } from "../../plugins/match-end-snapshot-pages.js";
import { applyMatchEndSnapshotVisualTheme } from "./MatchEndSnapshotVisualTheme.js";

export async function execute(task, { reportProgress } = {}) {
  const payload = task.payload?.payload;
  const snapshotId = String(task.payload?.snapshotId ?? "");
  if (!payload || !snapshotId) throw new Error("Snapshot task payload is incomplete.");

  const directory = path.resolve(process.cwd(), task.payload?.snapshotDirectory ?? "data/match-end-snapshots");
  await fs.mkdir(directory, { recursive: true });
  reportProgress?.(5);

  const rawBundle = await generateMatchEndSnapshotBundle(payload, { snapshotId });
  reportProgress?.(68);
  const bundle = await applyMatchEndSnapshotVisualTheme(rawBundle, payload);
  reportProgress?.(84);

  for (const page of bundle.pages ?? []) {
    await writeBufferAtomic(path.join(directory, page.fileName), page.buffer);
  }
  const cover = bundle.pages?.find((page) => page.type === "cover") ?? bundle.pages?.[0];
  if (cover?.buffer) await writeBufferAtomic(path.join(directory, snapshotId + ".png"), cover.buffer);
  await writeBufferAtomic(path.join(directory, snapshotId + "-combined.png"), bundle.combinedBuffer);
  await writeJsonAtomic(path.join(directory, snapshotId + "-manifest.json"), bundle.manifest);
  reportProgress?.(100);
  return {
    snapshotId,
    pageCount: bundle.pages?.length ?? 0,
    primaryImage: snapshotId + ".png",
    combinedImage: snapshotId + "-combined.png",
    manifest: snapshotId + "-manifest.json",
    pages: bundle.manifest?.pages ?? [],
  };
}

async function writeBufferAtomic(target, buffer) {
  const temp = target + ".tmp";
  await fs.writeFile(temp, buffer);
  await fs.rename(temp, target);
}

async function writeJsonAtomic(target, value) {
  const temp = target + ".tmp";
  await fs.writeFile(temp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(temp, target);
}
