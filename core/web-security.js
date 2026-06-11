import net from "node:net";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);
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
  const reverseProxyOnly = web.reverseProxyOnly === true;

  if (environment !== "production" || !reverseProxyOnly) {
    return true;
  }

  const host = String(web.host ?? "").trim().toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new WebSecurityConfigurationError(
      `production reverse-proxy mode requires a loopback-only web.host; received ${String(web.host ?? "")}`,
    );
  }

  if (web.enforceHttps !== true) {
    throw new WebSecurityConfigurationError("production reverse-proxy mode requires web.enforceHttps=true");
  }

  if (auth.secureCookie !== true) {
    throw new WebSecurityConfigurationError("production reverse-proxy mode requires auth.secureCookie=true");
  }

  const publicOrigin = String(web.publicOrigin ?? "").trim();
  const publicOriginUrl = safeParseUrl(publicOrigin);
  if (!publicOriginUrl || publicOriginUrl.protocol !== "https:" || publicOriginUrl.pathname !== "/" || publicOriginUrl.search || publicOriginUrl.hash) {
    throw new WebSecurityConfigurationError("production reverse-proxy mode requires web.publicOrigin to be an https origin without path, search, or hash");
  }

  const allowedHosts = Array.isArray(web.allowedHosts) ? web.allowedHosts.filter(Boolean) : [];
  if (!allowedHosts.length) {
    throw new WebSecurityConfigurationError("production reverse-proxy mode requires a non-empty web.allowedHosts");
  }

  const allowedOrigins = Array.isArray(web.allowedOrigins) ? web.allowedOrigins.filter(Boolean) : [];
  if (!allowedOrigins.length || allowedOrigins.some((origin) => !String(origin).trim().toLowerCase().startsWith("https://"))) {
    throw new WebSecurityConfigurationError("production reverse-proxy mode requires web.allowedOrigins to contain only https origins");
  }

  if (web.enableDebugPage === true) {
    throw new WebSecurityConfigurationError("production reverse-proxy mode requires web.enableDebugPage=false");
  }

  return true;
}

export function isLoopbackAddress(address) {
  const normalized = normalizeRemoteAddress(address);
  if (!normalized) return false;
  if (LOOPBACK_HOSTS.has(normalized)) return true;
  return normalized === "127.0.0.1" || normalized === "::1";
}

export function normalizeRemoteAddress(address) {
  const value = String(address ?? "").trim();
  if (!value) return "";
  if (value === "::1") return "::1";
  if (value.startsWith("::ffff:")) {
    return value.slice("::ffff:".length).toLowerCase();
  }
  return value.toLowerCase();
}

export function isTrustedProxy(req, trustedProxyAddresses = []) {
  const normalized = normalizeRemoteAddress(req?.socket?.remoteAddress);
  const trusted = new Set((Array.isArray(trustedProxyAddresses) ? trustedProxyAddresses : []).map(normalizeRemoteAddress));
  return trusted.has(normalized);
}

export function resolveRequestProtocol(req, trustedProxyAddresses = []) {
  if (req?.socket?.encrypted === true) return "https";
  if (!isTrustedProxy(req, trustedProxyAddresses)) return "http";
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] ?? "").split(",")[0].trim().toLowerCase();
  return forwardedProto === "https" ? "https" : "http";
}

export function resolveClientIp(req, trustedProxyAddresses = []) {
  const proxyIp = normalizeRemoteAddress(req?.socket?.remoteAddress);
  if (!isTrustedProxy(req, trustedProxyAddresses)) {
    return proxyIp;
  }

  const forwarded = String(req?.headers?.["x-forwarded-for"] ?? "").trim();
  if (!forwarded || forwarded.length > 512) {
    return proxyIp;
  }

  const candidate = forwarded.split(",")[0].trim();
  const normalized = normalizeRemoteAddress(candidate);
  return isValidIpLike(normalized) ? normalized : proxyIp;
}

export function validateHost(req, allowedHosts = []) {
  const allowed = new Set((Array.isArray(allowedHosts) ? allowedHosts : []).map((item) => String(item ?? "").trim().toLowerCase()).filter(Boolean));
  if (!allowed.size) return true;
  const host = String(req?.headers?.host ?? "").trim().toLowerCase();
  return allowed.has(host);
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
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");

  if (resolveRequestProtocol(req, securityConfig.trustedProxyAddresses) === "https" && securityConfig.hstsEnabled !== false) {
    const maxAge = Number(securityConfig.hstsMaxAgeSeconds ?? 31536000);
    res.setHeader("Strict-Transport-Security", `max-age=${Number.isFinite(maxAge) ? Math.max(0, Math.floor(maxAge)) : 31536000}`);
  }

  if (securityConfig.contentSecurityPolicyEnabled !== false) {
    res.setHeader(
      "Content-Security-Policy-Report-Only",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests",
    );
  }
}

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function isValidIpLike(value) {
  if (!value) return false;
  if (net.isIP(value)) return true;
  return value === "::1" || value === "localhost";
}
