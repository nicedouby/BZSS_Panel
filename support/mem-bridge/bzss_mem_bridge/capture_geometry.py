"""Read and project a capture actor's overlap volumes into map coordinates."""

import math
import struct

from .memory import BridgeError


def rotate(quat, vector):
    x, y, z, w = quat
    vx, vy, vz = vector
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (
        vx + w * tx + y * tz - z * ty,
        vy + w * ty + z * tx - x * tz,
        vz + w * tz + x * ty - y * tx,
    )


def rounded_outline(x, y, radius, dx=0.0, dy=0.0):
    """Outline of a disk swept over the projected capsule axis."""
    heading = math.atan2(dy, dx)
    points = []
    for direction, start in ((1, heading - math.pi / 2), (-1, heading + math.pi / 2)):
        for step in range(33):
            angle = start + math.pi * step / 32
            points.append([x + direction * dx + radius * math.cos(angle),
                           y + direction * dy + radius * math.sin(angle)])
    return points


def convex_hull(points):
    points = sorted(set(points))

    def half(vertices):
        result = []
        for x, y in vertices:
            while len(result) >= 2:
                ax, ay = result[-2]
                bx, by = result[-1]
                if (bx - ax) * (y - ay) > (by - ay) * (x - ax):
                    break
                result.pop()
            result.append((x, y))
        return result[:-1]

    return half(points) + half(reversed(points))


def has_query_collision(ue, shape):
    body = ue.prop(shape, 'BodyInstance')
    descriptor = ue.m.u64(body.descriptor + 0x70)
    field = ue.m.u64(descriptor + 0x50)
    for _ in range(128):
        if not field:
            break
        if ue.fname(ue.m.u32(field + 0x20)) == 'CollisionEnabled':
            offset = ue.m.i32(field + 0x44)
            if 0 <= offset < body.size and ue.m.i32(field + 0x30) == 1:
                return ue.m.read(shape + body.offset + offset, 1)[0] in (1, 3, 5)
            break
        field = ue.m.u64(field + 0x18)
    return False


def shape_transform(ue, shape):
    location_offset = int(ue.layout['componentWorldLocationOffset'], 0)
    qx, qy, qz, qw, wx, wy, wz, _, sx, sy, sz, _ = struct.unpack(
        '<12d', ue.m.read(shape + location_offset - 32, 96))
    return (qx, qy, qz, qw), (wx, wy, wz), (sx, sy, sz)


def shape_bounds(ue, shape, delta_from):
    if not ue.scalar(shape, 'bGenerateOverlapEvents') or not has_query_collision(ue, shape):
        return None
    info = ue.info(shape)
    quat, (wx, wy, wz), scale = shape_transform(ue, shape)
    scales = tuple(abs(value) for value in scale)
    if (not all(math.isfinite(v) for v in (*quat, wx, wy, wz, *scales))
            or not math.isclose(sum(v * v for v in quat), 1, abs_tol=0.002)
            or not all(0 < v <= 100 for v in scales)):
        return None
    x, y = wx - delta_from['x'], wy - delta_from['y']
    if ue.is_a(shape, 'CapsuleComponent'):
        # Restrict to uniform effective scale until nonuniform Chaos behavior is verified.
        if max(scales) - min(scales) > 0.0001:
            return None
        radius = ue.scalar(shape, 'CapsuleRadius') * scales[0]
        half_height = ue.scalar(shape, 'CapsuleHalfHeight') * scales[0]
        if not 0 < radius <= half_height <= 500_000:
            return None
        dx, dy, _ = rotate(quat, (0, 0, half_height - radius))
        outline = rounded_outline(x, y, radius, dx, dy)
        kind, meters = 'capsule', [radius / 100, half_height / 100]
    elif ue.is_a(shape, 'SphereComponent'):
        if max(scales) - min(scales) > 0.0001:
            return None
        radius = ue.scalar(shape, 'SphereRadius') * scales[0]
        if not 0 < radius <= 500_000:
            return None
        outline = rounded_outline(x, y, radius)
        kind, meters = 'sphere', [radius / 100]
    elif ue.is_a(shape, 'BoxComponent'):
        prop = ue.prop(shape, 'BoxExtent')
        if prop.kind != 'StructProperty' or prop.size != 24:
            return None
        extent = struct.unpack('<3d', ue.m.read(shape + prop.offset, 24))
        ex, ey, ez = (a * b for a, b in zip(extent, scales))
        if not all(0 < v <= 500_000 for v in (ex, ey, ez)):
            return None
        corners = [rotate(quat, (a, b, c)) for a in (-ex, ex) for b in (-ey, ey) for c in (-ez, ez)]
        outline = convex_hull((x + dx, y + dy) for dx, dy, _ in corners)
        kind, meters = 'box', [ex / 50, ey / 50, ez / 50]
    else:
        return None
    if len(outline) < 3 or not ue.unchanged(info):
        return None
    return {'kind': kind, 'center': {'x': wx, 'y': wy, 'z': wz}, 'sizeMeters': meters,
            'rotationXyzw': list(quat),
            'outline': [[round(px, 2), round(py, 2)] for px, py in outline]}


def capture_shapes(ue, actor):
    root = ue.pointer(actor, 'RootComponent')
    pending = [root]
    visited = set()
    while pending and len(visited) < 64:
        obj = pending.pop()
        if not obj or obj in visited:
            continue
        visited.add(obj)
        try:
            if ue.info(obj).outer != actor:
                continue
            pending.extend(ue.array(obj, 'AttachChildren', 64))
            if ue.is_a(obj, 'ShapeComponent'):
                yield obj
        except BridgeError:
            continue


def read_capture_volumes(ue, actor, position, epoch):
    if not position:
        return []
    volumes = []
    for obj in capture_shapes(ue, actor):
        try:
            bounds = shape_bounds(ue, obj, position)
            if bounds:
                volumes.append({'id': ue.entity_id(epoch, obj), **bounds})
        except BridgeError:
            continue
    return volumes


def read_footprints(ue, actor, position):
    return [volume['outline'] for volume in read_capture_volumes(ue, actor, position, '')]
