import { nextTick } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canAutoRefreshNow,
  isAutoRefreshEditing,
  resetAutoRefreshGateForTest,
  useAutoRefreshGate,
} from "./useAutoRefreshGate";

describe("useAutoRefreshGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = "";
    resetAutoRefreshGateForTest();
  });

  afterEach(() => {
    resetAutoRefreshGateForTest();
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("pauses auto refresh while an editable field is focused", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);

    const { canAutoRefresh } = useAutoRefreshGate();
    expect(canAutoRefresh.value).toBe(true);

    input.focus();
    await nextTick();

    expect(isAutoRefreshEditing()).toBe(true);
    expect(canAutoRefreshNow()).toBe(false);
    expect(canAutoRefresh.value).toBe(false);

    input.blur();
    await vi.advanceTimersByTimeAsync(1499);
    expect(canAutoRefreshNow()).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(canAutoRefreshNow()).toBe(true);
    expect(canAutoRefresh.value).toBe(true);
  });

  it("keeps refresh paused through composition input", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    useAutoRefreshGate();

    input.focus();
    input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    input.blur();

    await vi.advanceTimersByTimeAsync(2000);
    expect(canAutoRefreshNow()).toBe(false);

    input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    await vi.advanceTimersByTimeAsync(1500);

    expect(canAutoRefreshNow()).toBe(true);
  });

  it("pauses after input even when focus is no longer editable", async () => {
    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    useAutoRefreshGate();

    textarea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(canAutoRefreshNow()).toBe(false);

    await vi.advanceTimersByTimeAsync(1500);
    expect(canAutoRefreshNow()).toBe(true);
  });
});
