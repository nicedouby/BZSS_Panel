// -*- coding: utf-8 -*-

export async function handleTacticalFeedWriterRoutes({
  core,
  modules,
  url,
  req,
  user,
  readJsonBody,
  json,
}) {
  if (!url.pathname.startsWith("/api/tactical-feed-writer")) return false;

  const api = modules.tacticalFeedWriter;
  if (!api) {
    json(404, { error: "TacticalFeedWriterUnavailable", message: "Tactical feed writer module is not loaded." });
    return true;
  }

  if (url.pathname === "/api/tactical-feed-writer/status" && req.method === "GET") {
    json(200, { ok: true, ...api.getDiagnostics() });
    return true;
  }

  if (url.pathname === "/api/tactical-feed-writer/recording" && req.method === "POST") {
    if (!core.authManager?.hasEverything?.(user)) {
      json(403, { error: "Forbidden", message: "SuperAdmin permission is required." });
      return true;
    }
    const body = await readJsonBody(req);
    if (typeof body?.enabled !== "boolean") {
      json(400, { error: "InvalidRecordingState", message: "enabled must be a boolean." });
      return true;
    }
    try {
      const recordingEnabled = await api.setRecordingEnabled(body.enabled);
      json(200, { ok: true, recordingEnabled, ...api.getDiagnostics() });
    } catch (error) {
      const message = error?.message ?? String(error);
      json(500, {
        error: "TacticalReplayRecordingTransitionFailed",
        message,
        diagnostics: api.getDiagnostics?.() ?? null,
      });
    }
    return true;
  }

  json(405, { error: "MethodNotAllowed", message: "Unsupported tactical feed writer route." });
  return true;
}
