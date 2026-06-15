type IdleCallbackHandle = number;

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining: () => number;
}

export function scheduleIdleTask(task: () => void, timeout = 200): IdleCallbackHandle {
  const idleCallback = window.requestIdleCallback as
    | ((callback: (deadline: IdleDeadlineLike) => void, options?: { timeout: number }) => IdleCallbackHandle)
    | undefined;

  if (typeof idleCallback === "function") {
    return idleCallback(() => {
      task();
    }, { timeout });
  }

  return window.setTimeout(task, 16);
}

export function cancelIdleTask(handle: IdleCallbackHandle | null | undefined) {
  if (handle == null) return;

  const cancelIdleCallback = window.cancelIdleCallback as ((id: IdleCallbackHandle) => void) | undefined;
  if (typeof cancelIdleCallback === "function") {
    cancelIdleCallback(handle);
    return;
  }

  window.clearTimeout(handle);
}
