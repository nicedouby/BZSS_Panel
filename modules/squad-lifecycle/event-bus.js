// -*- coding: utf-8 -*-

export class NoopSquadLifecycleEventBus {
  emitSquadLifecycleEvent() {}
}

export class BzssSquadLifecycleEventBus {
  constructor({ core }) {
    this.core = core;
  }

  emitSquadLifecycleEvent(event) {
    this.core.eventBus.emitCoreEvent("SQUAD_LIFECYCLE_EVENT", {
      eventId: `SQUAD_LIFECYCLE_EVENT:${event.id}`,
      eventName: "SQUAD_LIFECYCLE_EVENT",
      layer: "core",
      source: "module.squadLifecycle",
      serverId: event.serverId,
      time: new Date(event.eventTime || Date.now()).toISOString(),
      params: [],
      payload: event,
      lifecycleEvent: event,
    });

    this.core.eventBus.emitModuleEvent("module.squadLifecycle", "event", {
      eventId: `module.squadLifecycle.event:${event.id}`,
      eventName: "module.squadLifecycle.event",
      layer: "module",
      source: "module.squadLifecycle",
      serverId: event.serverId,
      time: new Date(event.eventTime || Date.now()).toISOString(),
      params: [],
      payload: event,
      lifecycleEvent: event,
    });
  }
}
