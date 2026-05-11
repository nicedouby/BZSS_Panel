import { ApiError } from "./apiClient";

export function renderApiError(error: unknown, fallback = "Request failed.") {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Session expired. Please sign in again.";
    if (error.type === "network") return "API is unavailable right now.";
    if (error.type === "timeout") return "The request timed out.";
    return error.message;
  }

  return error instanceof Error ? error.message : fallback;
}
