export class TaskQueue {
  constructor({ maxQueue = 100 } = {}) {
    this.maxQueue = Math.max(1, Number(maxQueue) || 100);
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  enqueue(task) {
    if (this.items.length >= this.maxQueue) {
      const error = new Error("Task queue is full.");
      error.code = "TaskQueueFull";
      throw error;
    }
    this.items.push(task);
    this.items.sort((left, right) =>
      Number(right.priority ?? 5) - Number(left.priority ?? 5)
      || String(left.createdAt).localeCompare(String(right.createdAt)),
    );
    return task;
  }

  dequeue() {
    return this.items.shift() ?? null;
  }

  remove(taskId) {
    const index = this.items.findIndex((task) => task.id === taskId);
    if (index < 0) return null;
    return this.items.splice(index, 1)[0];
  }

  list() {
    return this.items.map((task) => ({ ...task }));
  }
}
