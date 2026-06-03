import zhCN from "./zh-CN";
import enUS from "./en-US";

export type Locale = "zh-CN" | "en-US";

type Dictionary = Record<string, unknown>;

const dictionaries: Record<Locale, Dictionary> = {
  "zh-CN": zhCN,
  "en-US": enUS,
};

const STORAGE_KEY = "bzss.locale";

function resolveStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function resolveInitialLocale(): Locale {
  if (typeof window === "undefined") return "zh-CN";
  const stored = resolveStorage()?.getItem(STORAGE_KEY);
  return stored === "en-US" || stored === "zh-CN" ? stored : "zh-CN";
}

export const currentLocale: { value: Locale } = {
  value: resolveInitialLocale(),
};

export function setLocale(locale: Locale): void {
  currentLocale.value = locale;
  resolveStorage()?.setItem(STORAGE_KEY, locale);
}

function getByPath(source: Dictionary, path: string): string | undefined {
  const keys = path.split(".");
  let cursor: unknown = source;

  for (const key of keys) {
    if (!cursor || typeof cursor === "string" || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }

  return typeof cursor === "string" ? cursor : undefined;
}

function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (_, token) => {
    const value = params[token];
    return value == null ? `{${token}}` : String(value);
  });
}

export function t(
  key: string,
  fallback?: string,
  params?: Record<string, string | number>,
): string {
  const translated = getByPath(dictionaries[currentLocale.value], key);
  if (typeof translated === "string") {
    return interpolate(translated, params);
  }
  if (fallback != null && fallback !== "") {
    return interpolate(fallback, params);
  }
  return interpolate(key, params);
}
