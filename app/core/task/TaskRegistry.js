import { TaskTypes } from "./TaskTypes.js";

const registry = new Map();

export function registerTask(type, modulePath) {
  if (!type || !modulePath) throw new TypeError("Task type and module path are required.");
  registry.set(String(type), String(modulePath));
}

export function getTaskModulePath(type) {
  return registry.get(String(type)) ?? null;
}

export function listRegisteredTasks() {
  return [...registry.keys()];
}

registerTask(TaskTypes.SNAPSHOT_IMAGE, "../tasks/snapshot/GenerateSnapshotImageTask.js");
