#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const mapsDirectory = path.join(workspaceRoot, "maps");
const publicDirectory = path.join(workspaceRoot, "web-client", "public");
const mapSceneDirectory = path.join(workspaceRoot, "MapScene");
const qualityIndex = process.argv.indexOf("--quality");
const quality = qualityIndex >= 0 ? Number(process.argv[qualityIndex + 1]) : 93;

if (!Number.isInteger(quality) || quality < 80 || quality > 100) {
  throw new Error("--quality must be an integer from 80 through 100.");
}

const sourceNames = (await fs.readdir(mapsDirectory))
  .filter((name) => /_Minimap\.PNG$/i.test(name))
  .sort((left, right) => left.localeCompare(right));
const converted = [];

for (const sourceName of sourceNames) {
  const sourcePath = path.join(mapsDirectory, sourceName);
  const mapOutputPath = path.join(mapsDirectory, sourceName.replace(/\.PNG$/i, ".webp"));
  const publicSourcePath = path.join(publicDirectory, sourceName);
  const publicOutputPath = path.join(publicDirectory, sourceName.replace(/\.PNG$/i, ".webp"));
  const outputTempPath = `${mapOutputPath}.${process.pid}.tmp`;
  const sourceStat = await fs.stat(sourcePath);
  const imageInfo = await sharp(sourcePath)
    .webp({ quality, effort: 4, alphaQuality: 100 })
    .toFile(outputTempPath);
  if (!imageInfo.width || !imageInfo.height) {
    await fs.rm(outputTempPath, { force: true });
    throw new Error(`Could not verify converted image: ${sourceName}`);
  }
  await fs.rename(outputTempPath, mapOutputPath);

  try {
    await fs.access(publicSourcePath);
    const publicTempPath = `${publicOutputPath}.${process.pid}.tmp`;
    await fs.copyFile(mapOutputPath, publicTempPath);
    await fs.rename(publicTempPath, publicOutputPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const outputStat = await fs.stat(mapOutputPath);
  converted.push({ sourceName, sourceBytes: sourceStat.size, outputBytes: outputStat.size });
  console.log(`${sourceName}: ${sourceStat.size} -> ${outputStat.size} bytes`);
}

for (const { sourceName } of converted) {
  await fs.rm(path.join(mapsDirectory, sourceName), { force: true });
  await fs.rm(path.join(publicDirectory, sourceName), { force: true });
}

const sourceBytes = converted.reduce((sum, entry) => sum + entry.sourceBytes, 0);
const outputBytes = converted.reduce((sum, entry) => sum + entry.outputBytes, 0);
console.log(`Converted ${converted.length} minimaps at WebP quality ${quality}.`);
if (sourceBytes > 0) {
  console.log(`Maps folder size reduction: ${sourceBytes - outputBytes} bytes (${Math.round((1 - outputBytes / sourceBytes) * 100)}%).`);
}

let sceneNames = [];
try {
  sceneNames = (await fs.readdir(mapSceneDirectory)).filter((name) => /^LoadingScreen_.+\.PNG$/i.test(name));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const convertedScenes = [];
for (const sourceName of sceneNames) {
  const sourcePath = path.join(mapSceneDirectory, sourceName);
  const outputPath = path.join(mapSceneDirectory, sourceName.replace(/\.PNG$/i, ".webp"));
  const tempPath = `${outputPath}.${process.pid}.tmp`;
  const sourceStat = await fs.stat(sourcePath);
  const imageInfo = await sharp(sourcePath)
    .webp({ quality, effort: 4, alphaQuality: 100 })
    .toFile(tempPath);
  if (!imageInfo.width || !imageInfo.height) {
    await fs.rm(tempPath, { force: true });
    throw new Error(`Could not verify converted image: ${sourceName}`);
  }
  await fs.rename(tempPath, outputPath);
  const outputStat = await fs.stat(outputPath);
  convertedScenes.push({ sourceName, sourceBytes: sourceStat.size, outputBytes: outputStat.size });
  console.log(`${sourceName}: ${sourceStat.size} -> ${outputStat.size} bytes`);
}

for (const { sourceName } of convertedScenes) {
  await fs.rm(path.join(mapSceneDirectory, sourceName), { force: true });
}

const sceneSourceBytes = convertedScenes.reduce((sum, entry) => sum + entry.sourceBytes, 0);
const sceneOutputBytes = convertedScenes.reduce((sum, entry) => sum + entry.outputBytes, 0);
console.log(`Converted ${convertedScenes.length} loading screens at WebP quality ${quality}.`);
if (sceneSourceBytes > 0) {
  console.log(`MapScene size reduction: ${sceneSourceBytes - sceneOutputBytes} bytes (${Math.round((1 - sceneOutputBytes / sceneSourceBytes) * 100)}%).`);
}
