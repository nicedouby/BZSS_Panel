import fs from "node:fs/promises";
import path from "node:path";

export class TaskStorage {
  constructor({ directory = path.join("data", "tasks"), logger = console } = {}) {
    this.directory = path.resolve(process.cwd(), directory);
    this.logger = logger;
    this.writeChains = new Map();
    this.tempSequence = 0;
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    await this.cleanupOrphanedTempFiles();
  }

  filePath(id) {
    return path.join(this.directory, String(id) + ".json");
  }

  async save(task) {
    if (!task?.id) throw new Error("Task id is required for persistence.");

    const target = this.filePath(task.id);
    // Capture the state at the moment save() is requested. The live task object
    // may be mutated by a following progress/done message before this write runs.
    const serialized = JSON.stringify(task, null, 2);
    const previous = this.writeChains.get(target) ?? Promise.resolve();
    const operation = previous
      .catch((error) => {
        this.logger.warn?.("[TaskStorage] previous write failed for " + task.id + ": " + (error?.message || error));
      })
      .then(() => this.writeAtomic(target, serialized));

    this.writeChains.set(target, operation);
    try {
      await operation;
      return task;
    } finally {
      if (this.writeChains.get(target) === operation) this.writeChains.delete(target);
    }
  }

  async writeAtomic(target, serialized) {
    await fs.mkdir(this.directory, { recursive: true });
    const sequence = ++this.tempSequence;
    const temp = `${target}.${process.pid}.${Date.now()}.${sequence}.tmp`;

    try {
      await fs.writeFile(temp, serialized, { encoding: "utf8", flag: "wx" });
      await renameWithRetry(temp, target);
    } finally {
      // rename() removes the temporary path on success. force:true also cleans
      // up an orphan if a later operation failed, without masking the real error.
      await fs.rm(temp, { force: true }).catch(() => {});
    }
  }

  async cleanupOrphanedTempFiles() {
    let names;
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    await Promise.all(names
      .filter((name) => name.includes(".json.") && name.endsWith(".tmp"))
      .map(async (name) => {
        try {
          await fs.rm(path.join(this.directory, name), { force: true });
        } catch (error) {
          this.logger.warn?.("[TaskStorage] failed to remove orphan temp file " + name + ": " + error.message);
        }
      }));
  }

  async load(id) {
    try {
      return JSON.parse(await fs.readFile(this.filePath(id), "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async list() {
    const names = await fs.readdir(this.directory);
    const tasks = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        tasks.push(JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")));
      } catch (error) {
        this.logger.warn?.("[TaskStorage] ignored unreadable task " + name + ": " + error.message);
      }
    }
    return tasks;
  }
}

async function renameWithRetry(source, target) {
  const retryableCodes = new Set(["EACCES", "EBUSY", "EPERM"]);
  let lastError = null;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!retryableCodes.has(error?.code) || attempt === 3) throw error;
      await delay(10 * (attempt + 1));
    }
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
