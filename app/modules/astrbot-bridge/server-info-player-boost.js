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
    const overlays = renderPlayerCountOverlays({
      displayedPlayers,
      maxPlayers,
    });
    const png = await sharp(result.png)
      .composite(overlays)
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

function renderPlayerCountOverlays({ displayedPlayers, maxPlayers }) {
  const playersText = String(displayedPlayers);
  const capacityText = maxPlayers > 0 ? `${displayedPlayers}/${maxPlayers}` : playersText;

  return [
    {
      input: renderValuePatch(playersText, 116),
      left: 940,
      top: 94,
    },
    {
      input: renderValuePatch(capacityText, 120),
      left: 1104,
      top: 94,
    },
  ];
}

function renderValuePatch(value, width) {
  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="30" viewBox="0 0 ${width} 30">
    <rect width="${width}" height="30" rx="2" fill="#07111f"/>
    <text
      x="4"
      y="21"
      font-family="Cascadia Mono,Consolas,monospace"
      font-size="23"
      font-weight="900"
      fill="#ffffff"
    >${escapeXml(value)}</text>
  </svg>`, "utf8");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
