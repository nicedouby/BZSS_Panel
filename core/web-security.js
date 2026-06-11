const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class WebSecurityConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebSecurityConfigurationError";
  }
}

export function validateWebSecurityConfig(config = {}) {
  const web = config.web ?? {};
  const auth = config.auth ?? {};
  const environment = String(web.environment ?? "development").trim().toLowerCase();
  const transport = normalizeTransport(web.transport, web.https?.enabled);

  if (environment !== "production") {
    return true;
  }

  if (transport === "https" && auth.secureCookie !== true) {
    throw new WebSecurityConfigurationError("production https mode requires auth.secureCookie=true");
  }

  if (transport === "https" && web.enableDebugPage === true) {
    throw new WebSecurityConfigurationError("production https mode requires web.enableDebugPage=false");
  }

  const allowedHosts = Array.isArray(web.allowedHosts) ? web.allowedHosts.filter(Boolean) : [];
  if (allowedHosts.length === 0) {
    throw new WebSecurityConfigurationError("production mode requires a non-empty web.allowedHosts");
  }

  return true;
}

export function normalizeTransport(transport, httpsEnabled = false) {
  const text = String(transport ?? "").trim().toLowerCase();
  if (text === "https" || httpsEnabled === true) return "https";
  return "http";
}

export function resolveRequestProtocol(req) {
  return req?.socket?.encrypted === true ? "https" : "http";
}

export function validateHost(req, allowedHosts = []) {
  const hostHeader = String(req?.headers?.host ?? "").trim().toLowerCase();
  if (!hostHeader) return false;
  const entries = Array.isArray(allowedHosts) ? allowedHosts.filter(Boolean) : [];
  if (entries.length === 0) return true;

  const [requestHostname, requestPort = ""] = splitHostAndPort(hostHeader);
  for (const entry of entries) {
    const candidate = String(entry ?? "").trim().toLowerCase();
    if (!candidate) continue;

    const [allowedHostname, allowedPort = ""] = splitHostAndPort(candidate);
    if (allowedHostname !== requestHostname) continue;
    if (!allowedPort || allowedPort === requestPort) {
      return true;
    }
  }

  return false;
}

export function validateOrigin(req, allowedOrigins = []) {
  const allowed = new Set((Array.isArray(allowedOrigins) ? allowedOrigins : []).map((item) => String(item ?? "").trim()).filter(Boolean));
  if (!allowed.size) return true;
  const origin = String(req?.headers?.origin ?? "").trim();
  if (!origin) return false;
  return allowed.has(origin);
}

export function isStateChangingMethod(method) {
  return STATE_CHANGING_METHODS.has(String(method ?? "").trim().toUpperCase());
}

export function applySecurityHeaders(req, res, securityConfig = {}) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "no-store");

  if (resolveRequestProtocol(req) === "https" && securityConfig.hstsEnabled === true) {
    const maxAge = Number(securityConfig.hstsMaxAgeSeconds ?? 31536000);
    res.setHeader("Strict-Transport-Security", `max-age=${Number.isFinite(maxAge) ? Math.max(0, Math.floor(maxAge)) : 31536000}`);
  }
}

function splitHostAndPort(host) {
  if (host.startsWith("[") && host.includes("]")) {
    const end = host.indexOf("]");
    const hostname = host.slice(1, end);
    const port = host.slice(end + 1).replace(/^:/, "");
    return [hostname, port];
  }

  const lastColon = host.lastIndexOf(":");
  if (lastColon > -1 && host.indexOf(":") === lastColon) {
    return [host.slice(0, lastColon), host.slice(lastColon + 1)];
  }

  return [host, ""];
}
