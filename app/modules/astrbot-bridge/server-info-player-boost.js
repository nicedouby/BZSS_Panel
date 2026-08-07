// -*- coding: utf-8 -*-

import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const SHARP_BUNDLE_ROOT = "C:/Users/12703/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules";
const sharpRequire = createRequire(import.meta.url);
let sharpLoaderPromise = null;

export async function applyServerInfoSnapshotPlayerBoost({ result, serverInfo } = {}) {
  if (!result?.ok || !Buffer.isBuffer(result?.png) || result.png.length === 0) return result;

  const population = serverInfo?.population ?? {};
  const actualPlayers = normalizeNonNegativeInteger(population.players);
  const maxPlayers = normalizePositiveInteger(population.maxPlayers);
  const requestedAddedPlayers = randomIntegerInclusive(3, 8);
  const displayedPlayers = maxPlayers > 0
    ? Math.min(maxPlayers, actualPlayers + requestedAddedPlayers)
    : actualPlayers + requestedAddedPlayers;

  try {
    const sharp = await loadSharp();
    const overlay = Buffer.from(
      renderPlayerCountOverlay({
        displayedPlayers,
        maxPlayers,
      }),
      "utf8",
    );
    const png = await sharp(result.png)
      .composite([{ input: overlay, left: 0, top: 0 }])
      .png()
      .toBuffer();

    const filePath = String(result?.file_path ?? result?.filePath ?? "").trim();
    if (filePath) {
      try {
        await fs.writeFile(filePath, png);
      } catch {
        // Returning the generated PNG is more important than refreshing the cache.
      }
    }

    return {
      ...result,
      png,
      artifact: result?.artifact
        ? {
            ...result.artifact,
            content: png,
          }
        : result?.artifact,
      displayPopulation: {
        actualPlayers,
        displayedPlayers,
        addedPlayers: Math.max(0, displayedPlayers - actualPlayers),
        requestedAddedPlayers,
        maxPlayers: maxPlayers || null,
      },
    };
  } catch {
    // Snapshot delivery must not fail if the display-only overlay cannot be rendered.
    return result;
  }
}

function renderPlayerCountOverlay({ displayedPlayers, maxPlayers }) {
  const playersText = String(displayedPlayers);
  const capacityText = maxPlayers > 0 ? `${displayedPlayers}/${maxPlayers}` : playersText;

  return `
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <style><![CDATA[
      .snapshot-value {
        font-family: 'Cascadia Mono','Consolas',monospace;
        font-size: 23px;
        font-weight: 900;
        fill: #ffffff;
      }
    ]]></style>
    <rect x="940" y="94" width="116" height="30" rx="2" fill="#07111f"/>
    <rect x="1104" y="94" width="120" height="30" rx="2" fill="#07111f"/>
    <text x="944" y="115" class="snapshot-value">${playersText}</text>
    <text x="1108" y="115" class="snapshot-value">${capacityText}</text>
  </svg>`;
}

function randomIntegerInclusive(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function normalizeNonNegativeInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function normalizePositiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

async function loadSharp() {
  if (!sharpLoaderPromise) {
    const sharpRoots = [
      String(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? "").trim(),
      SHARP_BUNDLE_ROOT,
    ].filter(Boolean);
    process.env.NODE_PATH = [
      ...sharpRoots,
      ...sharpRoots.map((root) => path.join(root, ".pnpm", "node_modules")),
      process.env.NODE_PATH || "",
    ]
      .filter(Boolean)
      .join(path.delimiter);
    sharpRequire("module")._initPaths();
    sharpLoaderPromise = Promise.resolve().then(() => sharpRequire("sharp"));
  }
  return sharpLoaderPromise;
}
