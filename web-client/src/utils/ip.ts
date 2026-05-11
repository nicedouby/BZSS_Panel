import type { IpLookupResult } from "../composables/useIpLookup";

export function normalizeIp(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.replace(/^\[(.*)\]$/, "$1");
}

export function isValidIp(value: unknown): boolean {
  const ip = normalizeIp(value);
  if (!ip) return false;
  if (isIpv4(ip)) return true;
  return isIpv6(ip);
}

export function isPrivateIp(value: unknown): boolean {
  const ip = normalizeIp(value).toLowerCase();
  if (!ip) return false;

  if (isIpv4(ip)) {
    const octets = ip.split(".").map((part) => Number(part));
    const [first, second] = octets;
    if (first === 10) return true;
    if (first === 127) return true;
    if (first === 169 && second === 254) return true;
    if (first === 192 && second === 168) return true;
    if (first === 172 && second >= 16 && second <= 31) return true;
    return false;
  }

  if (ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    const tail = ip.slice("::ffff:".length);
    if (isIpv4(tail)) return isPrivateIp(tail);
  }

  const firstGroup = ip.split(":", 1)[0] ?? "";
  if (!firstGroup) return false;
  if (firstGroup === "fc" || firstGroup === "fd") return true;
  if (firstGroup.startsWith("fc") || firstGroup.startsWith("fd")) return true;
  if (firstGroup.startsWith("fe8") || firstGroup.startsWith("fe9") || firstGroup.startsWith("fea") || firstGroup.startsWith("feb")) {
    return true;
  }
  return false;
}

export function formatIpSummary(item: IpLookupResult | null | undefined, showGeo = true): string {
  if (!item?.ip) return "Unknown";
  if (item.source === "invalid") return "Unknown";
  if (item.isPrivate) return "LAN / Private";
  if (!showGeo) return "";

  const pieces = [item.country, item.region, item.city, item.isp].map((part) => String(part ?? "").trim()).filter(Boolean);
  if (!pieces.length) {
    return item.source === "unknown" ? "Unknown" : "";
  }

  if (pieces.length >= 3) {
    return `${pieces[0]} / ${pieces[2]} / ${pieces[pieces.length - 1]}`;
  }

  return pieces.join(" / ");
}

export function collectIps(values: Array<unknown>): string[] {
  return [...new Set(values.map((value) => normalizeIp(value)).filter(Boolean))];
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const number = Number(part);
    return number >= 0 && number <= 255;
  });
}

function isIpv6(value: string): boolean {
  if (!value.includes(":")) return false;
  const groups = value.split(":");
  if (groups.length < 2 || groups.length > 8) return false;
  return groups.every((group) => group === "" || /^[0-9a-f]{1,4}$/i.test(group));
}
