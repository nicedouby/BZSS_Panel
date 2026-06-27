// -*- coding: utf-8 -*-

const mappingsByServer = new Map();

export function rememberTeamFactionMappings(serverId, squads = []) {
  const serverKey = normalizeText(serverId);
  if (!serverKey) return;

  const mapping = mappingsByServer.get(serverKey) ?? new Map();
  for (const squad of Array.isArray(squads) ? squads : []) {
    const teamId = toNumber(squad?.teamID ?? squad?.teamId);
    const teamName = normalizeNameKey(squad?.teamName ?? squad?.factionName);
    if (teamId == null || !teamName) continue;
    mapping.set(teamName, teamId);
  }

  if (mapping.size > 0) mappingsByServer.set(serverKey, mapping);
}

export function getTeamIdByFactionName(serverId, factionName) {
  const serverKey = normalizeText(serverId);
  const factionKey = normalizeNameKey(factionName);
  if (!serverKey || !factionKey) return null;
  return mappingsByServer.get(serverKey)?.get(factionKey) ?? null;
}

export function clearTeamFactionMappings(serverId) {
  const serverKey = normalizeText(serverId);
  if (!serverKey) return;
  mappingsByServer.delete(serverKey);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeNameKey(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, " ");
}

function toNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
