// The map exporter omits metallicFactor for many materials; glTF defaults it to 1.
// Use dielectric lighting for known masonry and timber, preserving explicit values.
export function repairBuildingMaterials(root, parser) {
  const masonry = /concrete|brick|plaster|stucco|sandstone|loamwall|mortar|adobe|cement|stonewall|woodlog|plywood|timber/i;
  const other = /metal|steel|glass|water|chrome|copper|brass|aluminium|aluminum/i;
  const seen = new Set();
  root.traverse(node => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material?.isMeshStandardMaterial || seen.has(material)) continue;
      seen.add(material);
      const index = parser.associations.get(material)?.materials;
      const definition = parser.json.materials?.[index];
      const name = definition?.name ?? material.name;
      if (definition && material.metalness === 1 && !material.metalnessMap && !material.transparent &&
          definition.pbrMetallicRoughness?.metallicFactor === undefined && masonry.test(name) && !other.test(name)) {
        material.metalness = 0;
      }
    }
  });
}
