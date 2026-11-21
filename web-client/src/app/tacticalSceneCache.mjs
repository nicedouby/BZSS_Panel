const databaseName = "bzss-3d-map-assets";
const assetStore = "glb";
const byUse = "by-use";
const MiB = 1024 * 1024;
const budget = 1024 * MiB;
const freshness = 24 * 60 * 60 * 1000;

// IndexedDB also works on the panel's HTTP address. Only scene assets are stored.
export function createSceneAssetCache() {
  let database;
  let generation = 0;
  const stats = { hits: 0, files: 0, bytes: 0, writeFailed: false, available: typeof indexedDB !== "undefined" };

  function measure(tx, prune = false) {
    const store = tx.objectStore(assetStore);
    let files = 0, total = 0;
    const scan = store.index(byUse).openKeyCursor(null, "prev");
    scan.onsuccess = () => {
      const cursor = scan.result;
      if (!cursor) return;
      const bytes = cursor.key[1];
      if (prune && total + bytes > budget) store.delete(cursor.primaryKey);
      else { total += bytes; files++; }
      cursor.continue();
    };
    tx.oncomplete = () => {
      stats.files = files;
      stats.bytes = total;
      if (prune) stats.writeFailed = false;
    };
  }

  function open() {
    if (!stats.available) return Promise.resolve(null);
    database ??= new Promise(resolve => {
      try {
        const request = indexedDB.open(databaseName, 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore(assetStore);
          store.createIndex(byUse, ["usedAt", "bytes"]);
        };
        request.onsuccess = () => {
          if (!stats.available) return request.result.close();
          request.result.onversionchange = () => { request.result.close(); database = undefined; };
          measure(request.result.transaction(assetStore));
          resolve(request.result);
        };
        request.onerror = request.onblocked = () => { stats.available = false; resolve(null); };
      } catch {
        stats.available = false;
        resolve(null);
      }
    });
    return database;
  }

  async function read(key) {
    try {
      const db = await open();
      if (!db) return null;
      return await new Promise(resolve => {
        const request = db.transaction(assetStore).objectStore(assetStore).get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async function save(key, entry, version) {
    try {
      const db = await open();
      if (!db || version !== generation || entry.bytes > budget) return;
      const tx = db.transaction(assetStore, "readwrite");
      tx.onabort = () => { stats.writeFailed = true; };
      tx.objectStore(assetStore).put(entry, key);
      // Read the index keys only. Opening the records would load every asset.
      measure(tx, true);
    } catch {
      stats.writeFailed = true;
    }
  }

  async function getAsset(url, signal, revision, decode, reload = false) {
    const version = generation;
    const now = Date.now();
    const entry = reload ? null : await read(url);
    signal?.throwIfAborted();
    const cached = version === generation && entry?.revision === revision ? entry : null;
    let blob;
    let next;
    if (cached && now - cached.checkedAt < freshness) {
      blob = cached.blob;
      if (now - cached.usedAt > 60_000) next = { ...cached, usedAt: now };
    } else {
      const headers = cached?.etag ? { "If-None-Match": cached.etag } : undefined;
      const response = await fetch(url, { signal, headers, cache: "no-store" });
      if (response.status === 304 && cached) {
        blob = cached.blob;
        next = { ...cached, checkedAt: now, usedAt: now };
      } else {
        if (!response.ok) throw new Error("模型文件暂不可用");
        blob = await response.blob();
        next = { blob, bytes: blob.size, revision, etag: response.headers.get("ETag"), checkedAt: now, usedAt: now };
      }
    }
    const data = await decode(blob);
    signal?.throwIfAborted();
    if (cached?.blob === blob) stats.hits++;
    if (next) void save(url, next, version);
    return data;
  }

  async function decodeModel(blob) {
    const buffer = await blob.arrayBuffer();
    const header = new DataView(buffer);
    if (buffer.byteLength < 12 || header.getUint32(0, true) !== 0x46546c67 ||
        header.getUint32(8, true) !== buffer.byteLength) throw new Error("GLB 模型数据无效");
    return buffer;
  }

  async function decodeJpeg(blob) {
    const signature = new Uint8Array(await blob.slice(0, 3).arrayBuffer());
    if (signature[0] !== 0xff || signature[1] !== 0xd8 || signature[2] !== 0xff) {
      throw new Error("地形贴图数据无效");
    }
    return blob;
  }

  async function clear() {
    generation++;
    const db = await open();
    if (!db) return false;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(assetStore, "readwrite");
        tx.oncomplete = () => {
          Object.assign(stats, { hits: 0, files: 0, bytes: 0, writeFailed: false });
          resolve(true);
        };
        tx.onabort = () => resolve(false);
        tx.objectStore(assetStore).clear();
      } catch { resolve(false); }
    });
  }

  return {
    get: (url, signal, revision = "", options) => getAsset(url, signal, revision, decodeModel, options?.reload),
    getJpeg: (url, signal, revision = "") => getAsset(url, signal, revision, decodeJpeg),
    stats, clear,
  };
}
