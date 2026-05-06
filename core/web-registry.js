// -*- coding: utf-8 -*-

/**
 * Core: WebRegistry
 *
 * 只负责“Web 页面注册”。
 *
 * 它不提供页面数据，也不做业务判断。
 * Module / Plugin 可以向这里注册自己的 Web 页面入口。
 */
export class WebRegistry {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.pages = new Map();

    this.registerRequiredBasePages();
  }

  registerRequiredBasePages() {
    this.registerPage({
      id: "web.matchStatus",
      title: "对局状态",
      group: "基础",
      route: "/match-status",
      pageModule: "/pages/match-status.js",
      source: "module.matchState",
      required: true,
      enabled: true,
      order: 10,
      icon: "📊",
    });

    this.registerPage({
      id: "web.console",
      title: "控制台",
      group: "基础",
      route: "/console",
      pageModule: "/pages/console.js",
      source: "module.console",
      required: true,
      enabled: true,
      order: 20,
      icon: "🖥️",
    });

    this.registerPage({
      id: "web.playerDatabase",
      title: "玩家数据库",
      group: "基础",
      route: "/player-database",
      pageModule: "/pages/player-database.js",
      source: "module.playerDatabase",
      required: true,
      enabled: true,
      order: 30,
      icon: "🗂️",
    });
  }

  registerPage(page) {
    const required = Boolean(page.required);
    const optionalConfig = this.config.get("webModules.optional", {});
    const enabled = required ? true : Boolean(optionalConfig[page.id] ?? page.enabled ?? true);

    const finalPage = {
      id: page.id,
      title: page.title,
      group: page.group ?? "其他",
      route: page.route,
      pageModule: page.pageModule,
      source: page.source,
      required,
      enabled,
      order: Number(page.order ?? 1000),
      icon: page.icon ?? "•",
    };

    this.pages.set(finalPage.id, finalPage);
    this.logger.web(`Registered page ${finalPage.id}`);
  }

  getPages() {
    return [...this.pages.values()]
      .filter((p) => p.enabled)
      .sort((a, b) => a.order - b.order);
  }
}
