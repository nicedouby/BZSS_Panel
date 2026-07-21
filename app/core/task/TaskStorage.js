import fs from "node:fs/promises";
import path from "node:path";

export class TaskStorage {
  constructor({ directory = path.join("data", "tasks"), logger = console } = {}) {
    this.directory = path.resolve(process.cwd(), directory);
    this.logger = logger;
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
  }

  filePath(id) {
    return path.join(this.directory, String(id) + ".json");
  }

  async save(task) {
    const target = this.filePath(task.id);
    const temp = target + ".tmp";
    await fs.writeFile(temp, JSON.stringify(task, null, 2), "utf8");
    await fs.rename(temp, target);
    return task;
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
      if (!name.endsWith(".json") || name.endsWith(".tmp.json")) continue;
      try {
        tasks.push(JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8")));
      } catch (error) {
        this.logger.warn?.("[TaskStorage] ignored unreadable task " + name + ": " + error.message);
      }
    }
    return tasks;
  }
}
