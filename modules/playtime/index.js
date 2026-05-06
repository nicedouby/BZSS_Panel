// -*- coding: utf-8 -*-

export function createPlaytimeModule() {
  return {
    manifest: { id: "module.playtime", name: "Playtime Module", kind: "module", version: "0.1.0" },
    apiName: "playtime",
    api: {
      async getPlaytime() { return null; },
    },
  };
}
