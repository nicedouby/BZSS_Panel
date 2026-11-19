const MEM_BRIDGE_BASE_URL = "http://127.0.0.1:31903";
const ALLOWED_TARGETS = new Set(["formal", "test"]);
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export class MemBridgeError extends Error {
  constructor(message, statusCode = 503, code = "MemBridgeUnavailable") {
    super(message);
    this.name = "MemBridgeError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

/** Server-side proxy to loopback-only BZSS-MEM-BRIDGE data and sampling settings. */
export class MemBridgeService {
  async request(path, { method = "GET", body } = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      const response = await fetch(`${MEM_BRIDGE_BASE_URL}${path}`, {
        method,
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
      const declaredLength = Number(response.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_RESPONSE_BYTES) {
        throw new MemBridgeError("Bridge 返回的数据超过安全读取上限。", 502, "ResponseTooLarge");
      }

      const raw = await response.text();
      if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) {
        throw new MemBridgeError("Bridge 返回的数据超过安全读取上限。", 502, "ResponseTooLarge");
      }
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new MemBridgeError("Bridge 返回了无法解析的数据。", 502, "InvalidBridgeResponse");
      }
      if (!response.ok) {
        throw new MemBridgeError(
          String(payload?.message ?? payload?.error ?? "Bridge 当前不可用。"),
          response.status >= 500 ? 503 : response.status,
          String(payload?.error ?? "MemBridgeUnavailable"),
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof MemBridgeError) throw error;
      const message = error?.name === "AbortError"
        ? "读取 Bridge 超时，请稍后重试。"
        : "无法连接容器内的 BZSS-MEM-BRIDGE。";
      throw new MemBridgeError(message, 503, "MemBridgeUnavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  normalizeTarget(target) {
    const normalizedTarget = String(target ?? "").trim();
    if (!ALLOWED_TARGETS.has(normalizedTarget)) {
      throw new MemBridgeError("目标只能是 formal 或 test。", 400, "InvalidTarget");
    }
    return normalizedTarget;
  }

  async getSnapshot(target) {
    const normalizedTarget = this.normalizeTarget(target);
    const payload = await this.request(`/v1/snapshot?target=${normalizedTarget}`);
    if (
      payload?.module !== "BZSS-MEM-BRIDGE"
      || payload?.readOnly !== true
      || payload?.target !== normalizedTarget
      || !Array.isArray(payload?.players)
      || !Array.isArray(payload?.mapPoints)
    ) {
      throw new MemBridgeError("Bridge 返回的数据格式或目标不匹配。", 502, "InvalidBridgeResponse");
    }
    return payload;
  }

  async getSettings(target) {
    const normalizedTarget = this.normalizeTarget(target);
    const payload = await this.request(`/v1/settings?target=${normalizedTarget}`);
    if (
      payload?.module !== "BZSS-MEM-BRIDGE"
      || payload?.target !== normalizedTarget
      || !Number.isFinite(payload?.sampleIntervalSeconds)
      || !Number.isFinite(payload?.playerStatsIntervalSeconds)
      || !Number.isFinite(payload?.pointScanIntervalSeconds)
    ) {
      throw new MemBridgeError("Bridge 返回的采样设置格式不匹配。", 502, "InvalidBridgeResponse");
    }
    return payload;
  }

  async updateSettings(input) {
    const target = this.normalizeTarget(input?.target);
    const allowed = new Set(["target", "sampleIntervalSeconds", "playerStatsIntervalSeconds", "pointScanIntervalSeconds"]);
    if (!input || Object.keys(input).some((key) => !allowed.has(key))) {
      throw new MemBridgeError("包含不支持的采样设置字段。", 400, "InvalidSettings");
    }
    const body = { target };
    if (Object.hasOwn(input, "sampleIntervalSeconds")) {
      const value = input.sampleIntervalSeconds;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0.05 || value > 60) {
        throw new MemBridgeError("内存采样间隔范围为 0.05–60 秒。", 400, "InvalidSettings");
      }
      body.sampleIntervalSeconds = value;
    }
    if (Object.hasOwn(input, "pointScanIntervalSeconds")) {
      const value = input.pointScanIntervalSeconds;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 60) {
        throw new MemBridgeError("地图点位重新扫描间隔范围为 1–60 秒。", 400, "InvalidSettings");
      }
      body.pointScanIntervalSeconds = value;
    }
    if (Object.hasOwn(input, "playerStatsIntervalSeconds")) {
      const value = input.playerStatsIntervalSeconds;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0.25 || value > 60) {
        throw new MemBridgeError("玩家战绩采样间隔范围为 0.25–60 秒。", 400, "InvalidSettings");
      }
      body.playerStatsIntervalSeconds = value;
    }
    if (Object.keys(body).length === 1) {
      throw new MemBridgeError("请至少提供一个需要修改的采样参数。", 400, "InvalidSettings");
    }
    const payload = await this.request("/v1/settings", { method: "PATCH", body });
    if (
      payload?.module !== "BZSS-MEM-BRIDGE"
      || payload?.target !== target
      || !Number.isFinite(payload?.sampleIntervalSeconds)
      || !Number.isFinite(payload?.playerStatsIntervalSeconds)
      || !Number.isFinite(payload?.pointScanIntervalSeconds)
    ) {
      throw new MemBridgeError("Bridge 返回的采样设置格式不匹配。", 502, "InvalidBridgeResponse");
    }
    return payload;
  }
}
