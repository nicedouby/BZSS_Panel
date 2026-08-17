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
 * Global keyboard and selection protections:
 * 1. Prevents unhandled Backspace outside input fields from triggering browser history back navigation.
 * 2. Prevents focus loss when selecting text inside an input element and releasing the mouse outside the input bounds.
 */
export function attachGlobalKeyboardProtections(): () => void {
  if (typeof window === "undefined") return () => {};

  let activeSelectionInput: HTMLElement | null = null;
  let isPointerDownInInput = false;

  const handlePointerDown = (e: PointerEvent | MouseEvent) => {
    if (isInputElement(e.target)) {
      activeSelectionInput = e.target as HTMLElement;
      isPointerDownInInput = true;
    } else {
      isPointerDownInInput = false;
      activeSelectionInput = null;
    }
  };

  const handlePointerUp = (e: PointerEvent | MouseEvent) => {
    if (isPointerDownInInput && activeSelectionInput) {
      const el = activeSelectionInput;
      isPointerDownInInput = false;
      activeSelectionInput = null;

      // Check if mouse release happened outside the input element
      if (e.target !== el && !el.contains(e.target as Node)) {
        setTimeout(() => {
          if (!document.body.contains(el)) return;

          const isTextSelectable =
            el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

          let start: number | null = null;
          let end: number | null = null;

          if (isTextSelectable) {
            try {
              start = el.selectionStart;
              end = el.selectionEnd;
            } catch (_) {
              // Ignore non-text input types like number/date
            }
          }

          // Restore focus to input if focus left the input element
          if (document.activeElement !== el) {
            el.focus();
            if (
              isTextSelectable &&
              typeof start === "number" &&
              typeof end === "number" &&
              start !== end
            ) {
              try {
                (el as HTMLInputElement | HTMLTextAreaElement).setSelectionRange(start, end);
              } catch (_) {
                // Ignore for unsupported input types
              }
            }
          }
        }, 0);
      }
    } else {
      isPointerDownInInput = false;
      activeSelectionInput = null;
    }
  };

  const handleGlobalKeyDown = (e: KeyboardEvent) => {
    // Prevent Backspace outside input fields from triggering browser history back navigation
    if (e.key === "Backspace" && !isInputElement(e.target)) {
      e.preventDefault();
    }
  };

  window.addEventListener("pointerdown", handlePointerDown, true);
  window.addEventListener("pointerup", handlePointerUp, true);
  window.addEventListener("keydown", handleGlobalKeyDown, true);

  return () => {
    window.removeEventListener("pointerdown", handlePointerDown, true);
    window.removeEventListener("pointerup", handlePointerUp, true);
    window.removeEventListener("keydown", handleGlobalKeyDown, true);
  };
}
