import { Texture } from "three";

// Decode embedded scenery photos directly, without temporary blob URLs.
export function loadTacticalEmbeddedImages(parser) {
  const plugin = { name: "BZSS_embedded_images" };
  if (typeof createImageBitmap !== "function") return plugin;
  const original = parser.loadImageSource.bind(parser);
  parser.loadImageSource = (sourceIndex, loader) => {
    const image = parser.json.images[sourceIndex];
    if (image.bufferView === undefined || !["image/jpeg", "image/png"].includes(image.mimeType)) {
      return original(sourceIndex, loader);
    }
    if (parser.sourceCache[sourceIndex]) {
      return parser.sourceCache[sourceIndex].then(texture => texture.clone());
    }
    const decoded = parser.getDependency("bufferView", image.bufferView).then(bytes => {
      const blob = new Blob([bytes], { type: image.mimeType });
      return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
    }).then(bitmap => {
      const texture = new Texture(bitmap);
      texture.needsUpdate = true;
      return texture;
    });
    parser.sourceCache[sourceIndex] = decoded;
    return decoded;
  };
  return plugin;
}
