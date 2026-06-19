// -*- coding: utf-8 -*-

/**
 * Web 页面注册表
 *
 * 这里只负责记录“有哪些 Web 页面存在，以及它们怎么展示”。
 * 它不承载页面业务数据，也不负责权限判定本身。
 */
import {
  canAccessPage,
  normalizePermissionList,
  resolveWebPagePermission,
} from "../web-client/src/shared/web-page-permissions.js";

export class WebRegistry {
  constructor({ config, logger }) {
    this.config = config;
    this.logger = logger;
    this.pages = new Map();

    this.registerRequiredBasePages();
  }

  /**
   * 注册系统基础页面。
   * 这些页面默认属于固定入口，即使其他可选页面被关闭，基础能力仍然存在。
   */
  registerRequiredBasePages() {
    this.registerPage({
      id: "web.matchStatus",
      title: "对局状态",
      group: "基础",
      route: "/match-status",
      pageModule: "/pages/match-status.js",
      source: "module.matchState",
      description: "对局状态总览页面。展示当前地图、地图层、双方队伍的小队列表及成员详情、在线人数与队列人数、对局已用时等核心信息。数据来自 module.matchState，每秒通过顶栏刷新，是管理员快速感知战场态势的主视图。",
      required: true,
      enabled: true,
      order: 10,
      icon: "📣",
    });

    this.registerPage({
      id: "web.squadManagement",
      title: "小队管理",
      group: "基础",
      route: "/squad-management",
      pageModule: "/pages/squad-management.js",
      source: "module.squadManagement",
      description: "小队动作审计台。只负责记录、执行和查询建队、解散、踢出动作，不展示完整对局态势或成员列表。",
      required: true,
      enabled: true,
      order: 15,
      icon: "🛝",
    });

    this.registerPage({
      id: "web.console",
      title: "控制台",
      group: "基础",
      route: "/console",
      pageModule: "/pages/console.js",
      source: "module.console",
      description:
        "系统日志控制台页面。实时拉取 module.console 缓存的日志条目，支持按来源频道筛选和关键词搜索。同时提供 RCON 命令输入框，管理员可直接在此页面下发任意 RCON 指令并查看回包，是日常运维和排查问题的核心工具页。",
      required: true,
      enabled: true,
      order: 20,
      icon: "🧼",
    });

    this.registerPage({
      id: "web.playerDatabase",
      title: "玩家数据库",
      group: "基础",
      route: "/player-database",
      pageModule: "/pages/player-database.js",
      source: "module.playerDatabase",
      description:
        "玩家数据库管理页面。展示 module.playerDatabase 持久化的玩家档案，支持按名称/SteamID/EOSID 搜索，可查看玩家历史名称、首次/最近出现时间、权限组设置等详细信息。管理员可在此直接修改玩家权限组，操作结果写入 audit 日志。",
      required: true,
      enabled: true,
      order: 30,
      icon: "🛻",
    });

    this.registerPage({
      id: "web.reserveSlots",
      title: "预留位管理",
      group: "基础",
      route: "/reserve-slots",
      source: "module.reserveSlots",
      description:
        "预留位管理页面。读取 admins.CFG 中的 // 预留位 区块，展示玩家预留位状态，并允许 SuperAdmin 为玩家新增或续期预留位。",
      required: true,
      enabled: true,
      order: 35,
      icon: "VIP",
      requiredPermission: "player_database.view",
    });

    this.registerPage({
      id: "web.chatMonitor",
      title: "聊天监控",
      group: "调试",
      route: "/chat-monitor",
      source: "module.chatManager",
      description: "实时聊天监控页面。展示所有玩家聊天内容，支持频率监控和自动触发器测试。",
      required: false,
      enabled: true,
      order: 100,
      icon: "💬",
    });

    this.registerPage({
      id: "web.bzssCoreSnapshots",
      title: "BZSS-Core 玩家快照",
      group: "调试",
      route: "/debug/bzss-core-snapshots",
      source: "module.bzssCoreMonitor",
      description: "查看 BZSS-Core 监控到的玩家快照文件状态，以及当前一轮已完成写入并成功解析出的全部玩家信息。",
      required: false,
      enabled: true,
      order: 105,
      icon: "BZSS",
      requiredPermission: "bzss_core.use",
    });

    this.registerPage({
      id: "web.udpForwarder",
      title: "UDP 转发日志",
      group: "调试",
      route: "/debug/udp-forwarder",
      source: "plugin.udp_event_forwarder",
      description: "UDP 事件转发状态与日志查看。监控系统向外部接收端推送事件的实时流与成功率。",
      required: false,
      enabled: true,
      order: 110,
      icon: "📗",
    });

    this.registerPage({
      id: "web.matchSnapshotDebug",
      title: "快照录制",
      group: "调试",
      route: "/debug/match-snapshots",
      source: "plugin.match-snapshot",
      description: "对局快照手动录制与历史查看。用于调试和复盘。",
      required: false,
      enabled: true,
      order: 120,
      icon: "📓",
    });

    this.registerPage({
      id: "web.squadNameTracking",
      title: "建队与违规队名追踪",
      group: "调试",
      route: "/debug/squad-name-tracking",
      source: "module.squadLifecycle",
      description: "建队追踪看板。整合当前小队快照、日志建队确认、违规队名解散与警告记录，以及 RCON 巡逻识别结果。",
      required: false,
      enabled: true,
      order: 123,
      icon: "TRACK",
    });

    this.registerPage({
      id: "web.squadNameClassifierDebug",
      title: "小队名称分类器",
      group: "调试",
      route: "/debug/squad-name-classifier",
      source: "domain.squadNameClassifier",
      description: "小队名称性质分类器调试页。用于输入队名并查看标准化、命中规则、可信度和完整调试输出。",
      required: false,
      enabled: true,
      order: 125,
      icon: "🏷️",
    });

    this.registerPage({
      id: "web.runtimeStatus",
      title: "运行状态",
      group: "系统",
      route: "/system/status",
      pageModule: "/pages/runtime-status.js",
      source: "core",
      description: "系统模块与插件运行状态。展示当前加载的所有内置模块和外部插件的健康状态、版本信息及运行指标。",
      required: true,
      enabled: true,
      order: 1000,
      icon: "💡",
      hiddenFromSidebar: false,
    });

    this.registerPage({
      id: "web.auditRecords",
      title: "操作记录",
      group: "系统",
      route: "/system/audit-records",
      source: "core.auditManager",
      description: "Web 人工操作安全审计记录。展示操作人、动作、目标、来源、服务器、IP、结果、请求参数和执行结果快照。",
      required: true,
      enabled: true,
      order: 1005,
      icon: "AUD",
      requiredPermission: "audit.view",
      hiddenFromSidebar: false,
    });
  }

  /**
   * 注册单个页面。
   *
   * `hiddenFromSidebar` 允许页面可路由、可访问，但不出现在左侧主导航中。
   * 插件订阅页就依赖这个能力，只从右上角菜单进入。
   */
  registerPage(page) {
    const required = Boolean(page.required);
    const optionalConfig = this.config.get("webModules.optional", {});
    const enabled = required ? true : Boolean(optionalConfig[page.id] ?? page.enabled ?? true);
    const normalizedRoute = normalizeRoute(page.route);
    const resolvedPermission = resolveWebPagePermission(normalizedRoute);
    const requiredPermission = String(page.requiredPermission ?? resolvedPermission?.requiredPermission ?? "").trim();
    const legacyRequiredPermissions = normalizePermissionList(
      page.legacyRequiredPermissions ?? resolvedPermission?.legacyRequiredPermissions ?? [],
    );

    const finalPage = {
      id: page.id,
      title: page.title,
      group: page.group ?? "其他",
      route: normalizedRoute,
      pageModule: page.pageModule,
      source: page.source,
      required,
      enabled,
      order: Number(page.order ?? 1000),
      icon: page.icon ?? "🔹",
      hiddenFromSidebar: Boolean(page.hiddenFromSidebar),
      requiredPermission,
      legacyRequiredPermissions,
      superAdminOnly: Boolean(page.superAdminOnly ?? resolvedPermission?.superAdminOnly),
    };

    for (const existing of this.pages.values()) {
      if (existing.id === finalPage.id) continue;
      if (normalizeRoute(existing.route) !== normalizedRoute) continue;

      this.logger.web(
        `Skip duplicate page route ${normalizedRoute}: keep ${existing.id}, ignore ${finalPage.id}`,
      );
      return;
    }

    this.pages.set(finalPage.id, finalPage);
    this.logger.web(`Registered page ${finalPage.id}`);
  }

  /**
   * 返回当前启用且面向前端展示的页面列表。
   */
  getPages(user = null) {
    return dedupePagesByRoute(
      [...this.pages.values()]
        .filter((page) => page.enabled)
        .filter((page) => canAccessPage(user, page.requiredPermission, page.legacyRequiredPermissions, {
          superAdminOnly: page.superAdminOnly,
        }))
        .sort((a, b) => a.order - b.order),
    );
  }

  /**
   * 返回全部页面，包括被隐藏或被关闭的页面。
   * 订阅页需要完整数据来展示系统结构，因此使用这个接口。
   */
  getAllPages() {
    return dedupePagesByRoute([...this.pages.values()].sort((a, b) => a.order - b.order));
  }
}

function normalizeRoute(route) {
  const raw = String(route ?? "").trim();
  if (!raw) return "/";

  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash.length > 1 && withLeadingSlash.endsWith("/")) {
    return withLeadingSlash.slice(0, -1);
  }

  return withLeadingSlash;
}

function dedupePagesByRoute(pages) {
  const seenRoutes = new Set();
  const unique = [];

  for (const page of pages) {
    const route = normalizeRoute(page?.route);
    if (seenRoutes.has(route)) continue;
    seenRoutes.add(route);
    unique.push({ ...page, route });
  }

  return unique;
}
