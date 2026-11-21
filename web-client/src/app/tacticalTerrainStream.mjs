import { Box3, Frustum, Group, Matrix4, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const concurrent = 4;
const cacheMargin = 12;
const retryDelay = 8000;
const MiB = 1024 * 1024;

function boxFrom(row) {
  if (!Array.isArray(row) || row.length !== 2 || !row.every(p =>
    Array.isArray(p) && p.length === 3 && p.every(Number.isFinite))) throw new Error("无效的地形范围");
  const box = new Box3(new Vector3(...row[0]), new Vector3(...row[1]));
  if (box.isEmpty()) throw new Error("空的地形范围");
  return box;
}

function releaseModel(model) {
  model.traverse(node => {
    node.geometry?.dispose();
    const texture = node.userData.minimapTexture ?? node.material?.map;
    texture?.dispose();
    texture?.source?.data?.close?.();
    node.material?.dispose();
  });
}

function modelBytes(model) {
  const buffers = new Set();
  const textures = new Set();
  model.traverse(node => {
    for (const attribute of Object.values(node.geometry?.attributes ?? {})) {
      const array = attribute.array ?? attribute.data?.array;
      if (array) buffers.add(array.buffer);
    }
    if (node.geometry?.index?.array) buffers.add(node.geometry.index.array.buffer);
    const texture = node.userData.minimapTexture ?? node.material?.map;
    if (texture) textures.add(texture);
  });
  let bytes = 0;
  for (const buffer of buffers) bytes += buffer.byteLength * 2; // CPU and GPU
  for (const texture of textures) {
    const image = texture.image;
    bytes += (image?.width ?? 0) * (image?.height ?? 0) * 10; // decoded pixels and GPU mip levels
  }
  return bytes;
}

async function decodeTileTexture(blob) {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  }
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const image = new Image();
  image.src = source;
  await image.decode();
  return image;
}

function cachedTileLoader(filename, blob) {
  return new GLTFLoader().register(parser => {
    const loadOriginal = parser.loadImageSource.bind(parser);
    let decoded;
    parser.loadImageSource = (index, loader) => {
      if (parser.json.images[index]?.uri !== filename) return loadOriginal(index, loader);
      decoded ??= decodeTileTexture(blob).then(image => {
        const texture = new Texture(image);
        texture.needsUpdate = true;
        return texture;
      }).catch(() => loadOriginal(index, loader));
      return decoded;
    };
    return { name: "BZSS_cached_terrain_texture" };
  });
}

export async function openTerrainStream(url, scene, signal, onUpdate, assetCache) {
  const response = await fetch(url + "terrain.json", { signal, cache: "no-cache" });
  if (!response.ok) throw new Error("地形目录暂不可用");
  const catalog = await response.json();
  if (signal.aborted) throw signal.reason;
  if (catalog.version !== 2 || !Array.isArray(catalog.tiles) || !catalog.tiles.length || catalog.tiles.length > 1024 ||
      new Set(catalog.tiles.map(tile => tile.file)).size !== catalog.tiles.length) {
    throw new Error("地形目录格式无效");
  }
  const bounds = boxFrom(catalog.bounds);
  const revision = typeof catalog.terrainRevision === "string"
    ? catalog.terrainRevision
    : response.headers.get("ETag") ?? "";
  const terrainBudget = (navigator.deviceMemory && navigator.deviceMemory <= 4 ? 256 : 640) * MiB;
  const slots = catalog.tiles.map(tile => {
    if (!/^t[0-9]{3,4}\.glb$/.test(tile.file)) throw new Error("无效的地形瓦片");
    const box = boxFrom(tile.bounds);
    return { file: tile.file, textured: tile.textured === true, box, expanded: box.clone().expandByScalar(48), needed: false,
      distance: 0, model: null, bytes: 0, request: null, lastUsed: 0, retryAt: 0 };
  });
  const root = new Group();
  root.name = "StreamedLandscape";
  scene.add(root);
  const frustum = new Frustum();
  const matrix = new Matrix4();
  const loader = new GLTFLoader();
  let loading = 0;
  let closed = false;
  let previousStatus = "";
  let textures = true;
  const viewMatrix = new Matrix4();
  let nextSelection = 0;

  function status() {
    const visible = slots.filter(slot => slot.needed);
    const update = {
      visible: visible.length,
      loaded: visible.filter(slot => slot.model).length,
      errors: visible.filter(slot => slot.retryAt > performance.now()).length,
      retained: slots.filter(slot => !slot.needed && slot.model).length,
      diskHits: assetCache?.stats.hits ?? 0,
      diskFiles: assetCache?.stats.files ?? 0,
      diskBytes: assetCache?.stats.bytes ?? 0,
      diskWriteFailed: assetCache?.stats.writeFailed ?? false,
      diskAvailable: assetCache?.stats.available ?? false,
    };
    const key = Object.values(update).join(":");
    if (previousStatus !== key) {
      previousStatus = key;
      onUpdate(update);
    }
  }

  function drop(slot) {
    if (!slot.model) return;
    slot.model.removeFromParent();
    releaseModel(slot.model);
    slot.model = null;
    slot.bytes = 0;
  }

  function refreshMaterials(model) {
    model.traverse(node => {
      if (!node.isMesh || !node.userData.minimapTexture) return;
      node.material.map = textures ? node.userData.minimapTexture : null;
      node.material.color.setRGB(...(textures ? [1, 1, 1] : [0.43, 0.37, 0.28]));
      node.material.needsUpdate = true;
    });
  }

  async function load(slot) {
    const request = new AbortController();
    slot.request = request;
    loading++;
    try {
      const base = url + "tiles/";
      const tileUrl = base + slot.file;
      const modelRequest = assetCache
        ? assetCache.get(tileUrl, request.signal, revision)
        : fetch(tileUrl, { signal: request.signal }).then(result => {
          if (!result.ok) throw new Error("地形瓦片不可用");
          return result.arrayBuffer();
        });
      const jpg = slot.file.replace(/\.glb$/, ".jpg");
      const textureRequest = assetCache && slot.textured
        ? assetCache.getJpeg(base + jpg, request.signal, revision).catch(() => null)
        : null;
      const [buffer, texture] = await Promise.all([modelRequest, textureRequest]);
      if (request.signal.aborted) return;
      const tileLoader = texture ? cachedTileLoader(jpg, texture) : loader;
      const { scene: mesh } = await tileLoader.parseAsync(buffer, base);
      if (closed || request.signal.aborted) {
        releaseModel(mesh);
        return;
      }
      mesh.traverse(node => {
        if (!node.isMesh) return;
        node.receiveShadow = true;
        if (node.material?.map) node.userData.minimapTexture = node.material.map;
      });
      refreshMaterials(mesh);
      slot.model = mesh;
      slot.bytes = assetCache ? Math.max(buffer.byteLength, modelBytes(mesh)) : 0;
      slot.lastUsed = performance.now();
      mesh.visible = slot.needed;
      root.add(mesh);
    } catch {
      if (!request.signal.aborted && !closed) slot.retryAt = performance.now() + retryDelay;
    } finally {
      slot.request = null;
      loading--;
      if (!closed) {
        fill();
        status();
      }
    }
  }

  function fill() {
    const now = performance.now();
    const queued = slots.filter(slot => slot.needed && !slot.model && !slot.request && slot.retryAt <= now)
      .sort((a, b) => a.distance - b.distance);
    for (const slot of queued.slice(0, Math.max(0, concurrent - loading))) void load(slot);
  }

  function update(camera, target) {
    if (closed) return;
    const now = performance.now();
    camera.updateMatrixWorld();
    matrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    if (assetCache && now < nextSelection && matrix.equals(viewMatrix)) return;
    viewMatrix.copy(matrix);
    nextSelection = now + 500;
    frustum.setFromProjectionMatrix(matrix);
    const previous = [];
    let visibleBytes = 0;
    for (const slot of slots) {
      slot.needed = frustum.intersectsBox(slot.expanded);
      if (slot.needed) {
        slot.distance = slot.box.distanceToPoint(target);
        slot.lastUsed = now;
        visibleBytes += slot.bytes;
      } else {
        // Let the four in-flight requests finish so quick turns can reuse them.
        if (!assetCache) slot.request?.abort();
        if (slot.model) previous.push(slot);
      }
      if (slot.model) slot.model.visible = slot.needed;
    }
    previous.sort((a, b) => b.lastUsed - a.lastUsed);
    if (assetCache) {
      // Keep decoded tiles for as long as this map is open. Evict least recently
      // visible tiles only when their measured CPU/GPU cost exceeds the budget.
      let bytes = visibleBytes;
      for (const slot of previous) {
        if (bytes + slot.bytes > terrainBudget) drop(slot);
        else bytes += slot.bytes;
      }
    } else {
      previous.slice(cacheMargin).forEach(drop);
    }
    fill();
    status();
  }

  function close() {
    if (closed) return;
    closed = true;
    for (const slot of slots) {
      slot.request?.abort();
      drop(slot);
    }
    root.removeFromParent();
  }
  signal.addEventListener("abort", close, { once: true });
  return {
    bounds, update, revision, objectTiles: catalog.objectTiles, textureAvailable: Boolean(catalog.minimap?.boundsXZ),
    showTexture(enabled) {
      textures = enabled;
      for (const slot of slots) if (slot.model) refreshMaterials(slot.model);
    },
  };
}
