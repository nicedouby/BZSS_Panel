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

    const moduleEventName = toModuleEventName(event.eventType);
    const payload = {
      eventId: `module.squadLifecycle.event:${event.id}`,
      eventName: `module.squadLifecycle.${moduleEventName}`,
      layer: "module",
      source: "module.squadLifecycle",
      serverId: event.serverId,
      time: new Date(event.eventTime || Date.now()).toISOString(),
      params: [],
      payload: event,
      lifecycleEvent: event,
    };

    this.core.eventBus.emitModuleEvent("module.squadLifecycle", "updated", payload);
    this.core.eventBus.emitModuleEvent("module.squadLifecycle", moduleEventName, payload);
  }
}

function toModuleEventName(eventType) {
  switch (eventType) {
    case "squad.created": return "squadCreated";
    case "squad.updated": return "updated";
    case "squad.missing_candidate": return "squadMissingCandidate";
    case "squad.recovered": return "squadRecovered";
    case "squad.disbanded": return "squadDisbanded";
    case "squad.closed_by_match_end": return "squadClosedByMatchEnd";
    default: return "updated";
  }
}
