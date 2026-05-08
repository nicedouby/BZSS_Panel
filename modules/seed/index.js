// -*- coding: utf-8 -*-

export function createSeedModule() {
  return {
    manifest: { id: "module.seed", name: "Seed Module", kind: "module", version: "0.1.0", description: "服务器拉种子模式管理模块。判断服务器当前是否处于种子状态（低人数热身阶段），供其他模块调整规则力度，例如在种子阶段放宽建队检测、降低惩罚等级等。目前以骨架形态存在，后续可对接人数阈值与时间窗口配置。" },
    apiName: "seed",
    api: {
      isSeeding() { return false; },
    },
  };
}
