import type { DrivingState } from './driving'
import { LANE_X, lanePose, isOnAsphalt } from './road'
export const CHAIN_WINDOW = 1.15
/** Seconds of solid slide per multiplier tier. ×5 needs a long linked run. */
export const COMBO_TIER_TIME = 4.5
export type TrafficCar = { pathZ: number; x: number; z: number; speed: number; lane: number; passed: boolean }
export type RunState = {
  score: number; combo: number; longestCombo: number; slide: number; grace: number
  direction: number; distance: number; elapsed: number; crashed: boolean
  event: string; eventTime: number; nearMisses: number
}
export const newRun = (): RunState => ({
  score: 0, combo: 1, longestCombo: 1, slide: 0, grace: 0, direction: 0,
  distance: 0, elapsed: 0, crashed: false, event: '', eventTime: 0, nearMisses: 0,
})
export function resetChain(s: RunState) {
  s.combo = 1; s.slide = 0; s.grace = 0; s.direction = 0
}
export function announce(s: RunState, text: string) { s.event = text; s.eventTime = 1.6 }
export function endRun(s: RunState, reason: string) {
  if (s.crashed) return
  s.crashed = true
  resetChain(s)
  announce(s, reason)
}
export function stepScore(s: RunState, dt: number, speed: number, slip: number, onRoad: boolean) {
  if (s.crashed) return false
  s.elapsed += dt
  s.eventTime = Math.max(0, s.eventTime - dt)
  const angle = Math.abs(slip)
  // No upper angle cap — deep slides and full 360s stay in the chain.
  const drift = onRoad && speed > 10 && angle > .2
  if (!onRoad) {
    endRun(s, 'offroad')
    return false
  }
  if (drift) {
    // atan2 wraps at ±π during a continuous 360 — keep the previous sign so a
    // single spin doesn't read as a direction change / sideways "link" yank.
    let direction = Math.sign(slip)
    if (Math.abs(slip) > 2.0 && s.direction !== 0) direction = s.direction
    if (s.direction !== 0 && direction !== s.direction && s.grace > 0) {
      s.score += 250 * s.combo
      // Links are the main way to climb — small time bump, not a free tier.
      s.slide += .4
      announce(s, `linked_drift:${250 * s.combo}`)
    }
    s.direction = direction === 0 ? s.direction : direction
    s.grace = CHAIN_WINDOW
    // Weak angles barely feed the meter; commit to the slide for higher ×.
    const quality = angle < .32 ? .35 : angle < .5 ? .7 : 1
    s.slide += dt * quality
    s.combo = Math.min(5, 1 + Math.floor(s.slide / COMBO_TIER_TIME))
    s.longestCombo = Math.max(s.longestCombo, s.combo)
    s.score += dt * speed * angle * s.combo * 8
  } else if (s.grace > 0) {
    s.grace = Math.max(0, s.grace - dt)
    // Chain expiry only resets the multiplier — crash / leave asphalt still end the run.
    if (s.grace === 0) {
      resetChain(s)
      announce(s, 'chain_broken')
    }
  }
  return drift
}
export const TRAFFIC_BASE = 8
export const TRAFFIC_MAX = 18

/** More cars on the road as the run score climbs. */
export function trafficCountForScore(score: number) {
  return Math.min(TRAFFIC_MAX, TRAFFIC_BASE + Math.floor(Math.max(0, score) / 2000))
}

/** Gap shrinks with distance and score so high scores feel busier. */
export function trafficGap(distance: number, score = 0) {
  const scoreTighten = Math.min(32, score / 350)
  return Math.max(28, 85 - distance / 180 - scoreTighten)
}

// Cars pick any of the four lanes and never change lanes mid-row.
export function spawnTraffic(
  index: number,
  playerZ: number,
  distance: number,
  random: () => number = Math.random,
  score = 0,
): TrafficCar {
  const gap = trafficGap(distance, score)
  const lane = LANE_X[Math.floor(random() * LANE_X.length)]
  const pathZ = playerZ - 140 - index * gap
  const pose = lanePose(pathZ, lane)
  return { pathZ, x: pose.x, z: pose.z, lane, speed: 13 + random() * 10, passed: false }
}
export type LeaderboardEntry = { id: string; score: number; distance: number; combo: number; nearMisses: number; date: string }
export const LEADERBOARD_KEY = 'tafheet-local-runs-v1'
export function readLeaderboard(): LeaderboardEntry[] {
  try {
    const rows: unknown = JSON.parse(localStorage.getItem(LEADERBOARD_KEY) || '[]')
    if (!Array.isArray(rows)) return []
    return rows.filter((r): r is LeaderboardEntry => r && typeof r.id === 'string' && typeof r.date === 'string' &&
      [r.score, r.distance, r.combo, r.nearMisses].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0))
      .sort((a, b) => b.score - a.score || b.distance - a.distance).slice(0, 10)
  } catch { return [] }
}
export function rankRun(rows: LeaderboardEntry[], entry: LeaderboardEntry) {
  return [...rows.filter(r => r.id !== entry.id), entry].sort((a, b) => b.score - a.score || b.distance - a.distance).slice(0, 10)
}

export function overlapsTraffic(x: number, z: number, yaw: number, car: TrafficCar) {
  const dx = car.x - x, dz = car.z - z
  const c = Math.cos(yaw), sn = Math.sin(yaw)
  // Separating-axis test for the rotated player and an axis-aligned traffic car.
  return Math.abs(dx) < .95 + .95 * Math.abs(c) + 2.35 * Math.abs(sn) &&
    Math.abs(dz) < 2.35 + .95 * Math.abs(sn) + 2.35 * Math.abs(c) &&
    Math.abs(dx * c - dz * sn) < .95 + .95 * Math.abs(c) + 2.35 * Math.abs(sn) &&
    Math.abs(dx * sn + dz * c) < 2.35 + .95 * Math.abs(sn) + 2.35 * Math.abs(c)
}

/** Reused each frame so stepTraffic does not allocate a sorted copy. */
const trafficOrder: TrafficCar[] = []

export function stepTraffic(s: RunState & DrivingState, traffic: TrafficCar[], dt: number, drifting: boolean) {
  if (s.crashed) return false
  const drift = drifting
  const onAsphalt = isOnAsphalt(s.x, s.z)
  // Keep rows separated even when a faster car catches a slower one.
  trafficOrder.length = 0
  for (let i = 0; i < traffic.length; i++) trafficOrder.push(traffic[i])
  trafficOrder.sort((a, b) => a.pathZ - b.pathZ)
  for (let i = 1; i < trafficOrder.length; i++) {
    if (trafficOrder[i].pathZ - trafficOrder[i - 1].pathZ < 40) {
      trafficOrder[i].speed = Math.min(trafficOrder[i].speed, trafficOrder[i - 1].speed)
    }
  }
  for (const other of traffic) {
    other.pathZ -= other.speed * dt
    const pose = lanePose(other.pathZ, other.lane)
    other.x = pose.x
    other.z = pose.z
    if (overlapsTraffic(s.x, s.z, s.yaw, other)) {
      other.passed = true
      s.forward *= .08; s.lateral *= .4; s.yawRate *= .4
      s.speed = Math.hypot(s.forward, s.lateral)
      endRun(s, 'traffic_crash')
      return false
    }
    const relativeZ = other.pathZ - s.z
    // Award once after fully clearing the car, never for a scrape.
    if (!other.passed && relativeZ > 5) {
      other.passed = true
      const gap = Math.abs(other.x - s.x)
      if (s.speed > other.speed + 5 && gap > 1.9 && gap < 4.5 && onAsphalt) {
        const points = (drift ? 600 : 200) * s.combo
        s.score += points; s.nearMisses++
        announce(s, `${drift ? 'side_pass' : 'near_miss'}:${points}`)
      }
    }
    if (relativeZ > 65 || relativeZ < -1100) {
      const ahead = Math.min(s.z - 140, ...traffic.filter(t => t !== other).map(t => t.pathZ))
      Object.assign(other, spawnTraffic(1, ahead + 140, s.distance, Math.random, s.score))
    }
  }
  return drift
}

export const MASCOT_COUNT = 6
export const MASCOT_POINTS = 500
export const MASCOT_EXPLODE = .7
export type RoadMascot = {
  pathZ: number; x: number; z: number; lane: number
  phase: 'idle' | 'explode'; phaseT: number
}

export function spawnMascot(
  index: number,
  playerZ: number,
  random: () => number = Math.random,
): RoadMascot {
  const gap = 90 + random() * 35
  const lane = LANE_X[Math.floor(random() * LANE_X.length)]
  // Sit further out than the first traffic row so they read as road pickups.
  const pathZ = playerZ - 210 - index * gap
  const pose = lanePose(pathZ, lane)
  return { pathZ, x: pose.x, z: pose.z, lane, phase: 'idle', phaseT: 0 }
}

export function overlapsMascot(x: number, z: number, mascot: RoadMascot) {
  const dx = mascot.x - x
  const dz = mascot.z - z
  return dx * dx + dz * dz < 3.4 * 3.4
}

/** Planted chicken pickups — hit for points and an explode burst (does not end the run). */
export function stepMascots(s: RunState & DrivingState, mascots: RoadMascot[], dt: number) {
  if (s.crashed) return
  for (const bird of mascots) {
    if (bird.phase === 'explode') {
      bird.phaseT += dt
      if (bird.phaseT >= MASCOT_EXPLODE) {
        const ahead = Math.min(
          s.z - 210,
          ...mascots.filter(m => m !== bird).map(m => m.pathZ),
        )
        Object.assign(bird, spawnMascot(1, ahead + 210))
      }
      continue
    }
    const pose = lanePose(bird.pathZ, bird.lane)
    bird.x = pose.x
    bird.z = pose.z
    if (overlapsMascot(s.x, s.z, bird)) {
      const points = MASCOT_POINTS * s.combo
      s.score += points
      announce(s, `chicken:${points}`)
      bird.phase = 'explode'
      bird.phaseT = 0
      continue
    }
    const relativeZ = bird.pathZ - s.z
    if (relativeZ > 45 || relativeZ < -950) {
      const ahead = Math.min(
        s.z - 210,
        ...mascots.filter(m => m !== bird).map(m => m.pathZ),
      )
      Object.assign(bird, spawnMascot(1, ahead + 210))
    }
  }
}
