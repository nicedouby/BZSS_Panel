export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function apiGet<T>(path: string, init: RequestInit = {}): Promise<T> {
  return request<T>(path, { ...init, method: "GET" });
}

export async function apiPost<T>(path: string, body: unknown = {}, init: RequestInit = {}): Promise<T> {
  return request<T>(path, {
    ...init,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "include",
    ...init,
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw new ApiError(payload?.message || payload?.error || `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
