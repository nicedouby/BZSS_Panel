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

async function testWriteTicketsUsesCommandPort() {
  const responses = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak < 0) return;
      const line = buffer.slice(0, lineBreak);
      responses.push(JSON.parse(line));
      socket.write(`${JSON.stringify({ ok: true, type: "ticket_write", pid: 2952, t1: 300, t2: 250 })}\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { module } = createModule({
    commandPort: port,
    commandTimeoutMs: 2000,
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
    command_host: "127.0.0.1",
    command_port: port,
  }, { address: "127.0.0.1", port: 50125 }));

  const result = await module.api.writeTickets({ t1: 300, t2: 250 });
  assert.equal(result.ok, true);
  assert.equal(result.response.t1, 300);
  assert.equal(result.response.t2, 250);
  assert.deepEqual(responses[0], { action: "set_tickets", t1: 300, t2: 250 });

  await new Promise((resolve) => server.close(resolve));
}

async function testWriteTicketsFallsBackToRemoteAddress() {
  const responses = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak < 0) return;
      const line = buffer.slice(0, lineBreak);
      responses.push(JSON.parse(line));
      socket.write(`${JSON.stringify({ ok: true, type: "ticket_write", pid: 2952, t1: 260 })}\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { module } = createModule({
    commandPort: port,
    commandTimeoutMs: 2000,
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
  assert.equal(result.target.host, "127.0.0.1");
  assert.equal(result.response.t1, 260);
  assert.deepEqual(responses[0], { action: "set_tickets", t1: 260 });

  await new Promise((resolve) => server.close(resolve));
}

async function testConfiguredCommandHostOverridesSenderAddress() {
  const responses = [];
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineBreak = buffer.indexOf("\n");
      if (lineBreak < 0) return;
      const line = buffer.slice(0, lineBreak);
      responses.push(JSON.parse(line));
      socket.write(`${JSON.stringify({ ok: true, type: "ticket_write", pid: 2952, t2: 180 })}\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  const { module } = createModule({
    commandHost: "127.0.0.1",
    commandPort: port,
    commandTimeoutMs: 2000,
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
  assert.equal(result.target.host, "127.0.0.1");
  assert.equal(result.response.t2, 180);
  assert.deepEqual(responses[0], { action: "set_tickets", t2: 180 });

  await new Promise((resolve) => server.close(resolve));
}

async function run() {
  await testTracksLatestTicketSample();
  await testFlagsTicketIncreaseAndAcquisitionFailure();
  await testWriteTicketsUsesCommandPort();
  await testWriteTicketsFallsBackToRemoteAddress();
  await testConfiguredCommandHostOverridesSenderAddress();
  console.log("[run-remote-telemetry-tests] OK");
}

run();
