#!/usr/bin/env node
/**
 * generate-map-tiles.mjs
 *
 * Slices 4096×4096 Squad minimap PNGs into a multi-zoom-level tile pyramid.
 *
 * Tile Structure:
 *   public/map-tiles/{mapKey}/{z}/{x}_{y}.jpg
 *
 * Zoom Levels (tile size = 256×256):
 *   z0 → 1×1   (256px total  — thumbnail)
 *   z1 → 2×2   (512px total)
 *   z2 → 4×4   (1024px total)
 *   z3 → 8×8   (2048px total)
 *   z4 → 16×16 (4096px total — full detail)
 *
 * Usage:
 *   node tools/generate-map-tiles.mjs [--force] [--quality 85] [--map Sumari]
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// ── Config ──────────────────────────────────────────────────────────────────

const TILE_SIZE = 256;
const MAX_ZOOM = 4; // z0..z4 → 2^z tiles per axis
const DEFAULT_QUALITY = 85;

const PUBLIC_DIR = path.resolve(import.meta.dirname, "..", "web-client", "public");
const TILES_DIR = path.join(PUBLIC_DIR, "map-tiles");

/**
 * Map key → source PNG filename (must match tactical-map-data.ts MAP_IMAGE_BY_KEY)
 */
const MAP_FILES = {
  Anvil_RAAS_v1:        "Anvil_Minimap.PNG",
  Belaya_RAAS_v1:       "Belaya_Minimap.PNG",
  Chora_RAAS_v1:        "Chora_Minimap.PNG",
  Fallujah_RAAS_v1:     "T_Fallujah_Minimap.PNG",
  FoolsRoad_RAAS_v1:    "Fools_Road_Minimap.PNG",
  GooseBay_RAAS_v1:     "GooseBay_Minimap.PNG",
  Gorodok_RAAS_v1:      "gorodok_minimap.PNG",
  Kamdesh_RAAS_v1:      "Kamdesh_Minimap.PNG",
  Kohat_RAAS_v1:        "kohat_minimap.PNG",
  Kokan_RAAS_v1:        "T_Kokan_Minimap.PNG",
  Lashkar_RAAS_v1:      "T_Lashkar_Minimap.PNG",
  Logar_RAAS_v1:        "Logar_Valley_Minimap.PNG",
  Manicouagan_RAAS_v1:  "T_Manicouagan_Minimap.PNG",
  Mestia_RAAS_v1:       "T_Mestia_Minimap.PNG",
  Mutaha_RAAS_v1:       "Mutaha_Minimap.PNG",
  Narva_RAAS_v1:        "Narva_Minimap.PNG",
  Skorpo_RAAS_v1:       "Skorpo_Minimap.PNG",
  Sumari_RAAS_v1:       "Sumari_Minimap.PNG",
  Tallil_RAAS_v1:       "Tallil_Outskirts_Minimap.PNG",
  Yehorivka_RAAS_v1:    "Yehorivka_Minimap.PNG",
};

// ── CLI ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const force = args.includes("--force");

let quality = DEFAULT_QUALITY;
const qIdx = args.indexOf("--quality");
if (qIdx !== -1 && args[qIdx + 1]) {
  quality = Math.max(10, Math.min(100, parseInt(args[qIdx + 1], 10)));
}

let filterMap = null;
const mIdx = args.indexOf("--map");
if (mIdx !== -1 && args[mIdx + 1]) {
  filterMap = args[mIdx + 1].toLowerCase();
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🗺️  Map Tile Generator`);
  console.log(`   Tile size: ${TILE_SIZE}px | Zoom levels: 0-${MAX_ZOOM} | JPEG quality: ${quality}`);
  console.log(`   Output: ${TILES_DIR}\n`);

  await fsp.mkdir(TILES_DIR, { recursive: true });

  const entries = Object.entries(MAP_FILES);
  let processed = 0;
  let skipped = 0;

  for (const [mapKey, fileName] of entries) {
    if (filterMap && !mapKey.toLowerCase().includes(filterMap)) {
      continue;
    }

    const srcPath = path.join(PUBLIC_DIR, fileName);
    if (!fs.existsSync(srcPath)) {
      console.log(`   ⚠️  SKIP ${mapKey}: source file not found (${fileName})`);
      skipped++;
      continue;
    }

    const mapTileDir = path.join(TILES_DIR, mapKey);
    const doneMarker = path.join(mapTileDir, ".done");

    if (!force && fs.existsSync(doneMarker)) {
      const srcStat = await fsp.stat(srcPath);
      const doneStat = await fsp.stat(doneMarker);
      if (doneStat.mtimeMs >= srcStat.mtimeMs) {
        console.log(`   ✅ SKIP ${mapKey}: tiles already up-to-date`);
        skipped++;
        continue;
      }
    }

    console.log(`   🔄 Processing ${mapKey} (${fileName})...`);
    const start = Date.now();
    await generateTiles(mapKey, srcPath, quality);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`   ✅ ${mapKey} completed in ${elapsed}s`);
    processed++;
  }

  console.log(`\n   Done! Processed: ${processed}, Skipped: ${skipped}\n`);
}

// ── Tile Generation ─────────────────────────────────────────────────────────

async function generateTiles(mapKey, srcPath, jpegQuality) {
  const mapTileDir = path.join(TILES_DIR, mapKey);

  // Clean existing tiles for this map
  if (fs.existsSync(mapTileDir)) {
    await fsp.rm(mapTileDir, { recursive: true, force: true });
  }

  // Load the source image once
  const srcBuffer = await fsp.readFile(srcPath);
  const metadata = await sharp(srcBuffer).metadata();
  const srcWidth = metadata.width;
  const srcHeight = metadata.height;

  if (!srcWidth || !srcHeight) {
    throw new Error(`Cannot read dimensions for ${srcPath}`);
  }

  console.log(`      Source: ${srcWidth}×${srcHeight}`);

  for (let z = 0; z <= MAX_ZOOM; z++) {
    const tilesPerAxis = Math.pow(2, z);
    const levelSize = TILE_SIZE * tilesPerAxis; // total pixel size at this level

    const zDir = path.join(mapTileDir, String(z));
    await fsp.mkdir(zDir, { recursive: true });

    // Resize the source image to this zoom level's total size
    const resizedBuffer = await sharp(srcBuffer)
      .resize(levelSize, levelSize, {
        fit: "fill",
        kernel: z < 2 ? sharp.kernel.lanczos3 : sharp.kernel.lanczos2,
      })
      .toBuffer();

    // Extract tiles
    const promises = [];
    for (let y = 0; y < tilesPerAxis; y++) {
      for (let x = 0; x < tilesPerAxis; x++) {
        const left = x * TILE_SIZE;
        const top = y * TILE_SIZE;
        const tilePath = path.join(zDir, `${x}_${y}.jpg`);

        const p = sharp(resizedBuffer, {
          raw: undefined, // let sharp detect the format from buffer
        })
          .extract({
            left,
            top,
            width: TILE_SIZE,
            height: TILE_SIZE,
          })
          .jpeg({ quality: jpegQuality, mozjpeg: true })
          .toFile(tilePath);

        promises.push(p);
      }
    }

    await Promise.all(promises);
    console.log(`      z${z}: ${tilesPerAxis}×${tilesPerAxis} = ${tilesPerAxis * tilesPerAxis} tiles`);
  }

  // Write a done marker for incremental builds
  await fsp.writeFile(
    path.join(mapTileDir, ".done"),
    JSON.stringify({
      mapKey,
      maxZoom: MAX_ZOOM,
      tileSize: TILE_SIZE,
      quality: jpegQuality,
      generatedAt: new Date().toISOString(),
    }),
  );
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
