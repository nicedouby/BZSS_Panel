import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1");
const scanDirs = [
  join(root, "src", "pages"),
  join(root, "src", "components"),
];

const blockedPatterns = [
  /\b100vh\b/,
  /\b100dvh\b/,
  /calc\(100vh/i,
  /calc\(100dvh/i,
  /(^|[;\s{])height:\s*(400|600|700|760)px/i,
  /max-height:\s*60vh/i,
];

const allowedFiles = new Set([
  "src/pages/LoginPage.vue",
  "src/components/layout/AppLayout.vue",
  "src/components/layout/Sidebar.vue",
  "src/components/tactical-map/TiledMapRenderer.vue",
]);

function listVueFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) files.push(...listVueFiles(path));
    else if (entry.endsWith(".vue")) files.push(path);
  }
  return files;
}

const hits = [];
for (const scanDir of scanDirs) {
for (const file of listVueFiles(scanDir)) {
  const rel = relative(root, file).replaceAll("\\", "/");
  if (allowedFiles.has(rel)) continue;

  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of blockedPatterns) {
      if (!pattern.test(line)) continue;
      hits.push(`${rel}:${index + 1}: ${line.trim()}`);
      break;
    }
  });
}
}

if (hits.length) {
  console.log("Layout contract scan found viewport or fixed-height layout rules:");
  for (const hit of hits) console.log(`- ${hit}`);
  process.exitCode = 1;
} else {
  console.log("Layout contract scan passed for web-client/src/pages and src/components.");
}
