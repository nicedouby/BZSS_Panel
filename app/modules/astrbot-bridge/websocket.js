// -*- coding: utf-8 -*-

import crypto from "node:crypto";

const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_BUFFERED_BYTES = 1024 * 1024;

export function createAstrbotWebSocketGateway({
  getConfig,
  getState,
  onClientCountChange,
  logger = console,
}) {
  const clients = new Set();

  return {
    getClientCount() {
      return clients.size;
    },

    acceptUpgrade(req, socket, head) {
      const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const config = getConfig?.() ?? {};

      if (!config.enabled) return reject(socket, 503, "AstrBot bridge disabled.");
      if (!isAuthorized(req, url, config)) return reject(socket, 401, "Invalid AstrBot token.");

      const key = String(req.headers["sec-websocket-key"] ?? "").trim();
      if (!key) return reject(socket, 400, "Missing WebSocket key.");

      const acceptKey = crypto
        .createHash("sha1")
        .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");

      socket.write([
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey}`,
        "",
        "",
      ].join("\r\n"));

      const client = { socket, buffer: Buffer.alloc(0) };
      clients.add(client);
      onClientCountChange?.(clients.size);
      send(client, {
        type: "astrbot.connected",
        data: getState?.() ?? null,
      });

      socket.on("data", (chunk) => consume(client, chunk));
      socket.on("close", () => remove(client));
      socket.on("error", () => remove(client));

      if (head?.length) consume(client, head);
    },

    publish(message) {
      const payload = Buffer.from(JSON.stringify(message), "utf8");
      for (const client of [...clients]) {
        try {
          sendFrame(client.socket, payload, 0x1);
        } catch (error) {
          logger?.warn?.(`[AstrBotBridge] websocket client removed: ${error.message}`);
          remove(client);
        }
      }
    },

    closeAll() {
      for (const client of [...clients]) remove(client);
    },
  };

  function consume(client, chunk) {
    client.buffer = Buffer.concat([client.buffer, chunk]);
    while (client.buffer.length >= 2) {
      const first = client.buffer[0];
      const second = client.buffer[1];
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (client.buffer.length < offset + 2) return;
        length = client.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (client.buffer.length < offset + 8) return;
        const lengthBig = client.buffer.readBigUInt64BE(offset);
        if (lengthBig > BigInt(Number.MAX_SAFE_INTEGER)) return remove(client);
        length = Number(lengthBig);
        offset += 8;
      }

      if (length > MAX_FRAME_BYTES) return remove(client);
      const masked = Boolean(second & 0x80);
      if (masked) {
        if (client.buffer.length < offset + 4) return;
        const mask = client.buffer.subarray(offset, offset + 4);
        offset += 4;
        if (client.buffer.length < offset + length) return;
        const payload = client.buffer.subarray(offset, offset + length);
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
        client.buffer = client.buffer.subarray(offset + length);
      } else {
        if (client.buffer.length < offset + length) return;
        client.buffer = client.buffer.subarray(offset + length);
      }

      const opcode = first & 0x0f;
      if (opcode === 0x8) return remove(client);
      if (opcode === 0x9) {
        try { sendFrame(client.socket, Buffer.alloc(0), 0xA); } catch { return remove(client); }
      }
    }
  }

  function send(client, message) {
    sendFrame(client.socket, Buffer.from(JSON.stringify(message), "utf8"), 0x1);
  }

  function remove(client) {
    if (!clients.delete(client)) return;
    onClientCountChange?.(clients.size);
    try { sendFrame(client.socket, Buffer.alloc(0), 0x8); } catch {}
    try { client.socket.end(); } catch {}
  }

  function isAuthorized(req, url, config) {
    const authorization = String(req.headers.authorization ?? "").trim();
    const bearer = authorization.toLowerCase().startsWith("bearer ")
      ? authorization.slice(7).trim()
      : "";
    if (!config.apiToken || bearer !== config.apiToken) return false;

    return true;
  }

  function reject(socket, statusCode, message) {
    socket.end(`HTTP/1.1 ${statusCode} ${statusText(statusCode)}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message}`);
  }
}

function sendFrame(socket, payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  if (!socket?.writable || socket.destroyed || Number(socket.writableLength ?? 0) > MAX_BUFFERED_BYTES) {
    throw new Error("WebSocket client is not writable.");
  }

  let header;
  if (body.length < 126) {
    header = Buffer.from([0x80 | opcode, body.length]);
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }

  socket.write(Buffer.concat([header, body]));
}

function statusText(code) {
  return ({400:"Bad Request",401:"Unauthorized",503:"Service Unavailable"})[code] ?? "Error";
}
