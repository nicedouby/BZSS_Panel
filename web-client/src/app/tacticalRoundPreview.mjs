import { Box3, BoxGeometry, GridHelper, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Vector3 } from "three";

const duration = 72;
const spawn = [-42, 42];
const throwCycle = 13;
const demoThrows = [
  { team: 1, index: 0, at: 2.5, kind: "smoke", held: "SK_M18", mesh: "M18_projectile", flight: 1.7 },
  { team: 2, index: 0, at: 5, kind: "grenade", held: "Type86P_frag", mesh: "Type86P_frag_proj", flight: 1.55 },
];
const equipment = {
  1: { rifles: ["M4", "M16A4", "SK_M249_V2", "M4_CarryHandle"], pistol: "M17", launcher: "SK_AT4" },
  2: { rifles: ["SK_QBZ191", "QBZ95-1", "SK_QJB201_BoxFed", "SK_QBZ192"], pistol: "QSZ-92_Pistol", launcher: "DZJ-08" },
};
const position = (x, y, z = 0) => ({ x: x * 100, y: y * 100, z: z * 100 });
const rotation = yaw => [0, 0, Math.sin(yaw / 2), Math.cos(yaw / 2)];
const transform = (x, y, z = 0, yaw = 0) => ({
  position: position(x, y, z), quaternion: rotation(yaw), scale: [1, 1, 1],
});

function track(team, index, t) {
  const side = team === 1 ? 1 : -1;
  const origin = spawn[team - 1] - index * side * 3;
  const crossing = Math.min(1, Math.max(0, (t - index * .65) / (14 + index * 3)));
  if (t < 24) return [origin + side * (45 + index * 3) * crossing, (index - 1.5) * 4.4 + team * 2];
  const circle = (t - 24) * (.17 + index * .055);
  const shift = Math.min(1, (t - 24) / 3);
  return [side * 3 + shift * (Math.cos(circle) - 1) * (6 + index * 2) * side,
    (index - 1.5) * 4.4 + team * 2 + shift * Math.sin(circle) * (4 + index * 2)];
}

function soldier(teamId, index, t) {
  const [x, y] = track(teamId, index, t);
  const [nx, ny] = track(teamId, index, t + .05);
  const angle = teamId === 1 ? 0 : Math.PI;
  const phase = (t + index * 2.2 + teamId * .6) % 19;
  const stance = phase > 15 ? "prone" : phase > 11 ? "crouched" : "standing";
  const inventory = equipment[teamId];
  const throwEvent = demoThrows.find(event => event.team === teamId && event.index === index &&
    Math.abs(t % throwCycle - event.at) < .8);
  const aiming = !throwEvent && phase >= 5 && phase < 10;
  const weapon = phase < 7.5 ? inventory.rifles[index] : phase < 11 ? inventory.pistol :
    phase < 15 ? "MedicBag" : inventory.launcher;
  const firing = aiming && t > 4;
  const shotCounter = Math.floor((t + index * .24) / (index === 2 ? .32 : .77));
  const jump = (t + index * .75) % 14 - 2;
  const airborne = jump > 0 && jump < .65 && stance === "standing";
  const jumpY = airborne ? 6.6 * jump * (.65 - jump) : 0;
  const capsule = stance === "prone" ? .34 : stance === "crouched" ? .62 : .9;
  const throwing = throwEvent && t % throwCycle >= throwEvent.at && t % throwCycle - throwEvent.at < .32;
  const equipped = throwEvent?.held ?? weapon;
  return {
    id: `preview-${teamId}-${index}`, name: `${teamId === 1 ? "青队" : "棕队"} ${index + 1}`,
    position: position(x, y, capsule + jumpY), positionStatus: "ok", hasPawn: true, pawnClass: "PreviewSoldier",
    factionId: teamId === 1 ? "USA" : "PLA",
    teamId, yaw: (angle + Math.sin(t * .7 + index) * .21) * 180 / Math.PI,
    pitch: aiming ? Math.sin(t * 2 + index) * 6 : 0, stance, airborne,
    capsuleHalfHeight: capsule * 100, aiming, sprinting: t > 1 && t < 12 && index % 2 === 0,
    velocity: position((nx - x) / .05, (ny - y) / .05, airborne ? 6.6 * (.65 - 2 * jump) : 0),
    lean: aiming ? Math.sin(t * 1.6 + teamId) : 0,
    weaponId: `preview-${teamId}-${index}-${equipped}`, weaponMesh: equipped,
    weaponClass: throwEvent ? `${throwEvent.kind} grenade` : weapon,
    weaponMount: throwEvent ? { socket: "Bip01_IK_R_Hand_Grenade_Socket", bone: "Bip01_R_Hand" } : null,
    firing, throwing: Boolean(throwing), itemReleased: Boolean(throwEvent && t % throwCycle >= throwEvent.at),
    shotCounter: firing ? shotCounter : null, shotTime: firing ? shotCounter + 1 : null,
    shotOrigin: position(x + Math.cos(angle) * .8, y, stance === "standing" ? 1.5 : 1),
    shotDirection: position(Math.cos(angle), Math.sin(t * 3 + index) * .13),
  };
}

function vehicle(t) {
  const heading = Math.sin(t * .12) * .47;
  const turret = heading + Math.sin(t * .7) * .95;
  const x = -25 + Math.sin(t * .15) * 15;
  const y = 13 + Math.cos(t * .15) * 6;
  const firing = t % 6 > 2 && t % 6 < 3;
  const shotCounter = Math.floor(t / 1.5);
  const id = "preview-vehicle";
  return [{
    id, kind: "vehicle", class: "巡逻车", teamId: 1, ...transform(x, y, 0, heading),
    parts: [
      { id: "vehicle-body", previewType: "vehicle", role: "body", ...transform(x, y, 0, heading) },
      { id: "vehicle-turret", previewType: "turret", role: "turret", ...transform(x, y, 2, turret) },
    ],
  }, {
    id: "preview-gunner", name: "青队炮手", teamId: 1, hasPawn: true, seatKind: "turret", seated: true,
    vehicleId: id, position: position(x, y, 2.3), positionStatus: "ok", yaw: turret * 180 / Math.PI,
    firing, weaponId: "preview-turret", shotCounter: firing ? shotCounter : null, shotTime: firing ? shotCounter + 1 : null,
    shotOrigin: position(x + Math.cos(turret) * 1.2, y + Math.sin(turret) * 1.2, 2.2),
    shotDirection: position(Math.cos(turret), Math.sin(turret)),
  }];
}

function projectiles(t) {
  const repeat = Math.floor(t / throwCycle);
  const cycle = t % throwCycle;
  const result = [];
  for (const event of demoThrows) {
    const age = cycle - event.at;
    const lifetime = event.kind === "smoke" ? 9 : event.flight;
    if (age < 0 || age >= lifetime) continue;
    const progress = Math.min(1, age / event.flight);
    const smoke = event.kind === "smoke" && progress === 1;
    const [x, y] = track(event.team, event.index, repeat * throwCycle + event.at);
    const side = event.team === 1 ? 1 : -1;
    const height = 1.35 * (1 - progress) + 10 * progress * (1 - progress) + .065;
    result.push({ id: `${event.kind}-${repeat}`, kind: event.kind, mesh: event.mesh,
      activeSmoke: smoke, color: [.78, .81, .84],
      ...transform(x + (.55 + 11 * progress) * side, y + 1.8 * progress, height,
        smoke ? 0 : progress * Math.PI * 4) });
  }
  if (cycle > 9 && cycle < 9.8) {
    const age = cycle - 9;
    result.push({ id: "projectile-" + repeat, kind: "projectile", mesh: "SK_AT4_Rocket_Projectile",
      ...transform(-27 + age * 58, 10, 1.8 + age * 3) });
  }
  return result;
}

const deployment = [
  { id: "demo-fob", kind: "fob", teamId: 1, ...transform(-30, -13),
    radii: { inner: { position: position(-30, -13), radius: 1200 },
      outer: { position: position(-30, -13), radius: 2600 } } },
  { id: "demo-hab", kind: "hab", teamId: 1, ...transform(-34, -13) },
  { id: "demo-rally", kind: "rally", teamId: 2, squadId: 1, ...transform(25, 12) },
].map(entry => ({ ...entry, parts: [{ id: entry.id + "-model", previewType: entry.kind, ...transform(
  entry.position.x / 100, entry.position.y / 100,
) }] }));

export function createRoundPreview() {
  let elapsed = 0, updated = 0, epoch = 1, paused = false, rate = 1, result;
  return {
    resumeClock(now) { updated = now; },
    setPaused(value, now) { paused = value; updated = now; },
    setRate(value, now) { rate = value; updated = now; },
    restart(now) { elapsed = 0; updated = now; epoch++; paused = false; result = null; },
    sample(now) {
      const dt = Math.max(0, Math.min(.35, (now - updated) / 1000));
      updated = now;
      if (paused || elapsed >= duration) {
        if (result) return result;
      } else elapsed = Math.min(duration, elapsed + dt * rate);
      const t = elapsed;
      const owner = t < 14 ? null : t < 40 ? 1 : 2;
      const squads = [1, 2].flatMap(team => [0, 1, 2, 3].map(index => soldier(team, index, t)));
      const [transport, gunner] = vehicle(t);
      result = {
        demo: true, observedAt: t, playbackRate: rate, epoch: `preview-${epoch}`,
        map: { worldName: "preview" }, players: [...squads, gunner], projectiles: projectiles(t),
        liveActors: [...deployment, transport],
        mapPoints: [{
          id: "demo-capture", kind: "capture_zone", teamId: owner, name: "中央据点",
          capture: { volumes: [{ kind: "box", sizeMeters: [22, 14, 3], center: position(0, 2, 1.5),
            rotationXyzw: [0, 0, 0, 1] }] },
        }],
        game: { elapsed: Math.floor(t), finished: t >= duration, owner,
          blue: 100 - Math.max(0, Math.floor((t - 40) / 2)), red: 100 - Math.max(0, Math.floor((Math.min(40, t) - 14) / 2)) },
      };
      return result;
    },
  };
}

export function createPreviewGround() {
  const group = new Group();
  const ground = new Mesh(new PlaneGeometry(160, 108), new MeshStandardMaterial({ color: 0x566154, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  const grid = new GridHelper(106, 53, 0x7d877a, 0x707b6d);
  grid.scale.x = 1.5;
  grid.position.y = .012;
  group.add(ground, grid);
  const wallMaterial = new MeshStandardMaterial({ color: 0x9e9381, roughness: 1 });
  for (const [x, z, w, d] of [[-13, -5, 1.3, 7], [12, 8, 7, 1.3], [6, -11, 4.5, 1.4], [-22, 6, 4, 1.2]]) {
    const wall = new Mesh(new BoxGeometry(w, 1.5, d), wallMaterial);
    wall.position.set(x, .75, z);
    group.add(wall);
  }
  return { group, bounds: new Box3(new Vector3(-65, 0, -37), new Vector3(65, 4, 37)), dispose() {
    group.removeFromParent();
    const materials = new Set();
    group.traverse(item => {
      item.geometry?.dispose();
      if (item.material) materials.add(item.material);
    });
    for (const material of materials) material.dispose();
  } };
}
