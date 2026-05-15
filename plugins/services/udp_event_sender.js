import dgram from "node:dgram";
import { Buffer } from "node:buffer";

const COMPONENT = "UdpEventSender";

function safeLogger(logger) {
  function write(level, message, extra = {}) {
    const payload = {
      module: COMPONENT,
      ownerType: "plugin",
      ownerName: "udp_event_forwarder",
      ...extra,
    };

    const fn = logger?.[level];

    if (typeof fn === "function") {
      try {
        fn.call(logger, message, payload);
        return;
      } catch {
        try {
          fn.call(logger, payload, message);
          return;
        } catch {
          // fall through
        }
      }
    }

    const consoleFn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    consoleFn(`[${COMPONENT}] ${message}`, extra);
  }

  return {
    info: (message, extra) => write("info", message, extra),
    warn: (message, extra) => write("warn", message, extra),
    error: (message, extra) => write("error", message, extra),
    debug: (message, extra) => write("debug", message, extra),
  };
}

function toPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export class UdpEventSender {
  constructor(options = {}) {
    this.host = options.host || "127.0.0.1";
    this.port = toPositiveInt(options.port, 39001);
    this.maxQueueSize = toPositiveInt(options.maxQueueSize, 1000);
    this.maxPacketBytes = toPositiveInt(options.maxPacketBytes, 1200);
    this.dropPolicy = options.dropPolicy || "drop_oldest";
    this.logSuccess = Boolean(options.logSuccess);
    this.logFailure = options.logFailure !== false;

    this.logger = safeLogger(options.logger);

    this.socket = null;
    this.started = false;
    this.closed = false;

    this.queue = [];
    this.draining = false;

    this.stats = {
      sent: 0,
      failed: 0,
      dropped: 0,
      oversized: 0,
      enqueued: 0,
      lastSentAt: null,
      lastError: null,
      lastDroppedAt: null,
    };
  }

  start() {
    if (this.started) {
      return;
    }

    this.closed = false;
    this.socket = dgram.createSocket("udp4");

    this.socket.on("error", (err) => {
      this.stats.failed += 1;
      this.stats.lastError = {
        message: err?.message || String(err),
        at: new Date().toISOString(),
      };

      if (this.logFailure) {
        this.logger.error("UDP socket error.", {
          error: this.stats.lastError,
          target: this.getTarget(),
        });
      }
    });

    if (typeof this.socket.unref === "function") {
      this.socket.unref();
    }

    this.started = true;

    this.logger.info("UDP event sender started.", {
      target: this.getTarget(),
      maxQueueSize: this.maxQueueSize,
      maxPacketBytes: this.maxPacketBytes,
    });
  }

  async stop() {
    this.closed = true;
    this.started = false;
    this.queue.length = 0;

    const socket = this.socket;
    this.socket = null;

    if (!socket) {
      return;
    }

    await new Promise((resolve) => {
      try {
        socket.close(() => resolve());
      } catch {
        resolve();
      }
    });

    this.logger.info("UDP event sender stopped.", {
      target: this.getTarget(),
      stats: this.getStatus(),
    });
  }

  getTarget() {
    return `${this.host}:${this.port}`;
  }

  getStatus() {
    return {
      target: this.getTarget(),
      started: this.started,
      queueSize: this.queue.length,
      maxQueueSize: this.maxQueueSize,
      maxPacketBytes: this.maxPacketBytes,
      ...this.stats,
    };
  }

  sendJson(event) {
    if (!this.started || this.closed || !this.socket) {
      this.stats.dropped += 1;
      this.stats.lastDroppedAt = new Date().toISOString();
      return false;
    }

    let json;
    try {
      json = JSON.stringify(event);
    } catch (err) {
      this.stats.failed += 1;
      this.stats.lastError = {
        message: `JSON stringify failed: ${err?.message || String(err)}`,
        at: new Date().toISOString(),
      };
      return false;
    }

    const bytes = Buffer.byteLength(json, "utf8");

    if (bytes > this.maxPacketBytes) {
      this.stats.oversized += 1;
      this.stats.dropped += 1;
      this.stats.lastDroppedAt = new Date().toISOString();

      if (this.logFailure) {
        this.logger.warn("UDP packet dropped because it is too large.", {
          bytes,
          maxPacketBytes: this.maxPacketBytes,
          type: event?.type,
          eventId: event?.eventId,
        });
      }

      return false;
    }

    if (this.queue.length >= this.maxQueueSize) {
      this.dropOneQueuedEvent();
    }

    this.queue.push({
      json,
      bytes,
      eventType: event?.type || null,
      eventId: event?.eventId || null,
      enqueuedAt: Date.now(),
    });

    this.stats.enqueued += 1;
    this.scheduleDrain();
    return true;
  }

  dropOneQueuedEvent() {
    if (this.queue.length === 0) {
      return;
    }

    if (this.dropPolicy === "drop_newest") {
      this.queue.pop();
    } else {
      this.queue.shift();
    }

    this.stats.dropped += 1;
    this.stats.lastDroppedAt = new Date().toISOString();
  }

  scheduleDrain() {
    if (this.draining) {
      return;
    }

    this.draining = true;
    setImmediate(() => this.drainQueue());
  }

  drainQueue() {
    if (!this.started || this.closed || !this.socket) {
      this.draining = false;
      return;
    }

    const item = this.queue.shift();

    if (!item) {
      this.draining = false;
      return;
    }

    const buffer = Buffer.from(item.json, "utf8");

    this.socket.send(buffer, this.port, this.host, (err) => {
      if (err) {
        this.stats.failed += 1;
        this.stats.lastError = {
          message: err?.message || String(err),
          code: err?.code || null,
          at: new Date().toISOString(),
        };

        if (this.logFailure) {
          this.logger.warn("UDP event send failed.", {
            target: this.getTarget(),
            eventType: item.eventType,
            eventId: item.eventId,
            error: this.stats.lastError,
          });
        }
      } else {
        this.stats.sent += 1;
        this.stats.lastSentAt = new Date().toISOString();

        if (this.logSuccess) {
          this.logger.debug("UDP event sent.", {
            target: this.getTarget(),
            eventType: item.eventType,
            eventId: item.eventId,
            bytes: item.bytes,
          });
        }
      }

      setImmediate(() => this.drainQueue());
    });
  }
}
