// -*- coding: utf-8 -*-

/**
 * Core: Rcon
 *
 * 低层 RCON TCP 协议实现。
 *
 * 这份实现按 MicePanel_better 的 RCON 设计迁移：
 * - 低层只负责连接、认证、封包、解包、自动重连
 * - Squad 专用命令放在 core/squad-rcon.js
 *
 * 注意：Squad RCON 存在 broken empty packet，所以这里保留了旧项目里的兼容逻辑。
 */

import EventEmitter from "node:events";
import net from "node:net";

const SERVERDATA_EXECCOMMAND = 0x02;
const SERVERDATA_RESPONSE_VALUE = 0x00;
const SERVERDATA_AUTH = 0x03;
const SERVERDATA_AUTH_RESPONSE = 0x02;
const SERVERDATA_CHAT_VALUE = 0x01;

const MID_PACKET_ID = 0x01;
const END_PACKET_ID = 0x02;

export default class Rcon extends EventEmitter {
  constructor(options = {}) {
    super();

    for (const key of ["host", "port", "password"]) {
      if (!(key in options)) {
        throw new Error(`Rcon: "${key}" is required.`);
      }
    }

    this.host = options.host;
    this.port = Number(options.port);
    this.password = options.password;
    this.autoReconnectDelay = options.autoReconnectDelay ?? 5000;

    const parsedCommandTimeoutMs = Number(options.commandTimeoutMs);
    this.commandTimeoutMs = Number.isFinite(parsedCommandTimeoutMs)
      ? Math.max(0, parsedCommandTimeoutMs)
      : 15000;
    const parsedConnectTimeoutMs = Number(options.connectTimeoutMs);
    this.connectTimeoutMs = Number.isFinite(parsedConnectTimeoutMs)
      ? Math.max(0, parsedConnectTimeoutMs)
      : 5000;

    this.logger = options.logger ?? console;

    this.connected = false;
    this.loggedIn = false;
    this.autoReconnect = false;
    this._autoReconnectTimeout = null;
    this._closeReason = null;

    this._incomingData = Buffer.from([]);
    this._incomingResponse = [];
    this._responseQueue = [];
    this._callbackIds = [];
    this._count = 1;
    this._connectPromise = null;

    this.maximumPacketSize = 4096;

    this._socket = null;
    this._setupSocket();

    this.connect = this.connect.bind(this);
  }

  connect() {
    if (this.connected && this.loggedIn) {
      return Promise.resolve();
    }

    if (this._connectPromise) {
      return this._connectPromise;
    }

    clearTimeout(this._autoReconnectTimeout);
    this._autoReconnectTimeout = null;

    if (!this._socket || this._socket.destroyed) {
      this._setupSocket();
    }

    this._connectPromise = new Promise((resolve, reject) => {
      this._logInfo(`Connecting to ${this.host}:${this.port} ...`);

      let settled = false;
      let timeout = null;
      const cleanup = () => {
        clearTimeout(timeout);
        this._socket?.removeListener("connect", onConnect);
        this._socket?.removeListener("error", onError);
      };
      const fail = (error) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(error);
      };
      const onConnect = async () => {
        if (settled) return;
        cleanup();
        this.connected = true;
        this._logInfo(`Connected to ${this.host}:${this.port}`);

        try {
          await this._write(SERVERDATA_AUTH, this.password);
          this.autoReconnect = true;
          this.emit("RCON_CONNECTED", {
            host: this.host,
            port: this.port,
            time: new Date().toISOString(),
          });
          if (!settled) {
            settled = true;
            resolve();
          }
        } catch (err) {
          fail(err);
        }
      };

      const onError = (err) => {
        if (settled) return;
        this._logError(`Connection failed: ${err.message}`);
        fail(err);
      };

      this._socket.once("connect", onConnect);
      this._socket.once("error", onError);
      if (this.connectTimeoutMs > 0) {
        timeout = setTimeout(() => {
          const error = new Error(`RCON connection timed out after ${this.connectTimeoutMs}ms`);
          this._logError(error.message);
          try { this._socket?.destroy(error); } catch {}
          fail(error);
        }, this.connectTimeoutMs);
      }
      this._socket.connect(this.port, this.host);
    }).finally(() => {
      this._connectPromise = null;
    });

    return this._connectPromise;
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      clearTimeout(this._autoReconnectTimeout);
      this._autoReconnectTimeout = null;
      this.autoReconnect = false;

      if (!this._socket || this._socket.destroyed) {
        this.connected = false;
        this.loggedIn = false;
        this._setupSocket();
        resolve();
        return;
      }

      if (!this.connected && !this._socket.connecting) {
        try {
          this._socket.destroy();
        } catch {}
        this.connected = false;
        this.loggedIn = false;
        this._setupSocket();
        resolve();
        return;
      }

      this._logInfo(`Disconnecting from ${this.host}:${this.port} ...`);

      const socket = this._socket;
      const cleanup = () => {
        socket.removeListener("close", onClose);
        socket.removeListener("error", onError);
      };

      const onClose = () => {
        cleanup();
        this._setupSocket();
        resolve();
      };

      const onError = (err) => {
        cleanup();
        reject(err);
      };

      socket.once("close", onClose);
      socket.once("error", onError);

      if (socket.connecting) {
        socket.destroy();
      } else {
        socket.end();
      }
    });
  }

  async reconnect() {
    this._logInfo(`Manual reconnect requested for ${this.host}:${this.port}`);

    try {
      await this.disconnect();
    } catch (err) {
      this._logWarn(`Disconnect before reconnect failed: ${err.message}`);
      this._setupSocket();
    }

    return this.connect();
  }

  /**
   * 执行 RCON 命令并返回响应文本。
   * @param {string} command
   * @returns {Promise<string>}
   */
  execute(command) {
    const commandText = String(command ?? "");

    this.emit("RCON_NATIVE_WRITE", {
      kind: "command",
      command: commandText,
      body: commandText,
      time: new Date().toISOString(),
    });

    return this._write(SERVERDATA_EXECCOMMAND, commandText)
      .then((response) => {
        this.emit("RCON_NATIVE_RESPONSE", {
          kind: "response",
          command: commandText,
          body: String(response ?? ""),
          time: new Date().toISOString(),
        });

        return response;
      })
      .catch((error) => {
        this.emit("RCON_NATIVE_ERROR", {
          kind: "error",
          command: commandText,
          message: error.message,
          time: new Date().toISOString(),
        });

        throw error;
      });
  }

  _write(type, body) {
    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error("Not connected."));
        return;
      }

      if (!this._socket.writable) {
        reject(new Error("Socket is not writable."));
        return;
      }

      if (!this.loggedIn && type !== SERVERDATA_AUTH) {
        reject(new Error("Not authenticated."));
        return;
      }

      const packetId = type !== SERVERDATA_AUTH ? MID_PACKET_ID : END_PACKET_ID;
      const encoded = this._encodePacket(type, packetId, body);
      const emptyPacket = this._encodePacket(type, END_PACKET_ID, "");
      const commandLabel = type === SERVERDATA_AUTH ? "AUTH" : body;

      let settled = false;
      let timeoutHandle = null;

      const clearTimer = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = null;
        }
      };

      const resolveOnce = (value) => {
        if (settled) return;
        settled = true;
        clearTimer();
        resolve(value);
      };

      const rejectOnce = (err) => {
        if (settled) return;
        settled = true;
        clearTimer();
        reject(err);
      };

      if (encoded.length > this.maximumPacketSize) {
        reject(new Error("Packet too large."));
        return;
      }

      if (this.commandTimeoutMs > 0) {
        timeoutHandle = setTimeout(() => {
          if (settled) return;

          const err = new Error(`RCON command timed out after ${this.commandTimeoutMs}ms: ${commandLabel}`);
          this._closeReason = err.message;
          this._logWarn(err.message);

          if (this._socket.destroyed) {
            rejectOnce(err);
            return;
          }

          this._socket.destroy(err);
        }, this.commandTimeoutMs);
      }

      if (type === SERVERDATA_AUTH) {
        this._callbackIds.push({ id: this._count, cmd: body });
        this._responseQueue.push(() => {});
        this._responseQueue.push((packet) => {
          if (packet instanceof Error || (packet && packet.id === -1)) {
            rejectOnce(new Error("RCON authentication failed."));
          } else {
            this._logInfo("Authentication successful.");
            this.loggedIn = true;
            resolveOnce();
          }
        });
      } else {
        this._callbackIds.push({ id: this._count, cmd: body });
        this._responseQueue.push((response) => {
          if (response instanceof Error) {
            rejectOnce(response);
          } else {
            resolveOnce(response);
          }
        });
      }

      if (++this._count > 65535) this._count = 1;

      this._socket.write(encoded);

      if (type !== SERVERDATA_AUTH) {
        this._socket.write(emptyPacket);
      }
    });
  }

  _onPacket(packet) {
    switch (packet.type) {
      case SERVERDATA_RESPONSE_VALUE:
      case SERVERDATA_AUTH_RESPONSE:
        switch (packet.id) {
          case MID_PACKET_ID:
            this._incomingResponse.push(packet);
            break;

          case END_PACKET_ID: {
            this._callbackIds = this._callbackIds.filter((p) => p.id !== packet.count);
            const callback = this._responseQueue.shift();
            if (callback) {
              callback(this._incomingResponse.map((p) => p.body).join(""));
            }
            this._incomingResponse = [];
            break;
          }

          default:
            this._onClose("unknown packet id");
        }
        break;

      case SERVERDATA_CHAT_VALUE:
        this._processChatPacket(packet);
        break;

      default:
        // Also check ID for chat packets as some implementations vary
        if (packet.id === SERVERDATA_CHAT_VALUE) {
          this._processChatPacket(packet);
          break;
        }
        this._onClose("unknown packet type");
    }
  }

  _decodeData(data) {
    this._incomingData = Buffer.concat([this._incomingData, data]);

    while (this._incomingData.byteLength >= 4) {
      const size = this._incomingData.readInt32LE(0);
      const packetSize = size + 4;

      if (this._incomingData.byteLength < packetSize) break;

      const raw = this._incomingData.subarray(0, packetSize);
      const decoded = this._decodePacket(raw);
      const matched = this._callbackIds.some((c) => c.id === decoded.count);

      if (
        matched || 
        decoded.type === SERVERDATA_AUTH_RESPONSE || 
        decoded.type === SERVERDATA_CHAT_VALUE || 
        decoded.id === SERVERDATA_CHAT_VALUE
      ) {
        this._onPacket(decoded);
        this._incomingData = this._incomingData.subarray(packetSize);
        continue;
      }

      // Squad broken empty packet 兼容。
      if (size === 10 && this._incomingData.byteLength >= 21) {
        const probe = this._decodePacket(this._incomingData.subarray(0, 21));
        if (probe.body === "\x00\x00\x00\x01\x00\x00\x00") {
          this._incomingData = this._incomingData.subarray(21);
          continue;
        }
      }

      break;
    }
  }

  _decodePacket(buf) {
    return {
      size: buf.readUInt32LE(0),
      id: buf.readUInt8(4),
      count: buf.readUInt16LE(6),
      type: buf.readUInt32LE(8),
      body: buf.toString("utf8", 12, buf.byteLength - 2),
    };
  }

  _encodePacket(type, id, body) {
    const bodyBuf = Buffer.from(String(body ?? ""), "utf8");
    const buf = Buffer.alloc(bodyBuf.length + 14);

    buf.writeInt32LE(bodyBuf.length + 10, 0);
    buf.writeUInt8(id, 4);
    buf.writeUInt8(0, 5);
    buf.writeUInt16LE(this._count, 6);
    buf.writeInt32LE(type, 8);
    bodyBuf.copy(buf, 12);
    buf.writeUInt8(0, 12 + bodyBuf.length);
    buf.writeUInt8(0, 13 + bodyBuf.length);

    return buf;
  }

  /**
   * 子类覆盖：处理服务器推送包。
   */
  _processChatPacket(_packet) {}

  _setupSocket() {
    if (this._socket) {
      this._socket.removeAllListeners("data");
      this._socket.removeAllListeners("close");
      this._socket.removeAllListeners("error");
    }

    this._socket = new net.Socket();
    this._socket.on("data", (data) => this._decodeData(data));
    this._socket.on("close", (hadError) => this._onClose(hadError ? "socket closed after error" : "socket closed"));
    this._socket.on("error", (err) => this._onError(err));
  }

  _onClose(reason) {
    const closeReason = this._closeReason || reason;
    this._closeReason = null;

    this.connected = false;
    this.loggedIn = false;

    this._logWarn(`Connection closed: ${closeReason}`);

    this._incomingData = Buffer.from([]);
    this._incomingResponse = [];

    while (this._responseQueue.length > 0) {
      const callback = this._responseQueue.shift();
      callback?.(new Error("RCON connection lost."));
    }

    this._callbackIds = [];

    this.emit("RCON_DISCONNECTED", { reason: closeReason });

    if (this.autoReconnect) {
      this._logInfo(`Reconnecting in ${this.autoReconnectDelay}ms ...`);
      this._setupSocket();
      this._autoReconnectTimeout = setTimeout(() => {
        // 自动重连属于后台任务，必须消费 Promise rejection；RCON 未启动时
        // ECONNREFUSED 只能记录为连接状态，不能让 Node 进程崩溃。
        void this.connect().catch((error) => {
          this._logWarn(`Automatic reconnect failed: ${error.message}`);
        });
      }, this.autoReconnectDelay);
    }
  }

  _onError(err) {
    if (!this._closeReason && err?.message) {
      this._closeReason = err.message;
    }

    this._logError(`Socket error: ${err.message}`);
    this.emit("RCON_ERROR", err);
  }

  _logInfo(message) {
    this.logger?.info?.(`[RCON] ${message}`);
  }

  _logWarn(message) {
    this.logger?.warn?.(`[RCON] ${message}`);
  }

  _logError(message) {
    this.logger?.error?.(`[RCON] ${message}`);
  }
}
