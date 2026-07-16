// -*- coding: utf-8 -*-

import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  brotliCompress,
  createBrotliCompress,
  createGzip,
  gzip,
  constants as zlibConstants,
} from "node:zlib";

import { WebServer } from "./web-server.js";

const MIN_COMPRESS_BYTES = 1024;
const MAX_COMPRESSED_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_CACHEABLE_SOURCE_BYTES = 16 * 1024 * 1024;
const brotliCompressAsync = promisify(brotliCompress);
const gzipAsync = promisify(gzip);

const BASE_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "0",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' wss: ws:",
};

/**
 * Production web server variant optimized for browsers accessing the panel over
 * a LAN. Hashed Vite assets keep their existing immutable cache policy, while
 * text resources are compressed once and retained in a bounded in-memory LRU.
 */
export class LanOptimizedWebServer extends WebServer {
  constructor(options) {
    super(options);
    this.compressedAssetCache = new Map();
    this.compressedAssetCacheBytes = 0;
    this.compressedAssetJobs = new Map();
  }

  async handleApi(url, req, res) {
    if (url.pathname === "/api/auth/login" && req.method === "POST") {
      return this.handleFastLogin(req, res);
    }
    return super.handleApi(url, req, res);
  }

  async handleFastLogin(req, res) {
    const body = await this.readJsonBody(req);
    const result = await this.core.authManager.login({
      username: body.username,
      password: body.password,
      ip: this.getRequestIp(req),
    });

    if (!result.ok) {
      const statusCode = result.error === "AuthDisabled" ? 503 : 401;
      return this.json(res, statusCode, {
        ok: false,
        error: result.error ?? "InvalidCredentials",
        message: result.error === "AuthDisabled"
          ? "Authentication is disabled."
          : "Invalid username or password.",
      });
    }

    // Login should only establish the authenticated shell. Steam avatar and
    // other optional profile fields are fetched later by /api/auth/me/profile.
    return this.json(res, 200, {
      ok: true,
      authenticated: true,
      user: this.serializeAuthSessionUser(result.user),
    }, {
      "Set-Cookie": result.cookie,
    });
  }

  async serveStatic(url, req, res) {
    let requestPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    requestPath = path.normalize(requestPath).replace(/^([/\\])+/, "").replace(/^(\.\.[/\\])+/, "");

    const staticRoot = path.resolve(this.staticDirectory);
    const abs = path.resolve(staticRoot, requestPath);
    if (abs !== staticRoot && !abs.startsWith(`${staticRoot}${path.sep}`)) {
      res.writeHead(404, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    let stat;
    try {
      stat = await (this.core.fileIO?.stat?.(abs) ?? fs.stat(abs));
    } catch (error) {
      if (error?.code === "ENOENT" && !path.extname(requestPath)) return this.serveIndex(res);
      res.writeHead(404, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    if (!stat.isFile()) {
      if (!path.extname(requestPath)) return this.serveIndex(res);
      res.writeHead(404, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }

    const isHtml = abs.endsWith(".html");
    const mime = contentType(abs);
    const encoding = selectEncoding(req, abs, stat.size);
    const baseEtag = `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`;
    const etag = encoding ? `${baseEtag.slice(0, -1)}-${encoding}"` : baseEtag;
    const lastModified = stat.mtime.toUTCString();
    const cacheControl = isHtml ? "no-store" : "public, max-age=31536000, immutable";

    if (req.headers["if-none-match"] === etag
      || (!req.headers["if-none-match"] && req.headers["if-modified-since"]
        && Date.parse(req.headers["if-modified-since"]) >= Math.trunc(stat.mtimeMs / 1000) * 1000)) {
      res.writeHead(304, {
        ...BASE_SECURITY_HEADERS,
        ETag: etag,
        "Last-Modified": lastModified,
        "Cache-Control": cacheControl,
        Vary: "Accept-Encoding",
      });
      res.end();
      return;
    }

    const headers = {
      ...BASE_SECURITY_HEADERS,
      "Content-Type": mime,
      "Last-Modified": lastModified,
      ETag: etag,
      "Cache-Control": cacheControl,
      Vary: "Accept-Encoding",
    };
    if (encoding) headers["Content-Encoding"] = encoding;
    else headers["Content-Length"] = stat.size;

    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    if (encoding) {
      try {
        const compressed = await this.getCompressedAsset(abs, stat, encoding);
        if (compressed) {
          headers["Content-Length"] = compressed.length;
          res.writeHead(200, headers);
          res.end(compressed);
          return;
        }
      } catch (error) {
        this.logger?.warn?.("Compressed static cache failed; falling back to streaming compression.", {
          operation: "serveStaticCompressedCache",
          data: { path: abs, encoding, message: error?.message ?? String(error) },
        });
      }
    }

    res.writeHead(200, headers);
    try {
      const source = this.core.fileIO?.streamFile?.(abs) ?? createReadStream(abs);
      if (encoding === "br") {
        await pipeline(source, createBrotliCompress({
          params: {
            [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
          },
        }), res);
      } else if (encoding === "gzip") {
        await pipeline(source, createGzip({ level: 5 }), res);
      } else {
        await pipeline(source, res);
      }
    } catch (error) {
      this.logger?.error?.("Static file stream failed.", {
        operation: "serveStaticCompressed",
        data: { path: abs, encoding: encoding || "identity", message: error?.message ?? String(error) },
      });
      if (!res.headersSent) {
        res.writeHead(500, { ...BASE_SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
        res.end("Internal Server Error");
      } else if (!res.destroyed) {
        res.destroy(error);
      }
    }
  }

  async getCompressedAsset(abs, stat, encoding) {
    const key = `${abs}\u0000${stat.size}\u0000${Math.trunc(stat.mtimeMs)}\u0000${encoding}`;
    const cached = this.compressedAssetCache.get(key);
    if (cached) {
      this.compressedAssetCache.delete(key);
      this.compressedAssetCache.set(key, cached);
      return cached.buffer;
    }

    const pending = this.compressedAssetJobs.get(key);
    if (pending) return pending;

    const job = this.buildCompressedAsset(abs, stat, encoding, key)
      .finally(() => {
        this.compressedAssetJobs.delete(key);
      });
    this.compressedAssetJobs.set(key, job);
    return job;
  }

  async buildCompressedAsset(abs, stat, encoding, key) {
    if (stat.size > MAX_CACHEABLE_SOURCE_BYTES) return null;
    const source = this.core.fileIO?.readText
      ? Buffer.from(await this.core.fileIO.readText(abs, { maxBytes: MAX_CACHEABLE_SOURCE_BYTES }))
      : await fs.readFile(abs);
    const result = encoding === "br"
      ? await brotliCompressAsync(source, {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 4,
        },
      })
      : await gzipAsync(source, { level: 5 });
    const buffer = Buffer.isBuffer(result) ? result : Buffer.from(result);

    if (stat.size <= MAX_CACHEABLE_SOURCE_BYTES && buffer.length <= MAX_COMPRESSED_CACHE_BYTES) {
      this.storeCompressedAsset(key, abs, encoding, buffer);
    }
    return buffer;
  }

  storeCompressedAsset(key, abs, encoding, buffer) {
    for (const [cachedKey, entry] of this.compressedAssetCache) {
      if (cachedKey !== key && entry.abs === abs && entry.encoding === encoding) {
        this.compressedAssetCache.delete(cachedKey);
        this.compressedAssetCacheBytes -= entry.bytes;
      }
    }

    while (
      this.compressedAssetCache.size > 0
      && this.compressedAssetCacheBytes + buffer.length > MAX_COMPRESSED_CACHE_BYTES
    ) {
      const oldestKey = this.compressedAssetCache.keys().next().value;
      if (!oldestKey) break;
      const oldest = this.compressedAssetCache.get(oldestKey);
      this.compressedAssetCache.delete(oldestKey);
      this.compressedAssetCacheBytes -= oldest?.bytes ?? 0;
    }

    this.compressedAssetCache.set(key, {
      abs,
      encoding,
      bytes: buffer.length,
      buffer,
    });
    this.compressedAssetCacheBytes += buffer.length;
  }
}

function selectEncoding(req, filePath, size) {
  if (req.method !== "GET" && req.method !== "HEAD") return "";
  if (req.headers.range) return "";
  if (size < MIN_COMPRESS_BYTES || !isCompressible(filePath)) return "";

  const acceptEncoding = String(req.headers["accept-encoding"] ?? "");
  if (acceptsEncoding(acceptEncoding, "br")) return "br";
  if (acceptsEncoding(acceptEncoding, "gzip")) return "gzip";
  return "";
}

function acceptsEncoding(header, expected) {
  return header.split(",").some((entry) => {
    const [rawName, ...params] = entry.trim().toLowerCase().split(";");
    if (rawName !== expected && rawName !== "*") return false;
    const q = params.find((param) => param.trim().startsWith("q="));
    return !q || Number(q.split("=")[1]) > 0;
  });
}

function isCompressible(filePath) {
  return [
    ".html",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".svg",
    ".xml",
    ".txt",
    ".csv",
    ".md",
    ".map",
  ].includes(path.extname(filePath).toLowerCase());
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".csv": "text/csv; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".map": "application/json; charset=utf-8",
  };
  return types[ext] ?? "application/octet-stream";
}
