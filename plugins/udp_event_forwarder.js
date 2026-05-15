import { createUdpEventForwarderService } from "./services/udp_event_forwarder_service.js";

const PLUGIN_ID = "udp_event_forwarder";
const PLUGIN_NAME = "UDP Event Forwarder";

function isEnabled() {
  return String(process.env.UDP_EVENT_FORWARDER_ENABLED || "false").toLowerCase() === "true";
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
    manifest: {
      id: "plugin.udp_event_forwarder",
      name: PLUGIN_NAME,
      kind: "plugin",
      version: "1.0.0",
      description: "Forward selected internal EventBus events to an external UDP receiver.",
    },

    async start() {
      if (!isEnabled()) {
        pluginLogger?.info?.("UDP event forwarder is disabled by configuration.", {
          module: PLUGIN_NAME,
          ownerType: "plugin",
          ownerName: PLUGIN_ID,
        });
        return {
          started: false,
          reason: "UDP_EVENT_FORWARDER_ENABLED is not true",
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
          enabled: isEnabled(),
          started: false,
        };
      }

      return service.getStatus();
    },
  };
}

export default { createPlugin };
