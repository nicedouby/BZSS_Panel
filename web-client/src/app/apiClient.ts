export type ApiErrorType = "network" | "timeout" | "abort" | "http" | "parse";

export interface ApiRequestOptions {
  timeoutMs?: number;
}

export class ApiError extends Error {
  type: ApiErrorType;
  status?: number;
  path: string;
  detail?: unknown;

  constructor({
    type,
    path,
    message,
    status,
    detail,
  }: {
    type: ApiErrorType;
    path: string;
    message: string;
    status?: number;
    detail?: unknown;
  }) {
    super(message);
    this.name = "ApiError";
    this.type = type;
    this.path = path;
    this.status = status;
    this.detail = detail;
  }
}

export async function apiGet<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  return request<T>(path, { ...init, method: "GET" }, options);
}

export async function apiPost<T>(
  path: string,
  body: unknown = {},
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  return request<T>(
    path,
    {
      ...init,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      body: JSON.stringify(body),
    },
    options,
  );
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  if (!path.startsWith("/api")) {
    throw new ApiError({
      type: "network",
      path,
      message: `Invalid API path: ${path}`,
    });
  }

  const timeoutMs = Number(options.timeoutMs ?? 8_000);
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort("timeout"), timeoutMs);
  const externalSignal = init.signal;
  let abortedByTimeout = false;

  const abortFromExternal = () => controller.abort("abort");
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort("abort");
    else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
  }

  try {
    const response = await fetch(path, {
      cache: "no-store",
      credentials: "include",
      ...init,
      signal: controller.signal,
    });

    const parsed = await readResponsePayload(response);
    const payload = parsed.payload;
    if (!response.ok) {
      if (response.status >= 500 && parsed.parseError) {
        throw new ApiError({
          type: "network",
          path,
          status: response.status,
          message: "API 未连接",
          detail: parsed.parseError,
        });
      }
      throw new ApiError({
        type: "http",
        path,
        status: response.status,
        message: response.status === 401
          ? "Unauthorized"
          : payload?.message || payload?.error || `Request failed (${response.status})`,
        detail: payload,
      });
    }

    if (parsed.parseError) {
      throw new ApiError({
        type: "parse",
        path,
        status: response.status,
        message: "Failed to parse API response as JSON",
        detail: parsed.parseError,
      });
    }
    return payload as T;
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    abortedByTimeout = controller.signal.aborted && controller.signal.reason === "timeout";
    if (abortedByTimeout) {
      throw new ApiError({
        type: "timeout",
        path,
        message: `API request timed out after ${timeoutMs}ms`,
        detail: error,
      });
    }
    if (error?.name === "AbortError" || controller.signal.aborted) {
      throw new ApiError({
        type: "abort",
        path,
        message: "Request aborted",
        detail: error,
      });
    }
    throw new ApiError({
      type: "network",
      path,
      message: "API 未连接",
      detail: error,
    });
  } finally {
    window.clearTimeout(timeoutId);
    externalSignal?.removeEventListener?.("abort", abortFromExternal);
  }
}

async function readResponsePayload(response: Response): Promise<{ payload: any; parseError: unknown | null }> {
  const text = await response.text();
  if (!text.trim()) {
    return {
      payload: null,
      parseError: response.ok ? new Error("Empty JSON response") : new Error("Empty error response"),
    };
  }

  try {
    return {
      payload: JSON.parse(text),
      parseError: null,
    };
  } catch (error) {
    return {
      payload: null,
      parseError: error,
    };
  }
}
