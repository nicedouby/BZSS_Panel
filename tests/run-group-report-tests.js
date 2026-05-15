import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  GroupReportService,
  buildPlayerKey,
} from "../plugins/group-report.service.js";

async function withService(run) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-group-report-"));
  const events = [];
  const service = new GroupReportService({
    dataDir: tempDir,
    eventBus: {
      emitCoreEvent(eventName, payload) {
        events.push({ eventName, payload });
      },
    },
  });

  try {
    await service.init();
    await run({ service, events, tempDir });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testBuildPlayerKey() {
  assert.equal(buildPlayerKey({ eosId: "  eos-1  " }), "eos:eos-1");
  assert.equal(buildPlayerKey({ steamId: "  7656119  " }), "steam:7656119");
  assert.throws(() => buildPlayerKey({}), /both empty/);
}

async function testCrudAndPersistence() {
  await withService(async ({ service, events, tempDir }) => {
    const group = await service.createGroup({
      name: "抱团 A",
      note: "经常一起进服",
      createdBy: "admin",
    });

    assert.equal(group.name, "抱团 A");
    assert.equal(service.getSnapshot().groups.length, 1);
    assert.equal(events.at(-1)?.eventName, "group-report.snapshot-updated");

    const member = await service.addMember(group.id, {
      name: "玩家1",
      eosId: "0002xxxx",
      steamId: "7656119xxxx",
      note: "首发成员",
      addedBy: "admin",
    });

    assert.equal(member.members.length, 1);
    assert.equal(member.members[0].playerKey, "eos:0002xxxx");
    assert.equal(events.at(-1)?.eventName, "group-report.snapshot-updated");

    const updated = await service.updateMember(group.id, member.members[0].playerKey, {
      note: "已确认",
    });
    assert.equal(updated.members[0].note, "已确认");

    const removed = await service.removeMember(group.id, member.members[0].playerKey);
    assert.equal(removed.members.length, 0);

    await service.deleteGroup(group.id);
    assert.equal(service.getSnapshot().groups.length, 0);

    const savedPath = path.join(tempDir, "plugins", "group-report", "groups.json");
    const saved = JSON.parse(await fs.readFile(savedPath, "utf8"));
    assert.equal(saved.version, 1);
    assert.equal(saved.groups.length, 0);
  });
}

async function testReloadFromDisk() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bzss-group-report-"));
  try {
    const first = new GroupReportService({ dataDir: tempDir });
    await first.init();
    const group = await first.createGroup({ name: "Persisted" });
    await first.addMember(group.id, {
      name: "玩家2",
      steamId: "76561198888888888",
    });

    const second = new GroupReportService({ dataDir: tempDir });
    await second.init();
    const snapshot = second.getSnapshot();
    assert.equal(snapshot.groups.length, 1);
    assert.equal(snapshot.groups[0].members[0].playerKey, "steam:76561198888888888");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

await testBuildPlayerKey();
await testCrudAndPersistence();
await testReloadFromDisk();

console.log("group report tests passed");
