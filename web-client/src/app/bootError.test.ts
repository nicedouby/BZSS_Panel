import { describe, expect, it } from "vitest";
import { isResizeObserverError } from "./bootError";

describe("bootError - isResizeObserverError", () => {
  it("detects ResizeObserver loop completed with undelivered notifications", () => {
    expect(
      isResizeObserverError("ResizeObserver loop completed with undelivered notifications.")
    ).toBe(true);

    expect(
      isResizeObserverError(
        new Error("ResizeObserver loop completed with undelivered notifications.")
      )
    ).toBe(true);

    expect(
      isResizeObserverError({
        message: "ResizeObserver loop completed with undelivered notifications.",
      })
    ).toBe(true);
  });

  it("detects ResizeObserver loop limit exceeded", () => {
    expect(isResizeObserverError("ResizeObserver loop limit exceeded")).toBe(true);
    expect(isResizeObserverError(new Error("ResizeObserver loop limit exceeded"))).toBe(true);
  });

  it("returns false for non-ResizeObserver errors", () => {
    expect(isResizeObserverError(new Error("TypeError: Cannot read property of undefined"))).toBe(false);
    expect(isResizeObserverError("NetworkError")).toBe(false);
    expect(isResizeObserverError(null)).toBe(false);
    expect(isResizeObserverError(undefined)).toBe(false);
  });
});
