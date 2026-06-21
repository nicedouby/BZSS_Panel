import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

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

async function createFakeTicketToolSandbox(initialState = { pid: 2952, t1: 320, t2: 287 }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-ticket-tool-"));
  const scriptPath = path.join(dir, "squad_ticket_tool.py");
  const statePath = path.join(dir, "state.json");
  await fs.writeFile(statePath, JSON.stringify(initialState), "utf8");
  await fs.writeFile(scriptPath, String.raw`#!/usr/bin/env python3
import argparse
import json
import os
from pathlib import Path

def load_state():
    state_file = Path(os.environ["FAKE_TICKET_STATE_FILE"])
    return json.loads(state_file.read_text(encoding="utf-8"))

def save_state(state):
    state_file = Path(os.environ["FAKE_TICKET_STATE_FILE"])
    state_file.write_text(json.dumps(state), encoding="utf-8")

def clamp_value(value, no_clamp, clamp_max):
    if not no_clamp:
        value = max(0, value)
    if clamp_max is not None:
        value = min(clamp_max, value)
    return value

parser = argparse.ArgumentParser()
parser.add_argument("pid", type=int)
parser.add_argument("--read", action="store_true")
parser.add_argument("--watch", action="store_true")
parser.add_argument("--interval", type=float, default=2.0)
parser.add_argument("--t1")
parser.add_argument("--t2")
parser.add_argument("--add-t1")
parser.add_argument("--add-t2")
parser.add_argument("--no-clamp", action="store_true")
parser.add_argument("--clamp-max", type=int)
args = parser.parse_args()

state = load_state()
before = {"t1": state["t1"], "t2": state["t2"]}

if args.watch:
    print(json.dumps({"ok": True, "pid": args.pid, "t1": state["t1"], "t2": state["t2"]}))
    raise SystemExit(0)

if args.add_t1 is not None or args.add_t2 is not None:
    delta_t1 = int(args.add_t1) if args.add_t1 is not None else 0
    delta_t2 = int(args.add_t2) if args.add_t2 is not None else 0
    state["t1"] = clamp_value(state["t1"] + delta_t1, args.no_clamp, args.clamp_max)
    state["t2"] = clamp_value(state["t2"] + delta_t2, args.no_clamp, args.clamp_max)
    save_state(state)
    print(json.dumps({
        "ok": True,
        "pid": args.pid,
        "mode": "adjust",
        "before": before,
        "delta": {"t1": delta_t1, "t2": delta_t2},
        "after": {"t1": state["t1"], "t2": state["t2"]},
    }))
    raise SystemExit(0)

if args.t1 is not None:
    state["t1"] = int(args.t1)
if args.t2 is not None:
    state["t2"] = int(args.t2)
save_state(state)
print(json.dumps({"ok": True, "pid": args.pid, "t1": state["t1"], "t2": state["t2"]}))
`, "utf8");
  await fs.chmod(scriptPath, 0o755);
  const previousStateFile = process.env.FAKE_TICKET_STATE_FILE;
  process.env.FAKE_TICKET_STATE_FILE = statePath;
  return {
    dir,
    scriptPath,
    statePath,
    restoreEnv() {
      if (previousStateFile === undefined) delete process.env.FAKE_TICKET_STATE_FILE;
      else process.env.FAKE_TICKET_STATE_FILE = previousStateFile;
    },
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
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

async function testWriteTicketsUsesCommandPort() {
  const sandbox = await createFakeTicketToolSandbox();
  const { module } = createModule({
    scriptPath: sandbox.scriptPath,
    workingDirectory: sandbox.dir,
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
  assert.equal(result.t1, 300);
  assert.equal(result.t2, 250);
  assert.equal(result.pid, 2952);

  await sandbox.cleanup();
  sandbox.restoreEnv();
}

async function testWriteTicketsFallsBackToRemoteAddress() {
  const sandbox = await createFakeTicketToolSandbox();
  const { module } = createModule({
    scriptPath: sandbox.scriptPath,
    workingDirectory: sandbox.dir,
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
  assert.equal(result.t1, 260);
  assert.equal(result.pid, 2952);

  await sandbox.cleanup();
  sandbox.restoreEnv();
}

async function testConfiguredCommandHostOverridesSenderAddress() {
  const sandbox = await createFakeTicketToolSandbox();
  const { module } = createModule({
    commandHost: "127.0.0.1",
    scriptPath: sandbox.scriptPath,
    workingDirectory: sandbox.dir,
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
  assert.equal(result.t2, 180);
  assert.equal(result.pid, 2952);

  await sandbox.cleanup();
  sandbox.restoreEnv();
}

async function testAdjustTicketsSupportsClampAndDelta() {
  const sandbox = await createFakeTicketToolSandbox({ pid: 2952, t1: 20, t2: 30 });
  const { module } = createModule({
    scriptPath: sandbox.scriptPath,
    workingDirectory: sandbox.dir,
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

  const result = await module.api.adjustTickets({ addT1: -50 });
  assert.equal(result.ok, true);
  assert.equal(result.before.t1, 20);
  assert.equal(result.delta.t1, -50);
  assert.equal(result.after.t1, 0);

  const clamped = await module.api.adjustTickets({ addT2: 500, clampMax: 100 });
  assert.equal(clamped.after.t2, 100);

  await sandbox.cleanup();
  sandbox.restoreEnv();
}

async function run() {
  await testTracksLatestTicketSample();
  await testFlagsTicketIncreaseAndAcquisitionFailure();
  await testWriteTicketsUsesCommandPort();
  await testWriteTicketsFallsBackToRemoteAddress();
  await testConfiguredCommandHostOverridesSenderAddress();
  await testAdjustTicketsSupportsClampAndDelta();
  console.log("[run-remote-telemetry-tests] OK");
}

run();
