// Parametric display mesh for a solid of revolution (a screw, a pin, a shaft end).
//
// The radius of the STEP solid is measured along its long axis: for each slice, the
// furthest vertex from the axis. That profile is simplified until it stays within a
// tolerance, then revolved around the axis with a few segments. A screw of a few hundred
// triangles in the STEP becomes one of about two hundred, with smooth normals on the
// curves and hard edges where the profile turns sharply (the head's underside, the
// shoulder). It is only used for Parts that really are solids of revolution, and the
// build checks the revolved mesh against the STEP profile before writing it.

const SLICES = 800;

/** The long axis index (0, 1, 2) and the axis' centre in the other two coordinates. */
export function revolutionAxis(bounds) {
  const size = bounds.max.map((v, k) => v - bounds.min[k]);
  const axis = size.indexOf(Math.max(...size));
  return { axis, centre: bounds.center };
}

/**
 * The furthest radius from the axis at each slice, as [axial, radius] points from the bottom
 * of the solid to the top. Each slice is cut through the triangles, so a long shank between
 * two vertices still gets its true radius, not a chord. Slices the solid does not reach are
 * skipped.
 */
export function radialProfile(indices, positions, bounds, axis) {
  const others = [0, 1, 2].filter((k) => k !== axis);
  const lo = bounds.min[axis];
  const span = bounds.max[axis] - lo || 1;
  const cx = bounds.center[others[0]];
  const cy = bounds.center[others[1]];
  const rmax = new Float64Array(SLICES).fill(-1);
  const slice = (x) => Math.min(SLICES - 1, Math.max(0, Math.floor(((x - lo) / span) * SLICES)));
  const P = (v, k) => positions[v * 3 + k];
  for (let t = 0; t < indices.length; t += 3) {
    const v = [indices[t], indices[t + 1], indices[t + 2]];
    const ax = v.map((i) => P(i, axis));
    const s0 = slice(Math.min(...ax));
    const s1 = slice(Math.max(...ax));
    for (let s = s0; s <= s1; s++) {
      const plane = lo + ((s + 0.5) / SLICES) * span;
      for (let e = 0; e < 3; e++) {
        const i = v[e], j = v[(e + 1) % 3];
        const a0 = P(i, axis), a1 = P(j, axis);
        if ((a0 - plane) * (a1 - plane) > 0) continue;
        const f = a0 === a1 ? 0 : (plane - a0) / (a1 - a0);
        const c0 = P(i, others[0]) + (P(j, others[0]) - P(i, others[0])) * f - cx;
        const c1 = P(i, others[1]) + (P(j, others[1]) - P(i, others[1])) * f - cy;
        const r = Math.hypot(c0, c1);
        if (r > rmax[s]) rmax[s] = r;
      }
    }
  }
  const out = [];
  for (let s = 0; s < SLICES; s++) {
    if (rmax[s] < 0) continue;
    out.push([lo + ((s + 0.5) / SLICES) * span, rmax[s]]);
  }
  // Anchor the ends on the solid's true extent, not on the half-slice centres.
  if (out.length) {
    out.unshift([lo, out[0][1]]);
    out.push([lo + span, out[out.length - 1][1]]);
  }
  return out;
}

/** Ramer–Douglas–Peucker simplification of a 2D polyline, keeping its ends. */
export function simplifyProfile(points, toleranceMm) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    let worst = -1;
    let worstAt = -1;
    const [x1, y1] = points[i];
    const [x2, y2] = points[j];
    const len = Math.hypot(x2 - x1, y2 - y1) || 1;
    for (let k = i + 1; k < j; k++) {
      const [x, y] = points[k];
      const d = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1) / len;
      if (d > worst) {
        worst = d;
        worstAt = k;
      }
    }
    if (worst > toleranceMm) {
      keep[worstAt] = 1;
      stack.push([i, worstAt], [worstAt, j]);
    }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * Revolves a profile around the axis. Rings are split where the profile turns more than
 * `creaseDeg`, so a shoulder keeps its hard edge. Flat ends get a cap.
 * @returns {{ positions: Float32Array, normals: Float32Array, indices: Uint32Array }} in the
 *   STEP frame, which the caller converts to the Part frame.
 */
export function revolve(profile, { axis, centre }, segments = 14, creaseDeg = 35) {
  const a = axis;
  const others = [0, 1, 2].filter((k) => k !== a);
  const ax = [0, 0, 0];
  ax[a] = 1;
  const u = [0, 0, 0];
  u[others[0]] = 1;
  const v = [0, 0, 0];
  v[others[1]] = 1;
  const cosCrease = Math.cos((creaseDeg * Math.PI) / 180);
  // The profile's axial values are absolute, so the origin's axial component is zero.
  const origin = [0, 1, 2].map((k) => (k === a ? 0 : centre[k]));

  // Each profile point gives one ring per side of its crease: the normal of the segment
  // before it and of the segment after it, averaged when they are close in direction.
  const rings = []; // { t, r, n: [axialN, radialN] }
  const normalOf = (p, q) => {
    const dt = q[0] - p[0];
    const dr = q[1] - p[1];
    const len = Math.hypot(dt, dr) || 1;
    return [-dr / len, dt / len]; // outward for a profile running bottom to top
  };
  for (let i = 0; i < profile.length; i++) {
    const [t, r] = profile[i];
    const before = i > 0 ? normalOf(profile[i - 1], profile[i]) : null;
    const after = i < profile.length - 1 ? normalOf(profile[i], profile[i + 1]) : null;
    if (before && after) {
      const dot = before[0] * after[0] + before[1] * after[1];
      if (dot >= cosCrease) {
        const m = [before[0] + after[0], before[1] + after[1]];
        const len = Math.hypot(...m) || 1;
        rings.push({ t, r, n: [m[0] / len, m[1] / len] });
      } else {
        rings.push({ t, r, n: before }, { t, r, n: after });
      }
    } else {
      rings.push({ t, r, n: before ?? after });
    }
  }

  const positions = [];
  const normals = [];
  const indices = [];
  const at = (ringIndex, s) => ringIndex * segments + s;
  for (const ring of rings) {
    for (let s = 0; s < segments; s++) {
      const th = (2 * Math.PI * s) / segments;
      const c = Math.cos(th);
      const d = Math.sin(th);
      const radial = [0, 0, 0].map((_, k) => u[k] * c + v[k] * d);
      const p = [0, 1, 2].map((k) => origin[k] + ax[k] * ring.t + radial[k] * ring.r);
      positions.push(...p);
      const n = [0, 1, 2].map((k) => ax[k] * ring.n[0] + radial[k] * ring.n[1]);
      normals.push(...n);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      const a0 = at(i, s), a1 = at(i, s1), b0 = at(i + 1, s), b1 = at(i + 1, s1);
      indices.push(a0, a1, b0, a1, b1, b0);
    }
  }
  // Flat ends: a cap where the profile does not close on the axis.
  for (const [ringIndex, sign] of [[0, -1], [rings.length - 1, 1]]) {
    const ring = rings[ringIndex];
    if (ring.r < 1e-6) continue;
    const capCentre = positions.length / 3;
    positions.push(...[0, 1, 2].map((k) => origin[k] + ax[k] * ring.t));
    normals.push(...[0, 1, 2].map((k) => ax[k] * sign));
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      const th = (2 * Math.PI * s) / segments;
      const th1 = (2 * Math.PI * (s + 1)) / segments;
      for (const angle of [th, th1]) {
        const c = Math.cos(angle), d = Math.sin(angle);
        positions.push(...[0, 1, 2].map((k) => origin[k] + ax[k] * ring.t + (u[k] * c + v[k] * d) * ring.r));
        normals.push(...[0, 1, 2].map((k) => ax[k] * sign));
      }
      const first = positions.length / 3 - 2;
      // Winding follows the cap's facing direction.
      if (sign < 0) indices.push(capCentre, first + 1, first);
      else indices.push(capCentre, first, first + 1);
    }
  }
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: Uint32Array.from(indices),
  };
}
