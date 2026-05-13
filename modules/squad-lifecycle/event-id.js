// -*- coding: utf-8 -*-

export function makeEventId(prefix = "evt") {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${now}_${rand}`;
}
