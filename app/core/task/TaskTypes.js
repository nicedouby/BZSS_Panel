export const TaskTypes = Object.freeze({
  SNAPSHOT_IMAGE: "snapshot.generate",
  SEND_QQ_IMAGE: "qq.send_image",
  EXPORT_DATA: "data.export",
  MATCH_STATISTICS: "match.statistics",
});

export const TaskStatus = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
});

export const DEFAULT_TASK_CONFIG = Object.freeze({
  workers: 4,
  maxQueue: 100,
  taskTimeout: 600000,
  maxRetry: 2,
});
