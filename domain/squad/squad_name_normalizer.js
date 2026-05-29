// -*- coding: utf-8 -*-

export function normalizeSquadName(rawName) {
  if (typeof rawName !== "string") return "";

  return rawName
    .normalize("NFKC")
    .replace(/\u3000/g, " ")
    .replace(/[（]/g, "(")
    .replace(/[）]/g, ")")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export default {
  normalizeSquadName,
};
