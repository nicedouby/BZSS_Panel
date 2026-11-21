export function installWarmView({ panel, viewport, layout, cleanup, healthy, paused, resumed, signal }) {
  const hidden = [];
  let active = true;
  let expiry = 0;

  function protectMap() {
    layout?.classList.add("tactical-3d-active");
    for (const child of viewport.children) {
      if (child === panel || !(child instanceof HTMLElement) || child.inert) continue;
      child.inert = true;
      hidden.push(child);
    }
  }

  function restoreMap() {
    layout?.classList.remove("tactical-3d-active");
    for (const child of hidden) child.inert = false;
    hidden.length = 0;
  }

  protectMap();
  signal.addEventListener("abort", () => {
    clearTimeout(expiry);
    restoreMap();
    active = false;
  }, { once: true });

  return {
    get active() { return active; },
    suspend() {
      if (!active) return;
      active = false;
      paused();
      if (!healthy()) { cleanup(); return; }
      panel.remove();
      restoreMap();
      expiry = setTimeout(cleanup, 120_000);
    },
    resume(options) {
      if (signal.aborted || !healthy()) { cleanup(); return false; }
      if (active) return true;
      clearTimeout(expiry);
      viewport.append(panel);
      active = true;
      protectMap();
      resumed(options);
      return true;
    },
    cleanup,
  };
}
