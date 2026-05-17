// -*- coding: utf-8 -*-

export function createPlugin({ core } = {}) {
  const pluginApi = {
    getPage() {
      return {
        id: "web.fairSquad",
        title: "\u516c\u5e73\u5efa\u961f",
        group: "\u63d2\u4ef6",
        route: "/plugins/fair-squad",
        pageModule: "/pages/fair-squad.js",
        source: "fair-squad",
        description: "Auto-enforced squad management page for fair squad creation rules.",
        required: false,
        enabled: true,
        order: 530,
        icon: "FS",
        hiddenFromSidebar: false,
      };
    },
  };

  return {
    manifest: {
      id: "fair-squad",
      name: "\u516c\u5e73\u5efa\u961f",
      kind: "plugin",
      version: "1.0.0",
      description: "Auto-enforced squad management plugin for fair squad creation windows and manual squad actions.",
      category: "Management",
      icon: "FS",
    },
    apiName: "fairSquad",
    api: pluginApi,

    async start() {
      core.webRegistry?.registerPage?.(pluginApi.getPage());
      core.logger?.info?.("[FairSquad] Plugin started.");
    },

    async stop() {
      core.logger?.info?.("[FairSquad] Plugin stopped.");
    },
  };
}

