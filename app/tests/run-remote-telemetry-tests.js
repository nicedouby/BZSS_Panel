import assert from "node:assert/strict";
import net from "node:net";

import { EventBus } from "../core/event-bus.js";
import { createRemoteTelemetryModule } from "../modules/remote-telemetry/index.js";

function createSilentLogger() {
  return {
    debug() {},
    info() {},
    warn() {},
    error() {},
    event() {},
    child() { return this; },
  };
}

function createModule(configValues = {}) {
  const logger = createSilentLogger();
  const eventBus = new EventBus({ logger });
  const module = createRemoteTelemetryModule({
    core: {
      logger,
      eventBus,
      createLogger() {
        return logger;
      },
    },
    config: {
      get(path, defaultValue) {
        if (path === "modules.remoteTelemetry") {
          return { ...defaultValue, ...configValues };
        }
        return defaultValue;
      },
    },
    logger,
  });
  return { module, eventBus };
}

async function createFakeCommandServer(responder) {
  const requests = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak < 0) return;
      const line = buffer.slice(0, lineBreak).trim();
      buffer = buffer.slice(lineBreak + 1);
      if (!line) return;

      const payload = JSON.parse(line);
      requests.push(payload);
      const response = responder?.(payload, requests) ?? {
        ok: true,
        pid: 2952,
        type: payload.action === "read_tickets" ? "ticket_read" : payload.action === "set_tickets" ? "ticket_write" : "ticket_adjust",
        t1: payload.t1,
        t2: payload.t2,
      };
      socket.write(`${JSON.stringify(response)}\n`);
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    port,
    requests,
    server,
    async cleanup() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function testTracksLatestTicketSample() {
  const { module } = createModule();
  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 2952,
    timestamp: 1760000000,
    ok: true,
    t1: 320,
    t2: 287,
    layer: "Narva_RAAS_v1",
    player_count: 74,
  }, { address: "192.168.0.50", port: 50123 }));

  const state = module.api.getState();
  assert.equal(state.currentSample.tickets.team1, 320);
  assert.equal(state.currentSample.tickets.team2, 287);
  assert.equal(state.currentSource.projectDir, "C:\\server");
  assert.equal(state.currentSource.online, true);
  assert.equal(state.currentSample.playerCount, 74);
  assert.equal(state.commandTarget.host, "192.168.0.50");
  assert.equal(state.commandTarget.port, 12765);
}

async function testFlagsTicketIncreaseAndAcquisitionFailure() {
  const { module } = createModule({ freezeSampleThreshold: 2 });
  const remoteInfo = { address: "192.168.0.51", port: 50124 };

  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 3001,
    timestamp: 1760000000,
    ok: true,
    t1: 320,
    t2: 287,
  }, remoteInfo));
  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 3001,
    timestamp: 1760000002,
    ok: true,
    t1: 321,
    t2: 287,
  }, remoteInfo));

  let state = module.api.getState();
  assert.ok(state.currentSource.anomalyFlags.includes("ticket_increase_team1"));

  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 3001,
    timestamp: 1760000004,
    ok: false,
    error: "SquadGameServer.exe not found in current directory",
  }, remoteInfo));

  state = module.api.getState();
  assert.ok(state.currentSource.anomalyFlags.includes("acquisition_failed"));
  assert.equal(state.currentSource.lastError, "SquadGameServer.exe not found in current directory");
}

async function testTracksBoundedIncrementalTicketHistoryAndReset() {
  const { module } = createModule({ ticketHistoryLimit: 2 });
  const remoteInfo = { address: "192.168.0.52", port: 50129 };
  const makeSample = (timestamp, t1, t2) => module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 3010,
    timestamp,
    ok: true,
    t1,
    t2,
    layer: "Narva_RAAS_v1",
  }, remoteInfo);

  module.api.ingestSample(makeSample(1760000000, 320, 287));
  module.api.ingestSample(makeSample(1760000002, 319, 287));
  module.api.ingestSample(makeSample(1760000004, 318, 286));

  const history = module.api.getTicketHistory();
  assert.equal(history.points.length, 2);
  assert.deepEqual(history.points.map((point) => [point.team1, point.team2]), [[319, 287], [318, 286]]);
  assert.equal(history.currentTickets.team1, 318);

  const incremental = module.api.getTicketHistory({ sinceMs: history.points[0].timestampMs });
  assert.equal(incremental.points.length, 1);
  assert.equal(incremental.points[0].team1, 318);

  const revision = history.revision;
  module.api.resetTicketHistory("test");
  const reset = module.api.getTicketHistory();
  assert.equal(reset.points.length, 0);
  assert.equal(reset.revision, revision + 1);
  assert.equal(reset.resetReason, "test");
}

async function testTrackedSourcesStayBoundedAcrossProcessRestarts() {
  const { module } = createModule({ maxTrackedSources: 2 });

  for (let pid = 3001; pid <= 3006; pid += 1) {
    module.api.ingestSample(module.api.normalizeMessage({
      type: "ticket_sample",
      project_dir: "C:\\server",
      exe: "SquadGameServer.exe",
      pid,
      timestamp: 1760000000 + pid,
      ok: true,
      t1: 300,
      t2: 300,
    }, { address: "192.168.0.60", port: 50000 + pid }));
  }

  const state = module.api.getState();
  assert.equal(state.sources.length, 2);
  assert.equal(state.resourceLimits.maxTrackedSources, 2);
}

async function testWriteTicketsUsesCommandPort() {
  const commandServer = await createFakeCommandServer((payload) => ({
    ok: true,
    pid: payload.pid,
    type: "ticket_write",
    t1: payload.t1,
    t2: payload.t2,
  }));
  const { module } = createModule({
    commandHost: "127.0.0.1",
    commandPort: commandServer.port,
  });
  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 2952,
    timestamp: 1760000000,
    ok: true,
    t1: 320,
    t2: 287,
  }, { address: "127.0.0.1", port: 50125 }));

  const result = await module.api.writeTickets({ t1: 300, t2: 250 });
  assert.equal(result.ok, true);
  assert.deepEqual(commandServer.requests[0], { action: "set_tickets", t1: 300, t2: 250 });
  assert.equal(result.response.t1, 300);
  assert.equal(result.response.t2, 250);

  await commandServer.cleanup();
}

async function testWriteTicketsFallsBackToRemoteAddress() {
  const commandServer = await createFakeCommandServer((payload) => ({
    ok: true,
    pid: payload.pid,
    type: "ticket_write",
    t1: payload.t1,
    t2: payload.t2,
  }));
  const { module } = createModule({
    commandPort: commandServer.port,
  });
  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 2952,
    timestamp: 1760000000,
    ok: true,
    t1: 320,
    t2: 287,
  }, { address: "127.0.0.1", port: 50126 }));

  const result = await module.api.writeTickets({ t1: 260 });
  assert.equal(result.ok, true);
  assert.deepEqual(commandServer.requests[0], { action: "set_tickets", t1: 260 });
  assert.equal(result.response.t1, 260);

  await commandServer.cleanup();
}

async function testConfiguredCommandHostOverridesSenderAddress() {
  const commandServer = await createFakeCommandServer((payload) => ({
    ok: true,
    pid: payload.pid,
    type: "ticket_write",
    t1: payload.t1,
    t2: payload.t2,
  }));
  const { module } = createModule({
    commandHost: "127.0.0.1",
    commandPort: commandServer.port,
  });
  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 2952,
    timestamp: 1760000000,
    ok: true,
    t1: 320,
    t2: 287,
    command_host: "192.168.0.184",
    command_port: 12765,
  }, { address: "192.168.0.184", port: 50127 }));

  const result = await module.api.writeTickets({ t2: 180 });
  assert.equal(result.ok, true);
  assert.deepEqual(commandServer.requests[0], { action: "set_tickets", t2: 180 });
  assert.equal(result.response.t2, 180);

  await commandServer.cleanup();
}

async function testAdjustTicketsSupportsClampAndDelta() {
  const commandServer = await createFakeCommandServer((payload) => ({
    ok: true,
    pid: payload.pid,
    type: payload.action === "adjust_tickets" ? "ticket_adjust" : payload.action === "read_tickets" ? "ticket_read" : "ticket_write",
    t1: payload.t1 ?? null,
    t2: payload.t2 ?? null,
  }));
  const { module } = createModule({
    commandHost: "127.0.0.1",
    commandPort: commandServer.port,
  });
  module.api.ingestSample(module.api.normalizeMessage({
    type: "ticket_sample",
    project_dir: "C:\\server",
    exe: "SquadGameServer.exe",
    pid: 2952,
    timestamp: 1760000000,
    ok: true,
    t1: 20,
    t2: 30,
  }, { address: "127.0.0.1", port: 50128 }));

  const result = await module.api.adjustTickets({ team: 1, delta: -50 });
  assert.equal(result.ok, true);
  assert.equal(result.before.t1, 20);
  assert.equal(result.delta.t1, -50);
  assert.equal(result.after.t1, 0);
  assert.deepEqual(commandServer.requests[0], { action: "adjust_tickets", team: 1, delta: -50 });

  const clamped = await module.api.adjustTickets({ addT2: 500, clampMax: 100 });
  assert.deepEqual(commandServer.requests[1], { action: "adjust_tickets", add_t2: 500 });
  assert.equal(clamped.response.type, "ticket_adjust");

  const readResult = await module.api.readTickets();
  assert.equal(readResult.ok, true);
  assert.deepEqual(commandServer.requests[2], { action: "read_tickets" });

  await commandServer.cleanup();
}

async function run() {
  await testTracksLatestTicketSample();
  await testFlagsTicketIncreaseAndAcquisitionFailure();
  await testTracksBoundedIncrementalTicketHistoryAndReset();
  await testTrackedSourcesStayBoundedAcrossProcessRestarts();
  await testWriteTicketsUsesCommandPort();
  await testWriteTicketsFallsBackToRemoteAddress();
  await testConfiguredCommandHostOverridesSenderAddress();
  await testAdjustTicketsSupportsClampAndDelta();
  console.log("[run-remote-telemetry-tests] OK");
}

run();
