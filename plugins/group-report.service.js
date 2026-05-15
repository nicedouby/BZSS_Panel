// -*- coding: utf-8 -*-

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export function nowMs() {
  return Date.now();
}

export function createGroupId() {
  return `grp_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
}

export function normalizeGroupName(value) {
  const text = String(value ?? "").trim();
  return text ? text : "未命名抱团";
}

export function normalizeMemberName(value) {
  const text = String(value ?? "").trim();
  return text ? text : "未知玩家";
}

export function normalizeOptionalText(value) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

export function buildPlayerKey(input = {}) {
  const eosId = String(input.eosId ?? "").trim();
  if (eosId) return `eos:${eosId}`;

  const steamId = String(input.steamId ?? "").trim();
  if (steamId) return `steam:${steamId}`;

  throw new Error("Cannot build playerKey: eosId and steamId are both empty.");
}

export function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

export class GroupReportService {
  constructor({ dataDir, eventBus, singleGroupPerPlayer = false } = {}) {
    if (!dataDir) {
      throw new Error("GroupReportService requires dataDir.");
    }

    this.filePath = path.join(dataDir, "plugins", "group-report", "groups.json");
    this.eventBus = eventBus ?? null;
    this.singleGroupPerPlayer = Boolean(singleGroupPerPlayer);
    this.loaded = false;
    this.writeChain = Promise.resolve();
    this.store = {
      version: 1,
      updatedAt: nowMs(),
      groups: [],
    };
  }

  async init() {
    await this.load();
  }

  async load() {
    if (this.loaded) return;

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      this.store = this.normalizeStore(parsed);
    } catch (error) {
      if (error?.code !== "ENOENT") {
        console.warn("[GroupReport] Failed to load store, creating a fresh one.", error);
      }

      this.store = {
        version: 1,
        updatedAt: nowMs(),
        groups: [],
      };

      await this.save();
    }

    this.loaded = true;
  }

  getSnapshot() {
    return {
      plugin: "group-report",
      version: 1,
      generatedAt: nowMs(),
      groups: cloneJson(this.store.groups),
    };
  }

  getGroups() {
    return cloneJson(this.store.groups);
  }

  getGroup(groupId) {
    const group = this.store.groups.find((item) => item.id === String(groupId ?? ""));
    return group ? cloneJson(group) : undefined;
  }

  async createGroup(input = {}) {
    await this.load();

    const at = nowMs();
    const group = {
      id: createGroupId(),
      name: normalizeGroupName(input.name),
      note: normalizeOptionalText(input.note),
      createdAt: at,
      updatedAt: at,
      createdBy: normalizeOptionalText(input.createdBy),
      members: [],
    };

    this.store.groups.unshift(group);
    this.touch();
    await this.save();
    this.emitChanged("group-report.group-created", group.id);

    return cloneJson(group);
  }

  async updateGroup(groupId, input = {}) {
    await this.load();

    const group = this.requireGroup(groupId);

    if (input.name !== undefined) {
      group.name = normalizeGroupName(input.name);
    }

    if (input.note !== undefined) {
      group.note = normalizeOptionalText(input.note);
    }

    group.updatedAt = nowMs();
    this.touch();
    await this.save();
    this.emitChanged("group-report.group-updated", group.id);

    return cloneJson(group);
  }

  async deleteGroup(groupId) {
    await this.load();

    const index = this.store.groups.findIndex((item) => item.id === String(groupId ?? ""));
    if (index < 0) {
      throw new Error(`Group not found: ${groupId}`);
    }

    this.store.groups.splice(index, 1);
    this.touch();
    await this.save();
    this.emitChanged("group-report.group-deleted", String(groupId));
  }

  async addMember(groupId, input = {}) {
    await this.load();

    const group = this.requireGroup(groupId);
    const playerKey = buildPlayerKey(input);
    const removedFromGroups = [];

    if (this.singleGroupPerPlayer) {
      for (const otherGroup of this.store.groups) {
        if (otherGroup.id === group.id) continue;
        const before = otherGroup.members.length;
        otherGroup.members = otherGroup.members.filter((member) => member.playerKey !== playerKey);
        if (otherGroup.members.length !== before) {
          otherGroup.updatedAt = nowMs();
          removedFromGroups.push(otherGroup.id);
        }
      }
    }

    const existing = group.members.find((member) => member.playerKey === playerKey);
    const at = nowMs();

    if (existing) {
      existing.name = normalizeMemberName(input.name);
      existing.eosId = normalizeOptionalText(input.eosId);
      existing.steamId = normalizeOptionalText(input.steamId);
      existing.note = normalizeOptionalText(input.note);
    } else {
      group.members.push({
        playerKey,
        eosId: normalizeOptionalText(input.eosId),
        steamId: normalizeOptionalText(input.steamId),
        name: normalizeMemberName(input.name),
        note: normalizeOptionalText(input.note),
        addedAt: at,
        addedBy: normalizeOptionalText(input.addedBy),
      });
    }

    group.updatedAt = at;
    this.touch();
    await this.save();

    for (const otherGroupId of removedFromGroups) {
      this.emitChanged("group-report.member-removed", otherGroupId, playerKey);
    }

    this.emitChanged(existing ? "group-report.member-updated" : "group-report.member-added", group.id, playerKey);
    return cloneJson(group);
  }

  async updateMember(groupId, playerKey, input = {}) {
    await this.load();

    const group = this.requireGroup(groupId);
    const member = group.members.find((item) => item.playerKey === String(playerKey ?? ""));
    if (!member) {
      throw new Error(`Member not found: ${playerKey}`);
    }

    if (input.name !== undefined) {
      member.name = normalizeMemberName(input.name);
    }

    if (input.note !== undefined) {
      member.note = normalizeOptionalText(input.note);
    }

    if (input.eosId !== undefined) {
      member.eosId = normalizeOptionalText(input.eosId);
    }

    if (input.steamId !== undefined) {
      member.steamId = normalizeOptionalText(input.steamId);
    }

    group.updatedAt = nowMs();
    this.touch();
    await this.save();
    this.emitChanged("group-report.member-updated", group.id, member.playerKey);

    return cloneJson(group);
  }

  async removeMember(groupId, playerKey) {
    await this.load();

    const group = this.requireGroup(groupId);
    const before = group.members.length;
    group.members = group.members.filter((member) => member.playerKey !== String(playerKey ?? ""));

    if (group.members.length === before) {
      throw new Error(`Member not found: ${playerKey}`);
    }

    group.updatedAt = nowMs();
    this.touch();
    await this.save();
    this.emitChanged("group-report.member-removed", group.id, String(playerKey));

    return cloneJson(group);
  }

  requireGroup(groupId) {
    const group = this.store.groups.find((item) => item.id === String(groupId ?? ""));
    if (!group) {
      throw new Error(`Group not found: ${groupId}`);
    }
    return group;
  }

  touch() {
    this.store.updatedAt = nowMs();
  }

  async save() {
    const job = async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tempPath = `${this.filePath}.tmp`;
      await fs.writeFile(tempPath, `${JSON.stringify(this.store, null, 2)}\n`, "utf8");
      await fs.rename(tempPath, this.filePath);
    };

    this.writeChain = this.writeChain.then(job, job);
    await this.writeChain;
  }

  emitChanged(type, groupId, playerKey) {
    const snapshot = this.getSnapshot();
    const event = {
      type,
      at: nowMs(),
      groupId,
      playerKey,
      snapshot,
    };

    this.emitCoreEvent(type, event);
    this.emitCoreEvent("group-report.snapshot-updated", {
      ...event,
      type: "group-report.snapshot-updated",
    });
  }

  emitCoreEvent(eventName, payload) {
    if (typeof this.eventBus?.emitCoreEvent === "function") {
      this.eventBus.emitCoreEvent(eventName, payload);
      return;
    }

    if (typeof this.eventBus?.emit === "function") {
      this.eventBus.emit(eventName, payload);
    }
  }

  normalizeStore(parsed) {
    const groups = Array.isArray(parsed?.groups) ? parsed.groups.map((group) => this.normalizeGroup(group)) : [];
    return {
      version: 1,
      updatedAt: typeof parsed?.updatedAt === "number" ? parsed.updatedAt : nowMs(),
      groups,
    };
  }

  normalizeGroup(group) {
    const members = Array.isArray(group?.members) ? group.members.map((member) => this.normalizeMember(member)).filter(Boolean) : [];
    return {
      id: String(group?.id ?? createGroupId()),
      name: normalizeGroupName(group?.name),
      note: normalizeOptionalText(group?.note),
      createdAt: Number(group?.createdAt ?? nowMs()) || nowMs(),
      updatedAt: Number(group?.updatedAt ?? nowMs()) || nowMs(),
      createdBy: normalizeOptionalText(group?.createdBy),
      members,
    };
  }

  normalizeMember(member) {
    try {
      const playerKey = String(member?.playerKey ?? "").trim() || buildPlayerKey(member);
      return {
        playerKey,
        eosId: normalizeOptionalText(member?.eosId),
        steamId: normalizeOptionalText(member?.steamId),
        name: normalizeMemberName(member?.name),
        note: normalizeOptionalText(member?.note),
        addedAt: Number(member?.addedAt ?? nowMs()) || nowMs(),
        addedBy: normalizeOptionalText(member?.addedBy),
      };
    } catch {
      return null;
    }
  }
}
