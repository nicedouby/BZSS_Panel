import {
  BoxGeometry, CapsuleGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial,
  SphereGeometry, Vector3, WireframeGeometry,
} from "three";

function worldPoint(point) {
  return new Vector3(point.x / 100, point.z / 100, point.y / 100);
}

function validPoint(point) {
  return point && [point.x, point.y, point.z].every(Number.isFinite);
}

function geometry(volume) {
  const sizes = volume.sizeMeters;
  if (!Array.isArray(sizes) || !sizes.every(n => Number.isFinite(n) && n > 0 && n <= 10_000)) return null;
  const [a, b, c] = sizes;
  if (volume.kind === "sphere" && sizes.length === 1) return new SphereGeometry(a, 16, 10);
  if (volume.kind === "capsule" && sizes.length === 2 && b >= a) {
    return b === a ? new SphereGeometry(a, 16, 10) : new CapsuleGeometry(a, (b - a) * 2, 5, 16);
  }
  if (volume.kind === "box" && sizes.length === 3) return new BoxGeometry(a, c, b);
  return null;
}

export function captureVolumeOverlay(scene, labelLayer) {
  const root = new Group();
  root.name = "LiveCaptureVolumes";
  scene.add(root);
  const labels = [];
  const projected = new Vector3();
  let count = 0;

  function clear() {
    root.traverse(child => {
      child.geometry?.dispose();
      child.material?.dispose();
    });
    root.clear();
    labelLayer.replaceChildren();
    labels.length = 0;
    count = 0;
  }

  function update(points) {
    clear();
    for (const point of points) {
      if (point.kind !== "capture_zone" || !Array.isArray(point.capture?.volumes)) continue;
      const owner = point.capture.owningTeam ?? point.teamId;
      const color = owner === 1 ? 0x76dafe : owner === 2 ? 0xffb094 : 0xa2f3c8;
      const group = new Group();
      let labelAnchor;
      for (const volume of point.capture.volumes) {
        const q = volume.rotationXyzw;
        if (!validPoint(volume.center) || !Array.isArray(q) || q.length !== 4 || !q.every(Number.isFinite)) continue;
        const shape = geometry(volume);
        if (!shape) continue;
        const placement = new Group();
        placement.position.copy(worldPoint(volume.center));
        placement.quaternion.set(-q[0], -q[2], -q[1], q[3]).normalize();
        const fill = new Mesh(shape, new MeshBasicMaterial({
          color, transparent: true, opacity: 0.11, depthWrite: false,
        }));
        const outline = new LineSegments(new WireframeGeometry(shape), new LineBasicMaterial({
          color, transparent: true, opacity: 0.75, depthWrite: false, depthTest: false,
        }));
        outline.renderOrder = 10;
        placement.add(fill, outline);
        group.add(placement);
        labelAnchor ??= placement.position.clone().add(new Vector3(0, Math.max(...volume.sizeMeters) + 4, 0));
        count++;
      }
      if (!labelAnchor) continue;
      root.add(group);
      const label = document.createElement("span");
      const side = point.capture.capturingTeam;
      const progress = point.capture.percentRaw;
      const capture = side > 0 && Number.isFinite(progress) ?
        `队伍 ${side} 占领中 ${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%` : "";
      const state = point.capture.locked ? "已锁定" : capture;
      label.textContent = [point.name || "占领区", state].filter(Boolean).join(" · ");
      labelLayer.append(label);
      labels.push([label, labelAnchor]);
    }
    return count;
  }

  function renderLabels(camera, size) {
    if (!root.visible || !size) return;
    for (const [label, anchor] of labels) {
      projected.copy(anchor).project(camera);
      const inView = Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1;
      label.hidden = !inView;
      if (inView) label.style.transform = `translate(${(projected.x + 1) * size.width / 2}px,${(1 - projected.y) * size.height / 2}px) translate(-50%,-100%)`;
    }
  }

  return {
    update, renderLabels,
    toggle(visible) { root.visible = visible; labelLayer.hidden = !visible; },
    dispose() { clear(); root.removeFromParent(); },
  };
}
