// -*- coding: utf-8 -*-

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import {
  classifySquadName,
  SQUAD_NATURE,
  SQUAD_NATURE_LABEL,
} from "../squad/squad_name_classifier.js";
import {
  DEFAULT_SQUAD_TYPES,
  POLICY_VERSION,
  buildRuleClassification,
  buildTypeIndex,
  normalizePolicyEntryV2,
  normalizeSquadType,
  resolveEffectiveMaxPlayers,
} from "./schema.js";
import { migratePolicyV1ToV2 } from "./migration.js";
import { validatePolicyDocument as validatePolicyDocumentV2 } from "./validation.js";

export {
  POLICY_VERSION,
  buildTypeIndex,
  migratePolicyV1ToV2,
  normalizePolicyEntryV2,
  normalizeSquadType,
  resolveEffectiveMaxPlayers,
};

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
  const requestedRevision = Number(nextPolicy?.revision);
  if (!Number.isInteger(requestedRevision) || requestedRevision !== previous.revision) {
    throw createPolicyError(
      "PolicyRevisionConflict",
      `队名规范已被其他会话修改。当前版本为 ${previous.revision}，请刷新后重试。`,
      409,
      { expectedRevision: previous.revision, receivedRevision: nextPolicy?.revision ?? null },
    );
  }
  const candidate = {
    ...previous,
    ...nextPolicy,
    version: POLICY_VERSION,
    revision: previous.revision + 1,
    source: nextPolicy.source ?? previous.source,
    types: nextPolicy.types ?? previous.types,
    entries: nextPolicy.entries ?? previous.entries,
    suggestionLimit: nextPolicy.suggestionLimit ?? nextPolicy.config?.suggestionLimit ?? previous.suggestionLimit,
    updatedAt: new Date().toISOString(),
  };

  const validation = validatePolicyDocument(candidate, { policyPath });
  if (!validation.valid) {
    throw createPolicyError(
      "PolicyValidationFailed",
      `队名规范包含 ${validation.errors.length} 个错误，未保存。`,
      422,
      { validation },
    );
  }
  const normalized = normalizePolicyDocument(candidate, { policyPath });

  await fsp.mkdir(path.dirname(policyPath), { recursive: true });
  try {
    await fsp.copyFile(policyPath, `${policyPath}.bak`);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const tempPath = `${policyPath}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tempPath, `${JSON.stringify(serializePolicy(normalized), null, 2)}\n`, "utf8");
  await fsp.rename(tempPath, policyPath);
  await appendPolicyAudit(policyPath, {
    action: "save",
    revision: normalized.revision,
    previousRevision: previous.revision,
    actor: optionalString(nextPolicy?.auditActor) || "unknown",
    updatedAt: normalized.updatedAt,
    ruleCount: normalized.entries.length,
    typeCount: normalized.types.length,
  });
  return buildPolicyState(normalized);
}

export function validatePolicyDocument(rawPolicy = {}, options = {}) {
  const original = rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy)
    ? rawPolicy
    : {};
  const normalized = normalizePolicyDocument(rawPolicy, options);
  const validationTarget = Number(original.version) >= POLICY_VERSION
    && Array.isArray(original.types)
    && Array.isArray(original.entries)
    ? original
    : normalized;
  return {
    ...validatePolicyDocumentV2(validationTarget, { normalizeName: normalizePolicyName }),
    normalized: serializePolicy(normalized),
  };
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
    const reason = `Matched default squad name pattern: ${defaultMatch.pattern}`;
    return buildAllowedNameResult({
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      name: input.trim(),
      kind: "default",
      label: "Default squad name",
      reason,
      matchedValue: defaultMatch.pattern,
      classification: buildClassification("infantry", "战斗步兵", reason),
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

  let exactMatch = indexes.nameIndex.get(normalizedInput);
  let matchedBySuffix = false;
  if (!exactMatch && suffixStripped) {
    const suffixCandidate = indexes.nameIndex.get(normalizedStrippedInput);
    if (suffixCandidate?.entry?.allowSquadSuffix) {
      exactMatch = suffixCandidate;
      matchedBySuffix = true;
    }
  }
  if (exactMatch) {
    const squadType = indexes.typeIndex.get(exactMatch.entry.typeId);
    const matchedKind = matchedBySuffix
      ? "suffix"
      : (["infantry", "special_infantry"].includes(exactMatch.entry.typeId) && exactMatch.kind === "canonical"
        ? exactMatch.entry.typeId
        : exactMatch.kind);
    const reason = matchedBySuffix
      ? "Matched allowed squad suffix."
      : (exactMatch.kind === "canonical" ? "Matched canonical squad name." : "Matched squad name alias.");
    return {
      ok: true,
      input,
      normalizedInput,
      normalizedStrippedInput,
      suffixStripped,
      valid: true,
      reason,
      matched: buildPolicyMatch(exactMatch.entry, squadType, matchedKind, exactMatch.value),
      suggestions: [],
      keywordSuggestions: [],
      algorithmSuggestions: [],
      warningMessage: "",
      classification: buildRuleClassification(exactMatch.entry, squadType, reason),
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

  const suggestionKeys = buildSuggestionKeys(input, normalizedInput, normalizedStrippedInput);
  const keywordSuggestions = buildKeywordSuggestions(suggestionKeys, indexes, suggestionLimit);
  const algorithmSuggestions = buildAlgorithmSuggestions(
    suggestionKeys,
    indexes,
    suggestionLimit,
    new Set(keywordSuggestions.map((item) => item.id)),
  );
  const suggestions = mergeSuggestions(keywordSuggestions, algorithmSuggestions, suggestionLimit);
  const warningMessages = buildSquadNamePolicyWarningMessages(suggestions);
  const warningMessage = warningMessages[1] ?? "";

  return {
    ok: true,
    input,
    normalizedInput,
    normalizedStrippedInput,
    suffixStripped,
    valid: false,
    reason: suffixStripped
      ? "Squad suffix is not accepted by the matched rule."
      : "No canonical squad name or alias matched.",
    matched: null,
    suggestions,
    keywordSuggestions,
    algorithmSuggestions,
    warningMessage,
    warningMessages,
    classification: null,
  };
}

export function buildSquadNamePolicyWarningMessages(suggestions = []) {
  const names = Array.isArray(suggestions)
    ? suggestions.map((item) => String(item?.name ?? item ?? "").trim()).filter(Boolean)
    : [];
  const messages = [
    "警告违规队名！\n本服对队名要求十分严格。",
  ];
  if (names.length > 0) {
    messages.push(`警告你可能想建立\n${formatSuggestionNames(names)} 队。`);
  }
  return messages;
}

function formatSuggestionNames(names = []) {
  const rows = [];
  for (let index = 0; index < names.length; index += 2) {
    rows.push(names.slice(index, index + 2).join("，"));
  }
  return rows.join("\n");
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
  if (isNumericOnlyName(normalizedStrippedInput || normalizedInput) && !looksLikeVehicleModelName(input)) {
    return buildClassification("infantry", SQUAD_NATURE_LABEL.infantry, "数字队名已认定为步兵队，跳过载具建议。");
  }
  return null;
}

function buildClassification(nature, label, reason) {
  const broadNature = ["infantry", "vehicle", "support", "logistics", "other"].includes(nature)
    ? nature
    : "other";
  return {
    nature: broadNature,
    typeId: nature || "other",
    typeLabel: label,
    label,
    ruleId: "",
    effectiveMaxPlayers: null,
    maxPlayersSource: "none",
    assetPath: "",
    reason,
  };
}

function isNumericOnlyName(value) {
  return /^\d{1,4}$/.test(String(value ?? "").trim());
}

function isRepeatedVehicleModelDigits(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  return /^(\d{2})\1$/.test(text);
}

function looksLikeVehicleModelName(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return false;
  if (isRepeatedVehicleModelDigits(text)) return true;
  if (/[A-Za-z]+\s*\d|\d+\s*[A-Za-z]+/.test(text)) return true;
  if (/\d+\s*(?:式|型|改|轮式|履带|步战|战车|装甲|突击炮|坦克|运兵|战斗车)/u.test(text)) return true;
  return false;
}

function containsChinese(value) {
  return /[\u3400-\u9fff]/u.test(String(value ?? ""));
}

function extractModelLikeSuggestionKeys(value) {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return [];
  const compact = text.replace(/\s+/g, "");
  const results = [];
  const repeatedDigits = compact.match(/^(\d{2})\1$/);
  if (repeatedDigits?.[1]) results.push(repeatedDigits[1]);
  const numericModel = compact.match(/^(\d{1,4})(?:式|型|改|轮式|履带|步战|战车|装甲|突击炮|坦克|运兵|战斗车)+$/u);
  if (numericModel?.[1]) results.push(numericModel[1]);
  const alphaNumeric = compact.match(/^([A-Za-z]+[- ]?\d+[A-Za-z0-9-]*)/);
  if (alphaNumeric?.[1]) results.push(alphaNumeric[1]);
  return dedupeStrings(results);
}

function detectRepeatedDigitsPrefix(suggestionKeys) {
  for (const key of suggestionKeys) {
    const match = String(key ?? "").match(/^(\d{2})\1$/);
    if (match?.[1]) return match[1];
  }
  return "";
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
  const original = rawPolicy && typeof rawPolicy === "object" && !Array.isArray(rawPolicy) ? rawPolicy : {};
  const source = migratePolicyV1ToV2(original, { normalizeName: normalizePolicyName });
  const types = normalizeTypes(source.types);
  const entries = Array.isArray(source.entries)
    ? source.entries.map((entry) => normalizeEntry(entry)).filter(Boolean)
    : [];
  const withAutoKeywords = entries.map((entry) => ({
    ...entry,
    keywords: dedupeStrings([
      ...entry.keywords,
      ...inferKeywordsForEntry(entry),
    ]),
  }));

  return {
    version: POLICY_VERSION,
    revision: normalizeRevision(source.revision),
    policyPath: options.policyPath ?? source.policyPath ?? "",
    source: normalizeSource(source.source),
    migrationWarnings: Array.isArray(source.migrationWarnings) ? source.migrationWarnings : [],
    importedAt: optionalString(source.importedAt),
    updatedAt: optionalString(source.updatedAt),
    suggestionLimit: normalizeSuggestionLimit(source.suggestionLimit ?? source.config?.suggestionLimit),
    defaultNamePatterns: dedupeStrings([
      ...DEFAULT_NAME_PATTERNS,
      ...asStringArray(source.defaultNamePatterns),
    ]),
    types,
    infantryNames: buildCompatibilityNames(withAutoKeywords, "infantry"),
    specialInfantryNames: buildCompatibilityNames(withAutoKeywords, "special_infantry"),
    entries: withAutoKeywords,
  };
}

export function buildPolicyState(policy) {
  const normalized = normalizePolicyDocument(policy, { policyPath: policy.policyPath });
  const typeIndex = buildTypeIndex(normalized.types);
  return {
    ok: true,
    policyPath: normalized.policyPath,
    version: normalized.version,
    revision: normalized.revision,
    source: normalized.source,
    migrationWarnings: normalized.migrationWarnings,
    importedAt: normalized.importedAt,
    updatedAt: normalized.updatedAt,
    suggestionLimit: normalized.suggestionLimit,
    defaultNamePatterns: normalized.defaultNamePatterns,
    infantryNames: normalized.infantryNames,
    specialInfantryNames: normalized.specialInfantryNames,
    types: normalized.types.map((type) => ({
      ...type,
      ruleCount: normalized.entries.filter((entry) => entry.typeId === type.id).length,
    })),
    validation: validatePolicyDocumentV2(normalized, { normalizeName: normalizePolicyName }),
    stats: buildPolicyStats(normalized),
    entries: normalized.entries.map((entry) => {
      const squadType = typeIndex.get(entry.typeId);
      return {
        ...entry,
        vehicleType: entry.legacyVehicleType || (squadType?.nature === "vehicle" ? squadType.label : ""),
        typeLabel: squadType?.label || entry.typeId,
        nature: squadType?.nature || "other",
        ...resolveEffectiveMaxPlayers(entry, squadType),
      };
    }),
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
    vehicleTypes: new Set(policy.entries.filter((entry) => policy.types.find((type) => type.id === entry.typeId)?.nature === "vehicle").map((entry) => entry.typeId)).size,
    types: policy.types.length,
    enabledEntries: policy.entries.filter((entry) => entry.enabled).length,
  };
}

function buildPolicyIndexes(policy) {
  const nameIndex = new Map();
  const keywordIndex = new Map();
  const searchable = [];
  const typeIndex = buildTypeIndex(policy.types);
  const sortedEntries = [...policy.entries]
    .filter((entry) => entry.enabled && typeIndex.get(entry.typeId)?.enabled)
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name, "zh-CN"));

  for (const entry of sortedEntries) {
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

  return { nameIndex, keywordIndex, searchable, typeIndex };
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

function buildSuggestionKeys(input, normalizedInput, normalizedStrippedInput) {
  const primary = normalizedStrippedInput || normalizedInput;
  return dedupeStrings([
    primary,
    ...extractModelLikeSuggestionKeys(input),
  ].map((item) => normalizePolicyName(item)).filter(Boolean));
}

function buildKeywordSuggestions(suggestionKeys, indexes, limit) {
  const results = [];
  const seen = new Set();
  for (const suggestionKey of suggestionKeys) {
    const entries = indexes.keywordIndex.get(suggestionKey) ?? [];
    for (const entry of entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      results.push(buildSuggestion(entry, {
        source: "keyword",
        score: 1,
        reason: "Keyword matched.",
      }));
      if (results.length >= limit) return results;
    }
  }
  return results;
}

function buildAlgorithmSuggestions(suggestionKeys, indexes, limit, excludedIds = new Set()) {
  if (!suggestionKeys.length) return [];
  const bestByEntry = new Map();
  const repeatedDigitsPrefix = detectRepeatedDigitsPrefix(suggestionKeys);

  for (const suggestionKey of suggestionKeys) {
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
  }

  return [...bestByEntry.values()]
    .filter((item) => {
      if (!repeatedDigitsPrefix) return true;
      const candidateKeys = [
        normalizePolicyName(item.entry.name),
        ...item.entry.aliases.map((alias) => normalizePolicyName(alias)),
        ...item.entry.keywords.map((keyword) => normalizePolicyName(keyword)),
      ].filter(Boolean);
      return candidateKeys.some((key) => key.includes(repeatedDigitsPrefix));
    })
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

function buildPolicyMatch(entry, squadType, matchedKind, matchedValue) {
  const maxPlayers = resolveEffectiveMaxPlayers(entry, squadType);
  return {
    ...entry,
    vehicleType: entry.legacyVehicleType || (squadType?.nature === "vehicle" ? squadType?.label : ""),
    typeLabel: squadType?.label || entry.typeId,
    nature: squadType?.nature || "other",
    ...maxPlayers,
    matchedKind,
    matchedValue,
  };
}

function buildSuggestion(entry, extra = {}) {
  return {
    id: entry.id,
    name: entry.name,
    faction: entry.faction,
    vehicleType: entry.legacyVehicleType,
    typeId: entry.typeId,
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
  const entry = normalizePolicyEntryV2(rawEntry, { normalizeName: normalizePolicyName });
  if (!entry) return null;
  return entry;
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
    version: POLICY_VERSION,
    revision: policy.revision,
    source: policy.source,
    migrationWarnings: policy.migrationWarnings,
    importedAt: policy.importedAt,
    updatedAt: policy.updatedAt,
    suggestionLimit: policy.suggestionLimit,
    defaultNamePatterns: policy.defaultNamePatterns,
    types: policy.types.map((type) => ({
      id: type.id,
      label: type.label,
      nature: type.nature,
      description: type.description,
      defaultMaxPlayers: type.defaultMaxPlayers,
      assetMode: type.assetMode,
      enabled: type.enabled,
      sortOrder: type.sortOrder,
    })),
    entries: policy.entries.map((entry) => ({
      id: entry.id,
      name: entry.name,
      aliases: entry.aliases,
      keywords: entry.keywords,
      typeId: entry.typeId,
      faction: entry.faction,
      asset: entry.asset,
      maxPlayersOverride: entry.maxPlayersOverride,
      allowSquadSuffix: entry.allowSquadSuffix,
      enabled: entry.enabled,
      priority: entry.priority,
      source: entry.source,
      notes: entry.notes,
      legacyVehicleType: entry.legacyVehicleType,
      searchTokens: entry.searchTokens,
    })),
  };
}

function createEmptyPolicyDocument() {
  return {
    version: POLICY_VERSION,
    revision: 1,
    source: { type: "manual", fileName: "" },
    importedAt: null,
    updatedAt: null,
    suggestionLimit: DEFAULT_SUGGESTION_LIMIT,
    defaultNamePatterns: [...DEFAULT_NAME_PATTERNS],
    types: DEFAULT_SQUAD_TYPES,
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

function normalizeTypes(rawTypes) {
  const source = Array.isArray(rawTypes) && rawTypes.length > 0 ? rawTypes : DEFAULT_SQUAD_TYPES;
  const seen = new Set();
  return source
    .map((type, index) => normalizeSquadType(type, index * 10))
    .filter((type) => {
      if (!type || seen.has(type.id)) return false;
      seen.add(type.id);
      return true;
    })
    .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label, "zh-CN"));
}

function buildCompatibilityNames(entries, typeId) {
  return dedupeStrings(entries.filter((entry) => entry.typeId === typeId).map((entry) => entry.name));
}

function normalizeRevision(value) {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : 1;
}

async function appendPolicyAudit(policyPath, event) {
  const auditPath = `${policyPath}.audit.jsonl`;
  await fsp.appendFile(auditPath, `${JSON.stringify({ ...event, timestamp: new Date().toISOString() })}\n`, "utf8");
}

function createPolicyError(code, message, statusCode, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  Object.assign(error, details);
  return error;
}

export default {
  buildSquadNamePolicyWarningMessages,
  evaluateSquadName,
  loadSquadNamePolicy,
  normalizePolicyDocument,
  normalizePolicyName,
  readSquadNamePolicyState,
  resolveSquadNamePolicyPath,
  saveSquadNamePolicyState,
  stripSquadSuffix,
  testSquadNamePolicy,
  validatePolicyDocument,
};
