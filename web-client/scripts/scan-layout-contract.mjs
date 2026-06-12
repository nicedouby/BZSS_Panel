import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:\/)/, "$1");
const pagesDir = join(root, "src", "pages");

const blockedPatterns = [
  /\b100vh\b/,
  /\b100dvh\b/,
  /calc\(100vh/i,
  /calc\(100dvh/i,
  /height:\s*(400|600|700|760)px/i,
  /max-height:\s*60vh/i,
];

const allowedFiles = new Set([
  "src/pages/LoginPage.vue",
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
for (const file of listVueFiles(pagesDir)) {
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

if (hits.length) {
  console.log("Layout contract scan found viewport or fixed-height page rules:");
  for (const hit of hits) console.log(`- ${hit}`);
  process.exitCode = 1;
} else {
  console.log("Layout contract scan passed for web-client/src/pages.");
}
