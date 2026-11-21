import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial } from "three";

// Shared geometry and materials for the original demo props and equipment fallback.
export function createPreviewModels() {
  const box = new BoxGeometry(1, 1, 1);
  const round = new CylinderGeometry(.5, .5, 1, 12);
  const materials = new Map();
  function part(parent, color, x, y, z, sx, sy, sz, geometry = box) {
    if (!materials.has(color)) materials.set(color, new MeshStandardMaterial({ color, roughness: .9 }));
    const mesh = new Mesh(geometry, materials.get(color));
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.add(mesh);
    return mesh;
  }

  function item(category) {
    const root = new Group();
    const metal = 0x343a3e, grip = 0x454743;
    if (category === "medic") {
      part(root, 0x4c664a, .12, -.05, 0, .23, .22, .14);
      part(root, 0xd6cbbb, .16, -.02, .071, .065, .022, .01);
    } else if (category === "tool") {
      part(root, grip, .17, 0, 0, .43, .035, .035);
      part(root, metal, .38, 0, 0, .20, .032, .15);
    } else {
      const small = category === "pistol", tube = category === "launcher";
      const length = small ? .22 : tube ? .78 : .84;
      part(root, metal, length * .34, 0, 0, length * .59, tube ? .10 : .073, tube ? .10 : .075);
      part(root, metal, length * .70, .006, 0, length * .39, tube ? .085 : .031, tube ? .085 : .031);
      part(root, grip, .045, -.055, 0, .065, .14, .06);
      if (!small && !tube) part(root, grip, -.14, -.016, 0, .26, .095, .065);
    }
    return root;
  }

  function scenery(type, team) {
    const root = new Group();
    const color = team === 2 ? 0x91634d : 0x536e54;
    if (type === "vehicle") {
      part(root, color, 0, .98, 0, 4.6, 1.15, 2.1);
      part(root, color, -.5, 1.62, 0, 2.8, .62, 1.96);
      for (const side of [-1, 1]) for (const axle of [-1.45, 0, 1.45]) {
        part(root, 0x2d3335, axle, .5, side * 1.13, .96, .27, .96, round).rotation.x = Math.PI / 2;
      }
    } else if (type === "turret") {
      part(root, color, 0, .15, 0, .93, .35, .88);
      part(root, 0x333a38, .69, .24, 0, 1.05, .09, .09);
    } else if (type === "hab") {
      part(root, 0xb19e7b, 0, 1.1, -1.35, 4.8, 2.2, .42);
      part(root, 0xb19e7b, -2.18, 1.1, 0, .42, 2.2, 2.7);
      part(root, 0xb19e7b, 2.18, 1.1, 0, .42, 2.2, 2.7);
      part(root, 0x625c4c, 0, 2.35, 0, 5.05, .25, 3.2);
    } else if (type === "fob") {
      part(root, color, 0, .28, 0, .6, .55, .36);
      part(root, 0x38423d, .23, .90, 0, .027, 1.13, .027);
    } else if (type === "rally") {
      part(root, color, 0, .12, 0, .58, .26, .4);
      part(root, 0x77735d, .19, .26, .05, .21, .20, .27);
    }
    return root;
  }

  return { item, scenery, dispose() {
    for (const material of materials.values()) material.dispose();
    for (const geometry of [box, round]) geometry.dispose();
  } };
}
