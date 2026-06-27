import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { TextDecoder } from "node:util";

const rootDir = process.cwd();
const decoder = new TextDecoder("utf-8", { fatal: true });
let countFiles = 0;
const includeExtensions = new Set([
  ".bat",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".py",
  ".ts",
  ".txt",
  ".vue",
  ".yaml",
  ".yml",
  ".editorconfig",
]);
const ignoreDirs = new Set([
  ".git",
  ".idea",
  ".vscode",
  "build",
  "coverage",
  "dist",
  "release",
  "node_modules",
  "__pycache__",
]);

const issues = [];

await walk(rootDir);

if (issues.length > 0) {
  for (const issue of issues) {
    console.error(`${issue.file}:${issue.line}: ${issue.message}`);
  }
  process.exit(1);
}

console.log(`Encoding check passed (${countFiles} files).`);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath);
      continue;
    }

    if (!isTrackedTextFile(entry.name)) continue;
    countFiles += 1;
    await checkFile(fullPath);
  }
}

function isTrackedTextFile(name) {
  const lower = name.toLowerCase();
  if (lower === ".editorconfig") return true;
  const ext = path.extname(lower);
  return includeExtensions.has(ext);
}

async function checkFile(filePath) {
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    issues.push({ file: relative(filePath), line: 1, message: `unable to read file: ${error.message}` });
    return;
  }

  let text;
  try {
    text = decoder.decode(buffer);
  } catch {
    issues.push({ file: relative(filePath), line: 1, message: "invalid UTF-8 encoding" });
    return;
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.includes("\uFFFD")) {
      issues.push({ file: relative(filePath), line: index + 1, message: "contains replacement character U+FFFD" });
      return;
    }
    if (/[\uE000-\uF8FF]/.test(line)) {
      issues.push({ file: relative(filePath), line: index + 1, message: "contains private-use Unicode characters, likely from encoding corruption" });
      return;
    }
  }
}

function relative(filePath) {
  return path.relative(rootDir, filePath).replaceAll("\\", "/");
}
