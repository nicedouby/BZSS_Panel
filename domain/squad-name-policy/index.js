// -*- coding: utf-8 -*-

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  classifySquadName,
  SQUAD_NATURE,
  SQUAD_NATURE_LABEL,
} from "../squad/squad_name_classifier.js";

const DEFAULT_POLICY_PATH = path.resolve(process.cwd(), "config", "squad_name_policy.json");
const DEFAULT_SUGGESTION_LIMIT = 5;
const MAX_SUGGESTION_LIMIT = 50;
const ALGORITHM_THRESHOLD = 0.42;
const ADMIN_SQUAD_NAMES = Object.freeze([
  "op",
  "admin",
  "管理员",
  "管理员小队",
]);
const DEFAULT_NAME_PATTERNS = Object.freeze([
  "^squad\\s*\\d+$",
  "^小队\\s*\\d+$",
  "^队伍\\s*\\d+$",
  "^team\\s*\\d+$",
]);

export function resolveSquadNamePolicyPath(configManager = null) {
  const configured = String(configManager?.get?.("squadNamePolicy.path") ?? "").trim();
  if (!configured) return DEFAULT_POLICY_PATH;
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

export function loadSquadNamePolicy(configManager = null) {
  const policyPath = resolveSquadNamePolicyPath(configManager);
  try {
    const raw = fs.readFileSync(policyPath, "utf8");
    return normalizePolicyDocument(JSON.parse(raw), { policyPath });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return normalizePolicyDocument(createEmptyPolicyDocument(), { policyPath });
    }
    throw error;
  }
}

export async function readSquadNamePolicyState(configManager = null) {
  const policy = loadSquadNamePolicy(configManager);
  return buildPolicyState(policy);
}

export async function saveSquadNamePolicyState(configManager = null, nextPolicy = {}) {
  const policyPath = resolveSquadNamePolicyPath(configManager);
  const previous = loadSquadNamePolicy(configManager);
  const normalized = normalizePolicyDocument({
    ...previous,
    ...nextPolicy,
    source: nextPolicy.source ?? previous.source,
    entries: nextPolicy.entries,
    suggestionLimit: nextPolicy.suggestionLimit ?? nextPolicy.config?.suggestionLimit ?? previous.suggestionLimit,
    updatedAt: new Date().toISOString(),
  }, { policyPath });

  await fsp.mkdir(path.dirname(policyPath), { recursive: true });
  await fsp.writeFile(policyPath, `${JSON.stringify(serializePolicy(normalized), null, 2)}\n`, "utf8");
  return buildPolicyState(normalized);
}

export function testSquadNamePolicy(rawName, policyOrConfig = null) {
  const policy = isPolicyDocument(policyOrConfig)
    ? normalizePolicyDocument(policyOrConfig, { policyPath: policyOrConfig.policyPath })
    : loadSquadNamePolicy(policyOrConfig);
  return evaluateSquadName(rawName, policy);
}

export function evaluateSquadName(rawName, policy) {
  const input = String(rawName ?? "");
  const normalizedInput = normalizePolicyName(input);
  const strippedInput = stripSquadSuffix(input);
  const normalizedStrippedInput = normalizePolicyName(strippedInput);
  const suffixStripped = normalizedInput !== normalizedStrippedInput;
  const suggestionLimit = normalizeSuggestionLimit(policy.suggestionLimit);
  const indexes = buildPolicyIndexes(policy);

  if (!normalizedInput) {
    return {
      ok: true,
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      valid: false,
      reason: "Squad name is empty.",
      matched: null,
      suggestions: [],
      keywordSuggestions: [],
      algorithmSuggestions: [],
      warningMessage: "",
    };
  }

  const defaultMatch = matchDefaultNamePattern(normalizedInput, policy.defaultNamePatterns);
  if (defaultMatch) {
    return buildAllowedNameResult({
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      name: input.trim(),
      kind: "default",
      label: "Default squad name",
      reason: `Matched default squad name pattern: ${defaultMatch.pattern}`,
      matchedValue: defaultMatch.pattern,
    });
  }

  const adminMatch = matchAdminSquadName(normalizedInput);
  if (adminMatch) {
    return buildAllowedNameResult({
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      name: input.trim(),
      kind: "admin",
      label: "Admin squad name",
      reason: "Matched admin squad name.",
      matchedValue: adminMatch,
      classification: buildClassification("admin", "管理员小队", "Matched admin squad name."),
    });
  }

  const infantryMatch = indexes.infantryNameIndex.get(normalizedInput);
  if (infantryMatch) {
    return buildAllowedNameResult({
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      name: infantryMatch.name,
      kind: infantryMatch.kind,
      label: infantryMatch.kind === "special_infantry" ? "Special infantry squad name" : "Infantry squad name",
      reason: infantryMatch.kind === "special_infantry"
        ? "Matched special infantry whitelist."
        : "Matched infantry whitelist.",
      matchedValue: infantryMatch.name,
      classification: buildClassification(
        infantryMatch.kind,
        infantryMatch.kind === "special_infantry" ? "特种步兵队" : "步兵队",
        infantryMatch.kind === "special_infantry"
          ? "Matched special infantry whitelist."
          : "Matched infantry whitelist.",
      ),
    });
  }

  const exactMatch = indexes.nameIndex.get(normalizedInput);
  if (exactMatch && !suffixStripped) {
    return {
      ok: true,
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      valid: true,
      reason: exactMatch.kind === "canonical" ? "Matched canonical vehicle name." : "Matched vehicle alias.",
      matched: buildVehicleMatch(exactMatch.entry, exactMatch.kind, exactMatch.value),
      suggestions: [],
      keywordSuggestions: [],
      algorithmSuggestions: [],
      warningMessage: "",
    };
  }

  const inferredClassification = inferNonVehicleClassification(input, normalizedInput, normalizedStrippedInput);
  if (inferredClassification) {
    return {
      ok: true,
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      valid: false,
      reason: inferredClassification.reason,
      matched: null,
      suggestions: [],
      keywordSuggestions: [],
      algorithmSuggestions: [],
      warningMessage: "",
      classification: inferredClassification,
    };
  }

  const suggestionKey = normalizedStrippedInput || normalizedInput;
  const keywordSuggestions = buildKeywordSuggestions(suggestionKey, indexes, suggestionLimit);
  const algorithmSuggestions = buildAlgorithmSuggestions(suggestionKey, indexes, suggestionLimit, new Set(keywordSuggestions.map((item) => item.id)));
  const suggestions = mergeSuggestions(keywordSuggestions, algorithmSuggestions, suggestionLimit);
  const warningMessage = suggestions.length
    ? `你可能想建立 ${suggestions.map((item) => item.name).join(" ")} 队。`
    : "";

  return {
    ok: true,
    input,
    normalizedInput,
    normalizedStrippedInput,
    suffixStripped,
    valid: false,
    reason: suffixStripped
      ? "Squad suffix is not accepted as a valid vehicle squad name."
      : "No canonical vehicle name or alias matched.",
    matched: null,
    suggestions,
    keywordSuggestions,
    algorithmSuggestions,
    warningMessage,
    classification: null,
  };
}

function buildAllowedNameResult({
  input,
  normalizedInput,
  normalizedStrippedInput,
  suffixStripped,
  name,
  kind,
  label,
  reason,
  matchedValue,
  classification = null,
}) {
  return {
    ok: true,
    input,
    normalizedInput,
    normalizedStrippedInput,
    suffixStripped,
    valid: true,
    reason,
    matched: {
      id: `${kind}:${normalizePolicyName(name || matchedValue)}`,
      name,
      faction: "",
      vehicleType: label,
      asset: "",
      aliases: [],
      keywords: [],
      matchedKind: kind,
      matchedValue,
      policyKind: kind,
      label,
    },
    suggestions: [],
    keywordSuggestions: [],
    algorithmSuggestions: [],
    warningMessage: "",
    classification,
  };
}

function matchAdminSquadName(normalizedInput) {
  for (const name of ADMIN_SQUAD_NAMES) {
    if (normalizePolicyName(name) === normalizedInput) return name;
  }
  return null;
}

function inferNonVehicleClassification(input, normalizedInput, normalizedStrippedInput) {
  const classifier = classifySquadName(input, { includeDebug: false });
  if (classifier.nature === SQUAD_NATURE.INFANTRY) {
    return buildClassification("infantry", SQUAD_NATURE_LABEL.infantry, "已认定为步兵队，跳过载具建议。");
  }
  if (isNumericOnlyName(normalizedStrippedInput || normalizedInput)) {
    return buildClassification("infantry", SQUAD_NATURE_LABEL.infantry, "数字队名已认定为步兵队，跳过载具建议。");
  }
  if (containsChinese(input) && classifier.nature === SQUAD_NATURE.OTHER) {
    return buildClassification("infantry", SQUAD_NATURE_LABEL.infantry, "奇葩中文队名已认定为步兵队，跳过载具建议。");
  }
  return null;
}

function buildClassification(nature, label, reason) {
  return { nature, label, reason };
}

function isNumericOnlyName(value) {
  return /^\d{1,4}$/.test(String(value ?? "").trim());
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value ?? ""));
}

export function normalizePolicyName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_]+/g, "")
    .replace(/[()（）[\]【】]/g, "");
}

export function stripSquadSuffix(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s*(?:小队|队伍|队|squad|team)\s*$/iu, "")
    .trim();
}

export function normalizePolicyDocument(rawPolicy = {}, options = {}) {
  const source = rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy) ? rawPolicy : {};
  const entries = Array.isArray(source.entries) ? source.entries.map(normalizeEntry).filter(Boolean) : [];
  const withAutoKeywords = entries.map((entry) => ({
    ...entry,
    keywords: dedupeStrings([
      ...entry.keywords,
      ...inferKeywordsForEntry(entry),
    ]),
  }));

  return {
    version: Number(source.version ?? 1),
    policyPath: options.policyPath ?? source.policyPath ?? "",
    source: normalizeSource(source.source),
    importedAt: optionalString(source.importedAt),
    updatedAt: optionalString(source.updatedAt),
    suggestionLimit: normalizeSuggestionLimit(source.suggestionLimit ?? source.config?.suggestionLimit),
    defaultNamePatterns: dedupeStrings([
      ...DEFAULT_NAME_PATTERNS,
      ...asStringArray(source.defaultNamePatterns),
    ]),
    infantryNames: dedupeStrings(asStringArray(source.infantryNames)),
    specialInfantryNames: dedupeStrings(asStringArray(source.specialInfantryNames)),
    entries: withAutoKeywords,
  };
}

export function buildPolicyState(policy) {
  const normalized = normalizePolicyDocument(policy, { policyPath: policy.policyPath });
  return {
    ok: true,
    policyPath: normalized.policyPath,
    version: normalized.version,
    source: normalized.source,
    importedAt: normalized.importedAt,
    updatedAt: normalized.updatedAt,
    suggestionLimit: normalized.suggestionLimit,
    defaultNamePatterns: normalized.defaultNamePatterns,
    infantryNames: normalized.infantryNames,
    specialInfantryNames: normalized.specialInfantryNames,
    stats: buildPolicyStats(normalized),
    entries: normalized.entries,
  };
}

export function buildPolicyStats(policy) {
  const aliasCount = policy.entries.reduce((total, entry) => total + entry.aliases.length, 0);
  const keywordCount = policy.entries.reduce((total, entry) => total + entry.keywords.length, 0);
  const uniqueKeywords = new Set();
  for (const entry of policy.entries) {
    for (const keyword of entry.keywords) {
      const key = normalizePolicyName(keyword);
      if (key) uniqueKeywords.add(key);
    }
  }
  return {
    entries: policy.entries.length,
    infantryNames: policy.infantryNames.length,
    specialInfantryNames: policy.specialInfantryNames.length,
    defaultNamePatterns: policy.defaultNamePatterns.length,
    aliases: aliasCount,
    keywordCells: keywordCount,
    uniqueKeywords: uniqueKeywords.size,
    factions: new Set(policy.entries.map((entry) => entry.faction).filter(Boolean)).size,
    vehicleTypes: new Set(policy.entries.map((entry) => entry.vehicleType).filter(Boolean)).size,
  };
}

function buildPolicyIndexes(policy) {
  const nameIndex = new Map();
  const infantryNameIndex = new Map();
  const keywordIndex = new Map();
  const searchable = [];

  for (const name of policy.infantryNames) {
    const key = normalizePolicyName(name);
    if (key && !infantryNameIndex.has(key)) infantryNameIndex.set(key, { name, kind: "infantry" });
  }

  for (const name of policy.specialInfantryNames) {
    const key = normalizePolicyName(name);
    if (key) infantryNameIndex.set(key, { name, kind: "special_infantry" });
  }

  for (const entry of policy.entries) {
    const canonicalKey = normalizePolicyName(entry.name);
    if (canonicalKey && !nameIndex.has(canonicalKey)) {
      nameIndex.set(canonicalKey, { entry, kind: "canonical", value: entry.name });
    }
    if (canonicalKey) {
      searchable.push({ entry, value: entry.name, normalized: canonicalKey, kind: "canonical" });
    }

    for (const alias of entry.aliases) {
      const aliasKey = normalizePolicyName(alias);
      if (!aliasKey) continue;
      if (!nameIndex.has(aliasKey)) {
        nameIndex.set(aliasKey, { entry, kind: "alias", value: alias });
      }
      searchable.push({ entry, value: alias, normalized: aliasKey, kind: "alias" });
    }

    for (const keyword of entry.keywords) {
      const keywordKey = normalizePolicyName(keyword);
      if (!keywordKey) continue;
      if (!keywordIndex.has(keywordKey)) keywordIndex.set(keywordKey, []);
      keywordIndex.get(keywordKey).push(entry);
    }
  }

  return { nameIndex, infantryNameIndex, keywordIndex, searchable };
}

function matchDefaultNamePattern(normalizedInput, patterns = []) {
  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern, "i");
      if (regex.test(normalizedInput)) return { pattern };
    } catch {
      continue;
    }
  }
  return null;
}

function buildKeywordSuggestions(suggestionKey, indexes, limit) {
  const entries = indexes.keywordIndex.get(suggestionKey) ?? [];
  return entries.slice(0, limit).map((entry) => buildSuggestion(entry, {
    source: "keyword",
    score: 1,
    reason: "Keyword matched.",
  }));
}

function buildAlgorithmSuggestions(suggestionKey, indexes, limit, excludedIds = new Set()) {
  if (!suggestionKey) return [];
  const bestByEntry = new Map();

  for (const item of indexes.searchable) {
    if (!item.normalized || excludedIds.has(item.entry.id)) continue;
    const score = scoreCandidate(suggestionKey, item.normalized, item.entry);
    if (score < ALGORITHM_THRESHOLD) continue;
    const current = bestByEntry.get(item.entry.id);
    if (!current || score > current.score) {
      bestByEntry.set(item.entry.id, {
        entry: item.entry,
        score,
        matchedValue: item.value,
        matchedKind: item.kind,
      });
    }
  }

  return [...bestByEntry.values()]
    .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name, "en"))
    .slice(0, limit)
    .map((item) => buildSuggestion(item.entry, {
      source: "algorithm",
      score: Number(item.score.toFixed(3)),
      reason: `Similar to ${item.matchedValue}.`,
      matchedValue: item.matchedValue,
      matchedKind: item.matchedKind,
    }));
}

function scoreCandidate(inputKey, candidateKey, entry) {
  if (!inputKey || !candidateKey) return 0;
  if (inputKey === candidateKey) return 1;

  let score = 0;
  if (candidateKey.startsWith(inputKey) || inputKey.startsWith(candidateKey)) score = Math.max(score, 0.82);
  if (candidateKey.includes(inputKey) || inputKey.includes(candidateKey)) score = Math.max(score, 0.72);

  const inputLetters = inputKey.replace(/\d+/g, "");
  const candidateLetters = candidateKey.replace(/\d+/g, "");
  const inputNumbers = inputKey.match(/\d+/g)?.join("") ?? "";
  const candidateNumbers = candidateKey.match(/\d+/g)?.join("") ?? "";
  if (inputLetters && candidateLetters && (candidateLetters.startsWith(inputLetters) || inputLetters.startsWith(candidateLetters))) {
    score = Math.max(score, inputNumbers && candidateNumbers && inputNumbers === candidateNumbers ? 0.88 : 0.66);
  }

  const letterSimilarity = inputLetters && candidateLetters
    ? normalizedEditSimilarity(inputLetters, candidateLetters)
    : 0;
  if (inputNumbers && candidateNumbers && inputNumbers === candidateNumbers && sortChars(inputLetters) === sortChars(candidateLetters)) {
    score = Math.max(score, 0.91);
  }
  if (inputNumbers && candidateNumbers && inputNumbers === candidateNumbers && letterSimilarity >= 0.45) {
    score = Math.max(score, 0.78 + Math.min(0.12, letterSimilarity * 0.12));
  }
  if (inputNumbers && candidateNumbers && inputNumbers !== candidateNumbers && letterSimilarity < 0.9) {
    score = Math.min(score, 0.74);
  }

  const editSimilarity = normalizedEditSimilarity(inputKey, candidateKey);
  score = Math.max(score, editSimilarity * 0.92);

  const grams = diceCoefficient(inputKey, candidateKey);
  score = Math.max(score, grams * 0.86);

  for (const token of entry.searchTokens) {
    const tokenKey = normalizePolicyName(token);
    if (!tokenKey) continue;
    if (inputKey === tokenKey) score = Math.max(score, 0.78);
    else if (tokenKey.startsWith(inputKey) || inputKey.startsWith(tokenKey)) score = Math.max(score, 0.62);
  }

  return Math.min(1, score);
}

function mergeSuggestions(keywordSuggestions, algorithmSuggestions, limit) {
  const seen = new Set();
  const result = [];
  for (const item of [...keywordSuggestions, ...algorithmSuggestions]) {
    const key = normalizePolicyName(item.name) || item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= limit) break;
  }
  return result;
}

function sortChars(value) {
  return String(value ?? "").split("").sort().join("");
}

function buildVehicleMatch(entry, matchedKind, matchedValue) {
  return {
    ...entry,
    matchedKind,
    matchedValue,
  };
}

function buildSuggestion(entry, extra = {}) {
  return {
    id: entry.id,
    name: entry.name,
    faction: entry.faction,
    vehicleType: entry.vehicleType,
    asset: entry.asset,
    aliases: entry.aliases,
    keywords: entry.keywords,
    source: extra.source ?? "algorithm",
    score: extra.score ?? null,
    reason: extra.reason ?? "",
    matchedValue: extra.matchedValue ?? null,
    matchedKind: extra.matchedKind ?? null,
  };
}

function normalizeEntry(rawEntry) {
  const source = rawEntry && typeof rawEntry === "object" && !Array.isArray(rawEntry) ? rawEntry : {};
  const name = optionalString(source.name ?? source.vehicleName);
  if (!name) return null;
  const asset = optionalString(source.asset ?? source.vehicleAsset);
  const faction = optionalString(source.faction ?? source.factionName);
  const vehicleType = optionalString(source.vehicleType ?? source.type);
  const aliases = dedupeStrings(asStringArray(source.aliases));
  const keywords = dedupeStrings(asStringArray(source.keywords));
  const id = optionalString(source.id) || buildEntryId({ faction, vehicleType, asset, name });
  return {
    id,
    faction,
    vehicleType,
    asset,
    name,
    aliases,
    keywords,
    searchTokens: dedupeStrings([
      ...asStringArray(source.searchTokens),
      ...extractSearchTokens(name),
      ...aliases.flatMap(extractSearchTokens),
      ...extractSearchTokens(asset),
    ]),
  };
}

function inferKeywordsForEntry(entry) {
  const candidates = [
    ...extractFamilyKeywords(entry.name),
    ...entry.aliases.flatMap(extractFamilyKeywords),
  ];
  return candidates.filter((keyword) => keyword.length >= 2);
}

function extractFamilyKeywords(value) {
  const text = String(value ?? "").normalize("NFKC").toUpperCase();
  const compact = text.replace(/[^A-Z0-9]+/g, "");
  const result = [];
  const leading = compact.match(/^([A-Z]+)(?=\d)/)?.[1] ?? compact.match(/^([A-Z]{2,})/)?.[1] ?? "";
  if (leading.length >= 2) result.push(leading);
  const alphaNumPrefix = compact.match(/^([A-Z]+\d{2,4})/)?.[1] ?? "";
  if (alphaNumPrefix.length >= 3) result.push(alphaNumPrefix);
  if (/TANK|MBT|ABRAMS|LEOPARD|CHALLENGER/.test(compact)) result.push("TANK");
  return dedupeStrings(result);
}

function extractSearchTokens(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .split(/[^A-Za-z0-9]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function normalizedEditSimilarity(left, right) {
  const maxLength = Math.max(left.length, right.length);
  if (!maxLength) return 1;
  return 1 - levenshteinDistance(left, right) / maxLength;
}

function levenshteinDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function diceCoefficient(left, right) {
  const leftGrams = bigrams(left);
  const rightGrams = bigrams(right);
  if (!leftGrams.length || !rightGrams.length) return left === right ? 1 : 0;
  const counts = new Map();
  for (const gram of leftGrams) counts.set(gram, (counts.get(gram) ?? 0) + 1);
  let intersection = 0;
  for (const gram of rightGrams) {
    const count = counts.get(gram) ?? 0;
    if (count <= 0) continue;
    intersection += 1;
    counts.set(gram, count - 1);
  }
  return (2 * intersection) / (leftGrams.length + rightGrams.length);
}

function bigrams(value) {
  if (value.length < 2) return value ? [value] : [];
  const result = [];
  for (let index = 0; index < value.length - 1; index += 1) {
    result.push(value.slice(index, index + 2));
  }
  return result;
}

function serializePolicy(policy) {
  return {
    version: policy.version,
    source: policy.source,
    importedAt: policy.importedAt,
    updatedAt: policy.updatedAt,
    suggestionLimit: policy.suggestionLimit,
    defaultNamePatterns: policy.defaultNamePatterns,
    infantryNames: policy.infantryNames,
    specialInfantryNames: policy.specialInfantryNames,
    entries: policy.entries.map((entry) => ({
      id: entry.id,
      faction: entry.faction,
      vehicleType: entry.vehicleType,
      asset: entry.asset,
      name: entry.name,
      aliases: entry.aliases,
      keywords: entry.keywords,
      searchTokens: entry.searchTokens,
    })),
  };
}

function createEmptyPolicyDocument() {
  return {
    version: 1,
    source: { type: "manual", fileName: "" },
    importedAt: null,
    updatedAt: null,
    suggestionLimit: DEFAULT_SUGGESTION_LIMIT,
    defaultNamePatterns: [...DEFAULT_NAME_PATTERNS],
    infantryNames: [],
    specialInfantryNames: [],
    entries: [],
  };
}

function normalizeSource(source) {
  const raw = source && typeof source === "object" && !Array.isArray(source) ? source : {};
  return {
    type: optionalString(raw.type) || "manual",
    fileName: optionalString(raw.fileName),
    path: optionalString(raw.path),
    sheetName: optionalString(raw.sheetName),
  };
}

function normalizeSuggestionLimit(value) {
  const number = Number(value ?? DEFAULT_SUGGESTION_LIMIT);
  if (!Number.isFinite(number)) return DEFAULT_SUGGESTION_LIMIT;
  return Math.max(1, Math.min(MAX_SUGGESTION_LIMIT, Math.trunc(number)));
}

function buildEntryId(entry) {
  const base = [entry.faction, entry.vehicleType, entry.name, entry.asset]
    .map((part) => normalizePolicyName(part))
    .filter(Boolean)
    .join(":");
  return base || `entry:${Math.random().toString(36).slice(2)}`;
}

function isPolicyDocument(value) {
  return Boolean(value && typeof value === "object" && Array.isArray(value.entries));
}

function optionalString(value) {
  return String(value ?? "").trim();
}

function asStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => optionalString(item)).filter(Boolean)
    : [];
}

function dedupeStrings(values = []) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = optionalString(value);
    if (!text) continue;
    const key = normalizePolicyName(text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}

export default {
  evaluateSquadName,
  loadSquadNamePolicy,
  normalizePolicyDocument,
  normalizePolicyName,
  readSquadNamePolicyState,
  resolveSquadNamePolicyPath,
  saveSquadNamePolicyState,
  stripSquadSuffix,
  testSquadNamePolicy,
};
