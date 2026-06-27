import { createUdpEventForwarderService } from "./services/udp_event_forwarder_service.js";

const PLUGIN_ID = "udp_event_forwarder";
const PLUGIN_NAME = "UDP Event Forwarder";

function readPluginConfig(config) {
  if (config && typeof config.get === "function") {
    return config.get("plugins.udpEventForwarder", {}) ?? {};
  }

  if (config && typeof config === "object") {
    return config.plugins?.udpEventForwarder ?? {};
  }

  return {};
}

function isEnabled(config) {
  const pluginConfig = readPluginConfig(config);
  return Boolean(pluginConfig.enabled);
}

export function createPlugin({ core, modules } = {}) {
  const pluginLogger = core?.logger ?? console;
  const pluginCore = core || {};
  let service = null;

  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    version: "1.0.0",
    description: "Forward selected internal EventBus events to an external UDP receiver.",
    enabledByDefault: false,
    apiName: "udpEventForwarder",
    manifest: {
      id: "udp_event_forwarder",
      name: PLUGIN_NAME,
      kind: "plugin",
      version: "1.0.0",
      description: "Forward selected internal EventBus events to an external UDP receiver.",
      category: "Network",
      configSchema: [
        {
          key: "enabled",
          label: "是否启用",
          type: "boolean",
          defaultValue: false,
        },
        {
          key: "host",
          label: "目标主机 (UDP Host)",
          type: "string",
          defaultValue: "127.0.0.1",
        },
        {
          key: "port",
          label: "目标端口 (UDP Port)",
          type: "number",
          defaultValue: 4000,
        },
        {
          key: "serverId",
          label: "服务器 ID",
          type: "string",
          defaultValue: "BZSS_Main",
        },
        {
          key: "sendCombatEvents",
          label: "发送战斗事件",
          type: "boolean",
          defaultValue: true,
        },
        {
          key: "sendMapChanged",
          label: "发送地图更换事件",
          type: "boolean",
          defaultValue: true,
        },
        {
          key: "sendChat",
          label: "发送聊天事件",
          type: "boolean",
          defaultValue: true,
        },
        {
          key: "sendStatus",
          label: "发送服务器状态",
          type: "boolean",
          defaultValue: true,
        },
      ],
    },
    api: {
      getStatus() {
        return service?.getStatus?.() ?? {
          enabled: isEnabled(pluginCore.config),
          started: false,
        };
      },

      getLogs(filter = {}) {
        return service?.getLogs?.(filter) ?? {
          logs: [],
          total: 0,
          limit: Number(filter.limit ?? 200) || 200,
          offset: Number(filter.offset ?? 0) || 0,
          type: String(filter.type ?? "all"),
          search: String(filter.search ?? filter.q ?? ""),
          status: {
            enabled: isEnabled(pluginCore.config),
            started: false,
            target: "",
          },
          updatedAt: "",
        };
      },

      clearLogs() {
        return service?.clearLogs?.() ?? { ok: true, cleared: 0 };
      },
    },

    async start() {
      const pluginConfig = readPluginConfig(pluginCore.config);

      if (!isEnabled(pluginCore.config)) {
        pluginLogger?.info?.("UDP event forwarder is disabled by configuration.", {
          module: PLUGIN_NAME,
          ownerType: "plugin",
          ownerName: PLUGIN_ID,
        });
        return {
          started: false,
          reason: "plugins.udpEventForwarder.enabled is not true",
        };
      }

      if (service) {
        return {
          started: true,
          reason: "already_started",
          status: service.getStatus(),
        };
      }

      service = createUdpEventForwarderService({
        eventBus: pluginCore.eventBus,
        logger: pluginLogger,
        config: pluginCore.config,
        modules,
        pluginConfig,
      });

      await service.start();

      return {
        started: true,
        status: service.getStatus(),
      };
    },

    async stop() {
      if (!service) {
        return {
          stopped: true,
          reason: "not_started",
        };
      }

      await service.stop();
      const status = service.getStatus();
      service = null;

      return {
        stopped: true,
        status,
      };
    },

    getStatus() {
      if (!service) {
        return {
          enabled: isEnabled(pluginCore.config),
          started: false,
        };
      }

      return service.getStatus();
    },
  };
}

export default { createPlugin };
