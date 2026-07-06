import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("./index.js", import.meta.url), "utf8");

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function extractDelimitedSceneSection(text, startToken, endToken) {
  const sourceText = String(text ?? "");
  const start = sourceText.indexOf(startToken);
  if (start < 0) return "";
  const contentStart = start + startToken.length;
  const end = endToken ? sourceText.indexOf(endToken, contentStart) : -1;
  return sourceText.slice(contentStart, end >= 0 ? end : sourceText.length).trim();
}

function extractBraceItems(text) {
  const items = [];
  const sourceText = String(text ?? "");
  let depth = 0;
  let itemStart = -1;
  for (let index = 0; index < sourceText.length; index += 1) {
    const char = sourceText[index];
    if (char === "{") {
      if (depth === 0) itemStart = index + 1;
      depth += 1;
      continue;
    }
    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && itemStart >= 0) {
        items.push(sourceText.slice(itemStart, index));
        itemStart = -1;
      }
    }
  }
  return items;
}

function parseVectorBlock(text) {
  const match = String(text ?? "").match(/X=([-0-9.]+)\s+Y=([-0-9.]+)\s+Z=([-0-9.]+)/);
  if (!match) return null;
  return {
    x: toFiniteNumber(match[1]),
    y: toFiniteNumber(match[2]),
    z: toFiniteNumber(match[3]),
  };
}

function parseMainZones(text) {
  const section = extractDelimitedSceneSection(text, "MainZone:", "");
  if (!section) return [];
  return extractBraceItems(section)
    .map((raw) => {
      const commaIndex = raw.indexOf(",");
      const teamText = commaIndex >= 0 ? raw.slice(0, commaIndex) : raw;
      const vectorText = commaIndex >= 0 ? raw.slice(commaIndex + 1) : "";
      return {
        teamId: toFiniteNumber(teamText),
        position: parseVectorBlock(vectorText),
        raw,
      };
    })
    .filter((zone) => zone.teamId != null || zone.position);
}

const sample = "[2026.07.06-14.02.22:663][ 64]PIE: CPZ:{C1-ShevchenkoQuarry,false,0.701456,1}{C2-AirfieldHangars,true,0.0,0}{C3-AirfieldAdmin,true,0.0,0}{C4-NovoOutskirts,true,0.0,0}{C5-NovoRidgeline,true,0.0,0}{C6-Yevhinivka,true,0.0,0}{C7-PetrivkaOverpass,false,0.012815,2},FOBI:,MainZone:{1,X=-228807.125 Y=210338.734 Z=4547.775}{2,X=164734.359 Y=-227469.688 Z=9763.213}";
const zones = parseMainZones(sample);

assert.equal(zones.length, 2);
assert.deepEqual(zones[0], {
  teamId: 1,
  position: { x: -228807.125, y: 210338.734, z: 4547.775 },
  raw: "1,X=-228807.125 Y=210338.734 Z=4547.775",
});
assert.deepEqual(zones[1], {
  teamId: 2,
  position: { x: 164734.359, y: -227469.688, z: 9763.213 },
  raw: "2,X=164734.359 Y=-227469.688 Z=9763.213",
});

console.log("mainzone parse ok");
