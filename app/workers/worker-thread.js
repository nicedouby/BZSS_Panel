import { parentPort, workerData } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTaskModulePath } from "../core/task/TaskRegistry.js";

parentPort.on("message", async (message) => {
  if (message?.event !== "run") return;
  const task = message.task;
  try {
    const modulePath = getTaskModulePath(task.type);
    if (!modulePath) throw Object.assign(new Error("Unknown task type: " + task.type), { code: "UnknownTaskType" });
    const moduleUrl = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../core/task", modulePath)).href;
    const module = await import(moduleUrl);
    const execute = module.execute ?? module.default?.execute;
    if (typeof execute !== "function") throw new Error("Task module has no execute().");
    const result = await execute(task, {
      workerId: workerData?.workerId,
      reportProgress(progress) {
        parentPort.postMessage({ event: "progress", taskId: task.id, progress });
      },
    });
    parentPort.postMessage({ event: "done", taskId: task.id, result });
  } catch (error) {
    parentPort.postMessage({
      event: "failed",
      taskId: task.id,
      error: { name: error?.name, message: error?.message, stack: error?.stack, code: error?.code },
    });
  }
});
