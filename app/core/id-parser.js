// -*- coding: utf-8 -*-

/**
 * Squad Online IDs 解析器。
 *
 * 继承自 MicePanel_better 的设计：
 * - "EOS: xxx steam: yyy" -> eosID / steamID
 * - 对 RCON 事件、ListPlayers、ListSquads 都复用这一套解析
 */

const ID_MATCHER = /\s*(?<name>[^\s:]+)\s*:\s*(?<id>[^\s]+)/g;

/**
 * @param {string} idsStr
 */
export function iterateIDs(idsStr) {
  return new IDsIterator(String(idsStr ?? "").matchAll(ID_MATCHER));
}

class IDsIterator {
  constructor(matchIterator) {
    this._it = matchIterator;
  }

  [Symbol.iterator]() {
    return this;
  }

  next() {
    const match = this._it.next();
    if (match.done) return { value: undefined, done: true };
    return { value: { key: match.value[1], value: match.value[2] }, done: false };
  }

  forEach(fn) {
    for (const { key, value } of this) fn(key, value);
  }
}

/**
 * "steam" -> "SteamID", "EOS" -> "EOSID"
 */
export function capitalID(platform) {
  const lower = String(platform ?? "").toLowerCase();
  if (lower === "eos") return "EOSID";
  return lower.charAt(0).toUpperCase() + lower.slice(1) + "ID";
}

/**
 * "steam" -> "steamID", "EOS" -> "eosID"
 */
export function lowerID(platform) {
  const lower = String(platform ?? "").toLowerCase();
  if (lower === "eos") return "eosID";
  return lower + "ID";
}
