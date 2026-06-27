// -*- coding: utf-8 -*-

import { createChatManagerService } from "./service.js";

const MODULE_ID = "module.chatManager";

export function createChatManagerModule({ core, modules, config, logger }) {
  const service = createChatManagerService({
    core,
    modules,
    config,
    logger,
  });

  return {
    manifest: {
      id: MODULE_ID,
      name: "Chat Manager Module",
      kind: "module",
      version: "0.1.0",
      description: "Handles player chat messages, triggers events, and monitors frequency.",
    },
    apiName: "chatManager",
    api: service.api,
    start: service.start,
    stop: service.stop,
  };
}
