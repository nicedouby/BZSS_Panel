export interface ToastTarget {
  pushToast(input: { title?: string; message: string; tone?: "ok" | "warn" | "error" | "idle"; durationMs?: number }): unknown;
}

export async function copyText(value: string): Promise<boolean> {
  const text = String(value ?? "");
  if (!text) return false;

  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}

  if (typeof document === "undefined") return false;

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }

  document.body.removeChild(textarea);
  return copied;
}

export async function copyTextWithToast(
  value: string,
  ui: ToastTarget,
  options: {
    label?: string;
    successMessage?: string;
    errorMessage?: string;
    successTone?: "ok" | "warn" | "error" | "idle";
    errorTone?: "ok" | "warn" | "error" | "idle";
  } = {},
): Promise<boolean> {
  const copied = await copyText(value);
  if (copied) {
    ui.pushToast({
      title: options.label?.trim() || "Copied",
      message: options.successMessage || "Copied to clipboard.",
      tone: options.successTone || "ok",
    });
    return true;
  }

  ui.pushToast({
    title: options.label?.trim() || "Copy failed",
    message: options.errorMessage || "Unable to copy to clipboard.",
    tone: options.errorTone || "error",
  });
  return false;
}
