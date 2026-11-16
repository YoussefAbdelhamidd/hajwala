import * as THREE from 'three'

export const ROAD_HALF = 16.5
export const ROAD_WIDTH = ROAD_HALF * 2
/** Four traffic lanes across the widened highway. */
export const LANE_X = [-12, -4, 4, 12] as const
/** Dashed dividers between the four lanes. */
export const LANE_MARKS = [-8, 0, 8] as const

type Knot = { z: number; x: number }

const knots: Knot[] = []
let rngSeed = 1

function rand() {
  rngSeed = (rngSeed * 1664525 + 1013904223) >>> 0
  return rngSeed / 4294967296
}

/** Fresh highway each run — long straight lead-in so spawn is always on asphalt. */
export function resetRoad(seed = (Math.random() * 1e9) | 0) {
  rngSeed = seed >>> 0 || 1
  knots.length = 0
  // Dense straight knots around spawn; curves only begin well ahead (−Z).
  knots.push(
    { z: 400, x: 0 },
    { z: 200, x: 0 },
    { z: 80, x: 0 },
    { z: 0, x: 0 },
    { z: -120, x: 0 },
    { z: -260, x: 0 },
    { z: -400, x: 0 },
  )
}

function extendAhead(untilZ: number) {
  if (knots.length === 0) resetRoad()
  while (knots[knots.length - 1].z > untilZ) {
    const last = knots[knots.length - 1]
    const prev = knots[knots.length - 2]
    const prevBend = last.x - prev.x
    if (rand() < .32) {
      knots.push({
        z: last.z - (100 + rand() * 140),
        x: last.x + (rand() - .5) * 10,
      })
      continue
    }
    const len = 75 + rand() * 100
    const prefer = prevBend === 0 ? (rand() < .5 ? -1 : 1) : -Math.sign(prevBend)
    const side = rand() < .72 ? prefer : -prefer
    const bend = side * (32 + rand() * 55)
    knots.push({ z: last.z - len, x: last.x + bend })
  }
}

/** Drop knots far behind the car only — never based on mesh look-ahead. */
function pruneBehind(playerZ: number) {
  while (knots.length > 8 && knots[3].z > playerZ + 280) knots.shift()
}

function ensureCoverage(z: number) {
  if (knots.length === 0) resetRoad()
  // Mesh samples behind and ahead of the car; cover both without pruning spawn.
  extendAhead(z - 900)
  if (knots[0].z < z + 200) {
    // Rare: player somehow behind the first knot — pad backward in a straight line.
    while (knots[0].z < z + 200) {
      knots.unshift({ z: knots[0].z + 120, x: knots[0].x })
    }
  }
}

function catmullX(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t, t3 = t2 * t
  return .5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
}

function segmentAt(z: number) {
  ensureCoverage(z)
  let i = 1
  while (i < knots.length - 2 && knots[i + 1].z > z) i++
  // Stay inside a real span — never clamp onto a far bent knot.
  if (z > knots[1].z) i = 1
  if (z < knots[knots.length - 2].z) i = knots.length - 3
  const a = knots[i - 1], b = knots[i], c = knots[i + 1], d = knots[i + 2] ?? c
  const span = b.z - c.z
  const t = span === 0 ? 0 : THREE.MathUtils.clamp((b.z - z) / span, 0, 1)
  return { a, b, c, d, t }
}

export function roadCenter(z: number) {
  const { a, b, c, d, t } = segmentAt(z)
  return catmullX(a.x, b.x, c.x, d.x, t)
}

/** Road facing angle: 0 = toward -Z (matches the car). */
export function roadHeading(z: number) {
  const eps = 1.2
  const dxdz = (roadCenter(z + eps) - roadCenter(z - eps)) / (2 * eps)
  return Math.atan2(dxdz, 1)
}

/** Signed distance from point to centerline along the road-right axis. */
export function roadLateral(x: number, z: number) {
  // On bends the closest path sample isn’t always the same world Z — probe neighbors.
  let best = 0
  let bestAbs = Infinity
  for (let i = -4; i <= 4; i++) {
    const cz = z + i * 2.5
    const cx = roadCenter(cz)
    const h = roadHeading(cz)
    const dx = x - cx
    const dz = z - cz
    const lat = dx * Math.cos(h) - dz * Math.sin(h)
    const abs = Math.abs(lat)
    if (abs < bestAbs) {
      bestAbs = abs
      best = lat
    }
  }
  return best
}

export function isOnAsphalt(x: number, z: number) {
  return Math.abs(roadLateral(x, z)) <= ROAD_HALF
}

/** World pose for a traffic lane offset (−12 / −4 / 4 / 12). */
export function lanePose(z: number, lane: number) {
  const heading = roadHeading(z)
  const cx = roadCenter(z)
  const rightX = Math.cos(heading)
  const rightZ = -Math.sin(heading)
  return { x: cx + lane * rightX, z: z + lane * rightZ, yaw: heading }
}

export function roadsidePose(z: number, side: number, distance: number) {
  return lanePose(z, side * distance)
}

/**
 * Keep a seeded path-Z inside a moving window around the player.
 * Recycles one object at a time (no floor-based mass teleport), so roadside
 * props stay planted until they fall behind, then wrap once far ahead.
 */
export function wrapAlongRoad(seedZ: number, focusZ: number, span: number, behind = 120) {
  if (!(span > 0)) return seedZ
  const origin = focusZ + behind - span
  let t = (seedZ - origin) % span
  if (t < 0) t += span
  return origin + t
}

/** Flat ribbon + edge lines covering [zBehind, zAhead] in world Z. */
export function buildRoadGeometry(zFocus: number, behind = 220, ahead = 780, step = 6) {
  ensureCoverage(zFocus)
  pruneBehind(zFocus)
  extendAhead(zFocus - ahead)
  const z0 = zFocus + behind
  const z1 = zFocus - ahead
  const points: { x: number; z: number; hx: number; hz: number }[] = []
  for (let z = z0; z >= z1; z -= step) {
    const heading = roadHeading(z)
    points.push({
      x: roadCenter(z),
      z,
      hx: Math.cos(heading),
      hz: -Math.sin(heading),
    })
  }
  const half = ROAD_HALF
  const pos: number[] = []
  const nrm: number[] = []
  const uv: number[] = []
  const idx: number[] = []
  const dashPos: number[] = []

  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    const leftX = p.x - half * p.hx
    const leftZ = p.z - half * p.hz
    const rightX = p.x + half * p.hx
    const rightZ = p.z + half * p.hz
    pos.push(leftX, 0, leftZ, rightX, 0, rightZ)
    nrm.push(0, 1, 0, 0, 1, 0)
    const v = i / Math.max(1, points.length - 1)
    uv.push(0, v * 40, 1, v * 40)
    if (i > 0) {
      const a = (i - 1) * 2, b = a + 1, c = i * 2, d = c + 1
      idx.push(a, b, c, b, d, c)
    }
    if (i % 2 === 0 && i + 1 < points.length) {
      const q = points[i + 1]
      for (const lane of LANE_MARKS) {
        const ax = p.x + lane * p.hx, az = p.z + lane * p.hz
        const bx = q.x + lane * q.hx, bz = q.z + lane * q.hz
        const mx = (ax + bx) * .5, mz = (az + bz) * .5
        const dx = bx - ax, dz = bz - az
        const len = Math.hypot(dx, dz) || 1
        const px = (-dz / len) * .06, pz = (dx / len) * .06
        const hx = (dx / len) * 1.7, hz = (dz / len) * 1.7
        dashPos.push(
          mx - hx - px, .015, mz - hz - pz,
          mx - hx + px, .015, mz - hz + pz,
          mx + hx - px, .015, mz + hz - pz,
          mx - hx + px, .015, mz - hz + pz,
          mx + hx + px, .015, mz + hz + pz,
          mx + hx - px, .015, mz + hz - pz,
        )
      }
    }
  }

  const asphalt = new THREE.BufferGeometry()
  asphalt.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  asphalt.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  asphalt.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  asphalt.setIndex(idx)
  asphalt.computeBoundingSphere()

  const edges = new THREE.BufferGeometry()
  const ePos: number[] = []
  const eIdx: number[] = []
  const samples = points.length
  for (let side = 0; side < 2; side++) {
    const base = side * samples
    for (let i = 0; i < samples; i++) {
      const p = points[i]
      const s = side === 0 ? -1 : 1
      const ex = p.x + s * (half - .06) * p.hx
      const ez = p.z + s * (half - .06) * p.hz
      ePos.push(ex - p.hx * .065, .014, ez - p.hz * .065)
      ePos.push(ex + p.hx * .065, .014, ez + p.hz * .065)
    }
    for (let i = 0; i < samples - 1; i++) {
      const a = (base + i) * 2, b = a + 1, c = (base + i + 1) * 2, d = c + 1
      eIdx.push(a, b, c, b, d, c)
    }
  }
  edges.setAttribute('position', new THREE.Float32BufferAttribute(ePos, 3))
  edges.setIndex(eIdx)
  edges.computeVertexNormals()

  const dashes = new THREE.BufferGeometry()
  dashes.setAttribute('position', new THREE.Float32BufferAttribute(dashPos, 3))
  dashes.computeVertexNormals()

  return { asphalt, edges, dashes }
}
