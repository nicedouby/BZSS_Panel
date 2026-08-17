/**
 * Utility to determine if a keyboard event target or active element
 * is an input element (e.g. input, textarea, select, contenteditable).
 */
export function isInputElement(target: EventTarget | null): boolean {
  let el: HTMLElement | null = null;
  if (target && target instanceof HTMLElement) {
    el = target;
  } else if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement) {
    el = document.activeElement;
  }

  if (!el) return false;

  const tagName = el.tagName ? el.tagName.toUpperCase() : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return true;
  }

  if (el.isContentEditable || el.getAttribute("contenteditable") === "true" || el.getAttribute("contenteditable") === "") {
    return true;
  }

  if (typeof el.closest === "function" && el.closest("input, textarea, select, [contenteditable='true']") !== null) {
    return true;
  }

  return false;
}

/**
 * Global keydown listener to prevent accidental backspace navigation outside inputs
 * and prevent invalid backspace/escape actions when typing.
 */
export function attachGlobalKeyboardProtections(): () => void {
  if (typeof window === "undefined") return () => {};

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Prevent Backspace outside input fields from triggering browser history back navigation
    if (e.key === "Backspace" && !isInputElement(e.target)) {
      e.preventDefault();
    }
  };

  window.addEventListener("keydown", handleGlobalKeyDown, true);
  return () => {
    window.removeEventListener("keydown", handleGlobalKeyDown, true);
  };
}
