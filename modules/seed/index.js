// -*- coding: utf-8 -*-

export function createSeedModule() {
  return {
    manifest: { id: "module.seed", name: "Seed Module", kind: "module", version: "0.1.0" },
    apiName: "seed",
    api: {
      isSeeding() { return false; },
    },
  };
}
