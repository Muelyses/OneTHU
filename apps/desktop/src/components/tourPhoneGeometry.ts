import * as THREE from "three";

/** Apple CN specs + support 148590, read 2026-10-23. Only these mm/pixel values are measured specifications. */
export const IPHONE_18_PRO = Object.freeze({
  widthMm: 71.9, heightMm: 150, depthMm: 8.75, displayWidthPx: 1206, displayHeightPx: 2622, ppi: 460,
  height: 2.6, width: 2.6 * 71.9 / 150, depth: 2.6 * 8.75 / 150,
  // The 6.3" panel is 1206/460 inch (66.6 mm) wide and 2622/460 inch (144.8 mm) tall,
  // so its size follows the same scale as the body. Everything below it is a
  // presentation approximation, not an Apple CAD dimension.
  displayWidth: 2.6 * (1206 / 460 * 25.4) / 150,
  displayHeight: 2.6 * (2622 / 460 * 25.4) / 150,
  // displayCorner is the physical screen radius; glassCorner is the cover-glass
  // outline. The difference is what keeps the capture's own corners inside the
  // glass silhouette while the front camera stays clear above the status area.
  corner: .21, bevel: .018, displayCorner: .135, glassCorner: .17,
  contentWidth: 2.6 * (1206 / 460 * 25.4) / 150, contentHeight: 2.6 * (2622 / 460 * 25.4) / 150, contentY: 0,
  // A slim front sensor slit inside the top bezel: it never covers captured UI.
  islandWidth: .19, islandHeight: .01, islandY: 1.2555,
  // Three lenses sit in the top-left cluster, with the flash and microphone beside them.
  plateauWidth: .63, plateauHeight: .66, plateauX: -.27, plateauY: .885,
});

export interface PhoneScreenFit { width: number; height: number; x: number; y: number }
/** Contain the entire capture, including its four corners; never crop or stretch its UVs. */
export function fitPhoneScreen(sourceWidth: number, sourceHeight: number): PhoneScreenFit {
  if (![sourceWidth, sourceHeight].every(value => Number.isFinite(value) && value > 0)) throw new RangeError("Invalid phone screen dimensions");
  const scale = Math.min(IPHONE_18_PRO.contentWidth / sourceWidth, IPHONE_18_PRO.contentHeight / sourceHeight);
  return { width: sourceWidth * scale, height: sourceHeight * scale, x: 0, y: IPHONE_18_PRO.contentY };
}

interface ContourPoint { x: number; y: number; nx: number; ny: number }
const controls = [0, .34, .68, 1, 1, 1];
function bezier(values: readonly number[], t: number): number {
  const row = [...values];
  for (let size = row.length - 1; size > 0; size--) for (let i = 0; i < size; i++) row[i] = row[i]! * (1 - t) + row[i + 1]! * t;
  return row[0]!;
}
const derivative = controls.slice(1).map((value, i) => 5 * (value - controls[i]!));

/** Clockwise convex outline. Quintic corners meet straight edges with zero curvature (G2), unlike a quadratic corner. */
export function phoneContour(width: number, height: number, radius: number, segments = 24): ContourPoint[] {
  if (![width, height, radius].every(Number.isFinite) || width <= 0 || height <= 0 || radius <= 0 || radius > Math.min(width, height) / 2 || !Number.isInteger(segments) || segments < 4) throw new RangeError("Invalid phone contour");
  const points: ContourPoint[] = [];
  for (let corner = 0; corner < 4; corner++) {
    for (let step = 0; step <= segments; step++) {
      const t = step / segments, u = bezier(controls, t), v = bezier(controls, 1 - t);
      const dx = bezier(derivative, t), dy = -bezier(derivative, 1 - t), length = Math.hypot(dx, dy);
      // Rotate the normalized corner; rectangular center offsets stay on their own axes.
      const x = radius * u, y = radius * v, nx = -dy / length, ny = dx / length;
      if (corner === 0) points.push({ x: width / 2 - radius + x, y: height / 2 - radius + y, nx, ny });
      if (corner === 1) points.push({ x: width / 2 - radius + y, y: -height / 2 + radius - x, nx: ny, ny: -nx });
      if (corner === 2) points.push({ x: -width / 2 + radius - x, y: -height / 2 + radius - y, nx: -nx, ny: -ny });
      if (corner === 3) points.push({ x: -width / 2 + radius - y, y: height / 2 - radius + x, nx: -ny, ny: nx });
    }
  }
  return points;
}

/** A rounded XY slab with an independent, small Z edge roll. No depth/2 clamp on the plan-view corner. */
export function createPhoneSlab(width: number, height: number, depth: number, radius: number, bevel = .006): THREE.BufferGeometry {
  if (!Number.isFinite(depth) || depth <= 0 || !Number.isFinite(bevel) || bevel < 0) throw new RangeError("Invalid phone slab depth");
  const contour = phoneContour(width, height, radius), count = contour.length;
  const roll = Math.min(bevel, depth * .49, radius * .2), steps = 5;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const vertex = (x: number, y: number, z: number, nx: number, ny: number, nz: number): number => {
    positions.push(x, y, z); normals.push(nx, ny, nz); uvs.push(x / width + .5, y / height + .5); return positions.length / 3 - 1;
  };
  for (const side of [-1, 1]) {
    for (let step = 0; step <= steps; step++) {
      const angle = (side < 0 ? steps - step : step) / steps * Math.PI / 2;
      const inset = roll * (1 - Math.cos(angle)), z = side * (depth / 2 - roll + roll * Math.sin(angle));
      for (const point of contour) vertex(point.x - point.nx * inset, point.y - point.ny * inset, z, point.nx * Math.cos(angle), point.ny * Math.cos(angle), side * Math.sin(angle));
    }
  }
  const rings = 2 * (steps + 1);
  for (let ring = 0; ring < rings - 1; ring++) for (let i = 0; i < count; i++) {
    const a = ring * count + i, b = ring * count + (i + 1) % count, c = a + count, d = b + count;
    indices.push(a, c, b, b, c, d);
  }
  for (const side of [-1, 1]) {
    const center = vertex(0, 0, side * depth / 2, 0, 0, side), start = positions.length / 3;
    for (const point of contour) vertex(point.x - point.nx * roll, point.y - point.ny * roll, side * depth / 2, 0, 0, side);
    for (let i = 0; i < count; i++) {
      const a = start + i, b = start + (i + 1) % count;
      if (side < 0) indices.push(center, a, b); else indices.push(center, b, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  geometry.userData.phoneSlab = { width, height, depth, radius, bevel: roll, cornerSegments: 24, continuous: true };
  return geometry;
}

export function createPhoneFace(width: number, height: number, radius: number): THREE.BufferGeometry {
  const contour = phoneContour(width, height, radius), shape = new THREE.Shape();
  shape.moveTo(contour[0]!.x, contour[0]!.y);
  for (const point of contour.slice(1)) shape.lineTo(point.x, point.y);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape), positions = geometry.getAttribute("position"), uv = geometry.getAttribute("uv");
  for (let index = 0; index < positions.count; index++) uv.setXY(index, positions.getX(index) / width + .5, positions.getY(index) / height + .5);
  return geometry;
}
