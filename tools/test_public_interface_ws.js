#!/usr/bin/env node
// -*- coding: utf-8 -*-

import crypto from "node:crypto";
import net from "node:net";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 12864;
const DEFAULT_PATH = "/ws/public/v1";
const DEFAULT_TOKEN = process.env.BZSS_PUBLIC_INTERFACE_TOKEN
  || process.env.PUBLIC_INTERFACE_TOKEN
  || "change-me-long-random-token";

function parseArgs(argv) {
  const args = {
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    path: DEFAULT_PATH,
    token: DEFAULT_TOKEN,
    noToken: false,
    timeout: 10000,
    detailName: "",
    detailPlayerID: "",
    detailSteamID: "",
    detailEosID: "",
  };

  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    const next = argv[i + 1];
    if (item === "--host" && next) {
      args.host = next;
      i += 1;
    } else if (item === "--port" && next) {
      args.port = Number(next);
      i += 1;
    } else if (item === "--path" && next) {
      args.path = next;
      i += 1;
    } else if (item === "--token" && next) {
      args.token = next;
      i += 1;
    } else if (item === "--no-token") {
      args.noToken = true;
    } else if (item === "--timeout" && next) {
      args.timeout = Number(next);
      i += 1;
    } else if (item === "--name" && next) {
      args.detailName = next;
      i += 1;
    } else if (item === "--player-id" && next) {
      args.detailPlayerID = next;
      i += 1;
    } else if (item === "--steam-id" && next) {
      args.detailSteamID = next;
      i += 1;
    } else if (item === "--eos-id" && next) {
      args.detailEosID = next;
      i += 1;
    } else if (item === "--help" || item === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node tools/test_public_interface_ws.js [options]

Options:
  --host <host>         Default: 127.0.0.1
  --port <port>         Default: 12864
  --path <path>         Default: /ws/public/v1
  --token <token>       Default: $BZSS_PUBLIC_INTERFACE_TOKEN / $PUBLIC_INTERFACE_TOKEN / demo token
  --no-token            Do not send token query parameter
  --timeout <ms>        Default: 10000
  --name <name>         Query one player by name
  --player-id <id>      Query one player by playerID, e.g. 1 or # 1
  --steam-id <id>       Query one player by Steam64
  --eos-id <id>         Query one player by EOS ID
`);
}

function buildUrl({ host, port, path, token, noToken }) {
  const url = new URL(`ws://${host}:${port}${path}`);
  if (!noToken && token) {
    url.searchParams.set("token", token);
  }
  return url;
}

function createHandshakeRequest(url) {
  const key = crypto.randomBytes(16).toString("base64");
  const headers = [
    `GET ${url.pathname}${url.search} HTTP/1.1`,
    `Host: ${url.host}`,
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Key: ${key}`,
    "Sec-WebSocket-Version: 13",
    "",
    "",
  ];
  return { key, raw: headers.join("\r\n") };
}

function encodeClientFrame(text, opcode = 0x1) {
  const payload = Buffer.from(String(text), "utf8");
  const mask = crypto.randomBytes(4);
  let header;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  header[0] = 0x80 | (opcode & 0x0f);

  const masked = Buffer.from(payload);
  for (let i = 0; i < masked.length; i += 1) {
    masked[i] ^= mask[i % 4];
  }

  return Buffer.concat([header, mask, masked]);
}

function decodeFrames(buffer) {
  const frames = [];
  let cursor = 0;

  while (buffer.length - cursor >= 2) {
    const first = buffer[cursor];
    const second = buffer[cursor + 1];
    const opcode = first & 0x0f;
    let payloadLength = second & 0x7f;
    let offset = cursor + 2;

    if (payloadLength === 126) {
      if (buffer.length - offset < 2) break;
      payloadLength = buffer.readUInt16BE(offset);
      offset += 2;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 8) break;
      const len = buffer.readBigUInt64BE(offset);
      if (len > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Received oversized WS frame.");
      }
      payloadLength = Number(len);
      offset += 8;
    }

    if (buffer.length - offset < payloadLength) break;

    const payload = buffer.subarray(offset, offset + payloadLength);
    frames.push({ opcode, payload });
    cursor = offset + payloadLength;
  }

  return { frames, rest: buffer.subarray(cursor) };
}

function buildDetailQuery(args) {
  if (args.detailPlayerID) return { playerID: args.detailPlayerID };
  if (args.detailSteamID) return { steam64ID: args.detailSteamID };
  if (args.detailEosID) return { eosID: args.detailEosID };
  if (args.detailName) return { name: args.detailName };
  return null;
}

function prettyPrintPlayers(title, payload) {
  const players = Array.isArray(payload?.players) ? payload.players : [];
  console.log(`\n=== ${title} ===`);
  console.log(`ok=${payload?.ok} matchedCount=${payload?.matchedCount ?? players.length} updatedAt=${payload?.updatedAt ?? ""}`);
  for (const player of players) {
    const position = formatVector(player.position);
    const rotation = formatVector(player.rotation);
    console.log(
      [
        player.playerIdLabel || `# ${player.playerID ?? ""}`,
        player.name ?? "",
        `steam=${player.steam64ID ?? ""}`,
        `eos=${player.eosID ?? ""}`,
        `ip=${player.ip ?? ""}`,
        `latency=${player.latency ?? ""}`,
        `team=${player.teamID ?? ""}`,
        `squad=${player.squadID ?? ""}`,
        `role=${player.role ?? ""}`,
        `weapon=${player.currentWeapon ?? ""}`,
        `pos=${position}`,
        `rot=${rotation}`,
      ].join(" | "),
    );
  }
}

function formatVector(value) {
  if (!value || typeof value !== "object") return "";
  const x = value.x ?? "";
  const y = value.y ?? "";
  const z = value.z ?? "";
  return `{x:${x}, y:${y}, z:${z}}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const url = buildUrl(args);
  const request = createHandshakeRequest(url);
  const detailQuery = buildDetailQuery(args);

  const socket = net.createConnection({
    host: url.hostname,
    port: Number(url.port || args.port),
  });

  let handshakeDone = false;
  let buffer = Buffer.alloc(0);
  const timeout = setTimeout(() => {
    console.error("Timed out waiting for WS response.");
    socket.destroy();
    process.exit(1);
  }, Math.max(1000, Number(args.timeout) || 10000));

  function finish(code = 0) {
    clearTimeout(timeout);
    try {
      socket.end();
    } catch {}
    process.exit(code);
  }

  socket.on("error", (error) => {
    clearTimeout(timeout);
    console.error(`Socket error: ${error.message}`);
    process.exit(1);
  });

  socket.on("connect", () => {
    socket.write(request.raw);
  });

  socket.on("data", (chunk) => {
    if (!handshakeDone) {
      buffer = Buffer.concat([buffer, chunk]);
      const headerEnd = buffer.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEnd < 0) return;
      const headerText = buffer.subarray(0, headerEnd).toString("utf8");
      if (!/^HTTP\/1\.1 101 /m.test(headerText)) {
        console.error(`Handshake failed:\n${headerText}`);
        finish(1);
        return;
      }
      handshakeDone = true;
      buffer = buffer.subarray(headerEnd + 4);

      socket.write(encodeClientFrame(JSON.stringify({ type: "players:list" })));
      if (detailQuery) {
        socket.write(encodeClientFrame(JSON.stringify({ type: "players:detail", query: detailQuery })));
      }
      if (!detailQuery) {
        return;
      }
    } else {
      buffer = Buffer.concat([buffer, chunk]);
    }

    const decoded = decodeFrames(buffer);
    buffer = decoded.rest;

    for (const frame of decoded.frames) {
      if (frame.opcode === 0x1) {
        const text = frame.payload.toString("utf8");
        let message = null;
        try {
          message = JSON.parse(text);
        } catch {
          console.log(text);
          continue;
        }

        if (message.type === "players:list") {
          prettyPrintPlayers("players:list", message);
        } else if (message.type === "players:detail") {
          prettyPrintPlayers("players:detail", message);
        } else {
          console.log(JSON.stringify(message, null, 2));
        }
      } else if (frame.opcode === 0x8) {
        finish(0);
      } else if (frame.opcode === 0x9) {
        socket.write(encodeClientFrame("", 0xA));
      }
    }

    if (handshakeDone && !detailQuery && decoded.frames.length > 0) {
      finish(0);
    }
  });
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
