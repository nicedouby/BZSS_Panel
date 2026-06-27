// -*- coding: utf-8 -*-

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const WEAPON_TYPE_LABELS = Object.freeze({
  bot_weapon: "人机武器",
  light: "轻武器",
  anti_tank: "单兵反坦克武器",
  explosive: "爆炸物",
  melee: "冷兵器",
  other: "其他",
});

const SOLDIER_PLACEHOLDER_TOKEN_RE = /^(?:rifleman\d*|marksman\d*|marskman\d*|medic\d*|grenadier\d*|crewman\d*|pilot\d*|engineer\d*|recon\d*|commander\d*|sapper\d*|lat\d*|hat\d*|sl\d*|tl\d*|automaticrifleman\d*|machinegunner\d*)$/i;
const SOLDIER_PLACEHOLDER_WORDS = new Set([
  "soldier",
  "soldiers",
  "rifleman",
  "marksman",
  "marskman",
  "medic",
  "grenadier",
  "crewman",
  "pilot",
  "engineer",
  "recon",
  "commander",
  "sapper",
  "lat",
  "hat",
  "sl",
  "tl",
  "automaticrifleman",
  "machinegunner",
]);
const PLACEHOLDER_SPECIAL_TEXTS = new Set(["unknown", "none", "revive", "rcon team kill"]);
const MICE_PANEL_LIGHT_WEAPON_HINTS = loadMicePanelLightWeaponHints();

const WEAPON_TYPE_RULES = [
  makeRule({
    key: "anti_tank",
    label: WEAPON_TYPE_LABELS.anti_tank,
    exact: [
      "rpg",
      "rpg 7",
      "rpg7",
      "rpg 29",
      "rpg29",
      "at4",
      "m136",
      "mk153 smaw",
      "smaw",
      "m72 law",
      "javelin",
      "carl gustav",
      "milan",
      "metis",
      "kornet",
      "fagot",
      "dragon",
      "recoilless rifle",
      "panzerfaust",
      "tow",
    ],
    contains: [
      "rpg-7",
      "rpg-29",
      "m72 law",
      "m136",
      "at4",
      "smaw",
      "javelin",
      "carl gustav",
      "milan",
      "metis",
      "kornet",
      "fagot",
      "dragon",
      "recoilless rifle",
      "panzerfaust",
    ],
    regex: [
      /\brpg[- ]?\d+\b/i,
      /\b(?:at[- ]?4|m[- ]?136|mk153|smaw|m[- ]?72\s+law|javelin|carl[- ]?gustav|milan|metis|kornet|fagot|dragon|recoilless|panzerfaust|tow)\b/i,
    ],
  }),
  makeRule({
    key: "explosive",
    label: WEAPON_TYPE_LABELS.explosive,
    exact: [
      "grenade",
      "frag",
      "flashbang",
      "smoke grenade",
      "incendiary",
      "molotov",
      "mine",
      "claymore",
      "c4",
      "satchel",
      "bomb",
      "shell",
      "projectile",
      "mortar",
      "artillery",
      "rocket",
      "warhead",
      "explosive",
      "airburst",
      "he",
      "hedp",
      "hesh",
    ],
    contains: [
      "fragmentation",
      "smoke",
      "flame",
      "burn",
      "charge",
      "explosion",
      "30mm",
      "40mm",
      "60mm",
      "81mm",
      "120mm",
      "155mm",
      "m203",
      "m320",
      "gp25",
      "gp30",
      "he frag",
      "he-frag",
      "m67frag",
      "c13frag",
    ],
    regex: [
      /\b(?:grenade|frag|flashbang|smoke|incendiary|molotov|mine|claymore|c4|satchel|bomb|shell|projectile|mortar|artillery|rocket|warhead|explosive|airburst|hedp|hesh|m67|c13frag)\b/i,
      /\b(?:30|40|60|81|120|155)mm\b/i,
      /\b(?:m203|m320|gp25|gp30|he|hefrag|he-frag)\b/i,
    ],
  }),
  makeRule({
    key: "melee",
    label: WEAPON_TYPE_LABELS.melee,
    exact: [
      "knife",
      "bayonet",
      "machete",
      "axe",
      "hatchet",
      "shovel",
      "crowbar",
      "wrench",
      "hammer",
      "sledgehammer",
      "pickaxe",
      "spear",
      "sword",
      "katana",
      "kukri",
      "bat",
      "club",
      "fist",
      "fists",
      "hand",
      "hands",
      "melee",
    ],
    contains: [
      "knife",
      "bayonet",
      "machete",
      "axe",
      "hatchet",
      "shovel",
      "crowbar",
      "wrench",
      "hammer",
      "sledgehammer",
      "pickaxe",
      "spear",
      "sword",
      "katana",
      "kukri",
      "bat",
      "club",
      "fist",
      "hand",
    ],
    regex: [
      /\b(?:knife|bayonet|machete|axe|hatchet|shovel|crowbar|wrench|hammer|sledgehammer|pickaxe|spear|sword|katana|kukri|bat|club|fists?|hands?)\b/i,
    ],
  }),
  makeRule({
    key: "light",
    label: WEAPON_TYPE_LABELS.light,
    exact: [
      "c6",
      "c6a1",
      "c7a2",
      "c8a3",
      "c9",
      "m4",
      "m4a1",
      "m16",
      "m16a4",
      "ak101",
      "ak74",
      "ak74m",
      "ak12",
      "ef88",
      "g3",
      "g36",
      "l85",
      "l85a3",
      "hk416",
      "hk417",
      "scar l",
      "scar h",
      "f2000",
      "famas",
      "fn fal",
      "m27",
      "m110",
      "sr25",
      "svd",
      "m38",
      "mosin",
      "m24",
      "mp5",
      "mp7",
      "p90",
      "uzi",
      "vector",
      "bizon",
      "pp19",
      "vss",
      "as val",
      "saiga",
      "m870",
      "g17",
      "m9",
      "p226",
      "1911",
      "makarov",
      "cz75",
      "p320",
      "glock",
      "usp",
      "deagle",
      "type 56",
      "type 81",
      "sks",
      "stg44",
      "pkm",
      "pkp",
      "rpk",
      "m249",
      "m240",
      "m60",
      "mg3",
      "mg34",
      "mg42",
      "bren",
      "dp28",
    ],
    contains: [],
    regex: [
      /\b(?:sor109t|m21|pmt\s?76)\b/i,
      /\b(?:c6(?:a1)?|c7a2|c8a3|c9|m4(?:a1)?|m16(?:a4)?|ak101|ak74m?|ak12|ef88|g3(?:a3|sg1)?|g36c?|l85(?:a3)?|hk416|hk417|scar[- ]?[lh]|f2000|famas|fn\s+fal|m27|m110|sr25|svd|m38|mosin|m24|mpt\s?76|mp5k?|mp7|p90|uzi|vector|bizon|pp19|vss|as\s+val|saiga|m870|g17|m9|p226|1911|makarov|cz75|p320|glock|usp|deagle|type\s?56|type\s?81|sks|stg44|pkm|pkp|rpk|m249|m240|m60|mg3|mg34|mg42|bren|dp28)\b/i,
      /\b(?:rifle|carbine|pistol|shotgun|submachine gun|machine gun|light machine gun|general purpose machine gun|designated marksman rifle)\b/i,
    ],
  }),
];

export function classifyWeaponType(input = {}) {
  const candidates = buildCandidates(input);
  if (!candidates.length) {
    return buildResult(WEAPON_TYPE_LABELS.other, "other", "other", {
      matchedBy: "empty",
      matchedText: "",
      matchedTerm: "",
      candidateIndex: -1,
      candidateSource: "",
    }, candidates);
  }

  const exactProjectileMatch = matchExactProjectile(candidates);
  if (exactProjectileMatch) {
    return buildResult(WEAPON_TYPE_LABELS.bot_weapon, "bot_weapon", "weapon-type:bot_weapon:exact_projectile", exactProjectileMatch, candidates);
  }

  for (const candidate of candidates) {
    if (isPlaceholderCandidate(candidate)) {
      return buildResult(WEAPON_TYPE_LABELS.other, "other", "other", {
        matchedBy: "placeholder",
        matchedText: candidate.text,
        matchedTerm: candidate.placeholderReason || "",
        candidateIndex: candidate.index,
        candidateSource: candidate.source,
      }, candidates);
    }
  }

  const micePanelMatch = matchMicePanelLightWeaponHint(candidates);
  if (micePanelMatch) {
    return buildResult(WEAPON_TYPE_LABELS.light, "light", "weapon-type:light:micepanel", micePanelMatch, candidates);
  }

  for (const rule of WEAPON_TYPE_RULES) {
    const match = matchRule(rule, candidates);
    if (match) {
      return buildResult(rule.label, rule.key, rule.ruleId, match, candidates);
    }
  }

  return buildResult(WEAPON_TYPE_LABELS.other, "other", "other", {
    matchedBy: "fallback",
    matchedText: candidates[0]?.text ?? "",
    matchedTerm: "",
    candidateIndex: 0,
    candidateSource: candidates[0]?.source ?? "",
  }, candidates);
}

export function weaponTypeLabelForKey(key) {
  const normalized = normalizeWeaponTypeKey(key);
  return WEAPON_TYPE_LABELS[normalized] || WEAPON_TYPE_LABELS.other;
}

export function normalizeWeaponTypeKey(key) {
  return String(key ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function matchExactProjectile(candidates = []) {
  for (const candidate of candidates) {
    if (candidate?.lower !== "projectile" && candidate?.lower !== "projectile xmm" && candidate?.compact !== "projectilexmm") continue;
    return {
      matchedBy: "exact",
      matchedText: candidate.text,
      matchedTerm: candidate?.lower === "projectile xmm" || candidate?.compact === "projectilexmm" ? "projectile_xmm" : "projectile",
      candidateIndex: candidate.index,
      candidateSource: candidate.source,
    };
  }
  return null;
}

function makeRule(definition) {
  return {
    key: normalizeWeaponTypeKey(definition.key),
    label: String(definition.label ?? WEAPON_TYPE_LABELS.other),
    ruleId: `weapon-type:${normalizeWeaponTypeKey(definition.key)}`,
    exact: normalizeTerms(definition.exact),
    contains: normalizeTerms(definition.contains),
    regex: Array.isArray(definition.regex) ? definition.regex : [],
  };
}

function normalizeTerms(values = []) {
  return values
    .flat()
    .map((value) => normalizeTerm(value))
    .filter(Boolean);
}

function normalizeTerm(value) {
  const text = normalizeWeaponTypeText(value);
  if (!text) return null;
  const lower = text.toLowerCase();
  return {
    text: lower,
    compact: lower.replace(/[\s-]+/g, ""),
  };
}

function buildCandidates(input = {}) {
  const sources = [
    { source: "displayName", value: input.displayName },
    { source: "cleaned", value: input.cleaned },
    { source: "raw", value: input.raw },
  ];

  const seen = new Set();
  const candidates = [];

  for (const [index, item] of sources.entries()) {
    const text = normalizeWeaponTypeText(item.value);
    if (!text) continue;
    const lower = text.toLowerCase();
    const compact = lower.replace(/[\s-]+/g, "");
    const signature = `${lower}|${compact}`;
    if (seen.has(signature)) continue;
    seen.add(signature);

    candidates.push({
      index,
      source: item.source,
      text,
      lower,
      compact,
      tokens: splitTokens(lower),
      placeholderReason: "",
    });
  }

  return candidates;
}

function splitTokens(text) {
  return String(text ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function isPlaceholderCandidate(candidate) {
  if (!candidate) return false;

  if (!candidate.text) {
    candidate.placeholderReason = "empty";
    return true;
  }

  if (PLACEHOLDER_SPECIAL_TEXTS.has(candidate.lower)) {
    candidate.placeholderReason = candidate.lower;
    return true;
  }

  const tokens = candidate.tokens;
  if (!tokens.length) {
    candidate.placeholderReason = "no_tokens";
    return true;
  }

  if (tokens[0] === "soldier" || tokens[0] === "soldiers") {
    candidate.placeholderReason = tokens[0];
    return true;
  }

  if (tokens.length === 1 && SOLDIER_PLACEHOLDER_TOKEN_RE.test(tokens[0])) {
    candidate.placeholderReason = tokens[0];
    return true;
  }

  if ((tokens.includes("soldier") || tokens.includes("soldiers")) && tokens.some((token) => SOLDIER_PLACEHOLDER_WORDS.has(token) || SOLDIER_PLACEHOLDER_TOKEN_RE.test(token))) {
    candidate.placeholderReason = "soldier_role";
    return true;
  }

  return false;
}

function matchRule(rule, candidates) {
  for (const candidate of candidates) {
    for (const term of rule.exact) {
      if (candidate.lower === term.text || candidate.compact === term.compact) {
        return {
          matchedBy: "exact",
          matchedText: candidate.text,
          matchedTerm: term.text,
          candidateIndex: candidate.index,
          candidateSource: candidate.source,
        };
      }
    }

    for (const term of rule.contains) {
      if (candidate.lower.includes(term.text) || candidate.compact.includes(term.compact)) {
        return {
          matchedBy: "contains",
          matchedText: candidate.text,
          matchedTerm: term.text,
          candidateIndex: candidate.index,
          candidateSource: candidate.source,
        };
      }
    }

    for (const pattern of rule.regex) {
      if (pattern.test(candidate.text) || pattern.test(candidate.lower)) {
        return {
          matchedBy: "regex",
          matchedText: candidate.text,
          matchedTerm: pattern.toString(),
          candidateIndex: candidate.index,
          candidateSource: candidate.source,
        };
      }
    }
  }

  return null;
}

function matchMicePanelLightWeaponHint(candidates) {
  if (!MICE_PANEL_LIGHT_WEAPON_HINTS.length) return null;

  for (const candidate of candidates) {
    for (const term of MICE_PANEL_LIGHT_WEAPON_HINTS) {
      if (!term?.text) continue;

      if (candidate.lower === term.text || candidate.compact === term.compact) {
        return {
          matchedBy: "exact",
          matchedText: candidate.text,
          matchedTerm: term.text,
          candidateIndex: candidate.index,
          candidateSource: candidate.source,
        };
      }

      if (candidate.lower.startsWith(term.text) || candidate.compact.startsWith(term.compact)) {
        return {
          matchedBy: "contains",
          matchedText: candidate.text,
          matchedTerm: term.text,
          candidateIndex: candidate.index,
          candidateSource: candidate.source,
        };
      }
    }
  }

  return null;
}

function buildResult(label, key, ruleId, match, candidates) {
  const candidate = candidates.find((item) => item.index === match.candidateIndex) ?? null;
  return {
    key,
    label,
    ruleId,
    matchedBy: match.matchedBy,
    matchedText: match.matchedText || candidate?.text || "",
    matchedTerm: match.matchedTerm || "",
    candidateIndex: match.candidateIndex ?? -1,
    candidateSource: match.candidateSource || candidate?.source || "",
  };
}

function normalizeWeaponTypeText(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";

  return text
    .normalize("NFKC")
    .replace(/^(?:BP|WP|BPC|PC)[._/-]+/i, "")
    .replace(/_C(?:_\d+)?$/i, "")
    .replace(/_C$/i, "")
    .replace(/[_/\\|+]+/g, " ")
    .replace(/[-]+/g, " ")
    .replace(/[()[\]{}.,:;'"`~!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadMicePanelLightWeaponHints() {
  const blueprintFile = ["kill", "manager", "blueprint_types.json"].join("_");
  const blueprintPath = fileURLToPath(new URL(`../../../MicePanel/config/${blueprintFile}`, import.meta.url));

  try {
    const parsed = JSON.parse(readFileSync(blueprintPath, "utf8"));
    const lightWeapons = parsed?.types?.lightWeapon;
    if (!Array.isArray(lightWeapons) || !lightWeapons.length) return [];

    const hints = new Set();
    for (const entry of lightWeapons) {
      const normalized = normalizeWeaponTypeText(entry);
      if (!normalized) continue;

      hints.add(normalized);

      const firstToken = normalized.split(/\s+/)[0]?.trim();
      if (firstToken) {
        hints.add(firstToken);
      }
    }

    return normalizeTerms([...hints]);
  } catch {
    return [];
  }
}
