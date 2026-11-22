/** Playable cars + unlock thresholds (personal best score). */

import { publicUrl } from './bootAssets'

export type CarId =
  | 'tuktuk'
  | 'tray'
  | 'coupe_spirit'
  | 'street_racer'
  | 'night_spec'
  | 'neon_runner'
  | 'gt_wedge'
  | 'classic_wedge'

/** Legacy ids → current ids (localStorage / older builds). */
const LEGACY_CAR_IDS: Record<string, CarId> = {
  rx7: 'coupe_spirit',
  bmw_m3_gtr: 'street_racer',
  r34_vspec: 'night_spec',
  r34_brian: 'neon_runner',
  mclaren: 'gt_wedge',
  countach: 'classic_wedge',
}

export type CarDef = {
  id: CarId
  /** GLB under public/ (or legacy tray car). */
  url: string
  /** Best-score required to unlock. 0 = starter. */
  unlockScore: number
  /** Higher = later unlock / “better” car. */
  tier: number
  /** Rough handling flavor multipliers. */
  accel: number
  grip: number
  topSpeed: number
}

/** Starter → hardest. Better cars need a higher personal best. */
export const CARS: CarDef[] = [
  {
    id: 'tuktuk',
    url: publicUrl('cars/tuktuk.glb?v=wheels1'),
    unlockScore: 0,
    tier: 0,
    accel: 0.85,
    grip: 0.9,
    topSpeed: 0.75,
  },
  {
    id: 'tray',
    url: publicUrl('tray_runner.glb?v=debrand3'),
    unlockScore: 0,
    tier: 1,
    accel: 1,
    grip: 1,
    topSpeed: 1,
  },
  {
    id: 'coupe_spirit',
    url: publicUrl('cars/coupe_spirit.glb?v=cabin3'),
    unlockScore: 8_000,
    tier: 2,
    accel: 1.08,
    grip: 1.05,
    topSpeed: 1.08,
  },
  {
    id: 'street_racer',
    url: publicUrl('cars/street_racer.glb?v=wheels1'),
    unlockScore: 20_000,
    tier: 3,
    accel: 1.12,
    grip: 1.1,
    topSpeed: 1.12,
  },
  {
    id: 'night_spec',
    url: publicUrl('cars/night_spec.glb?v=paint2'),
    unlockScore: 40_000,
    tier: 4,
    accel: 1.18,
    grip: 1.12,
    topSpeed: 1.18,
  },
  {
    id: 'neon_runner',
    url: publicUrl('cars/neon_runner.glb?v=paint2'),
    unlockScore: 75_000,
    tier: 5,
    accel: 1.22,
    grip: 1.15,
    topSpeed: 1.22,
  },
  {
    id: 'gt_wedge',
    url: publicUrl('cars/gt_wedge.glb?v=wheels1'),
    unlockScore: 120_000,
    tier: 6,
    accel: 1.3,
    grip: 1.2,
    topSpeed: 1.32,
  },
  {
    id: 'classic_wedge',
    url: publicUrl('cars/classic_wedge.glb?v=paint2'),
    unlockScore: 200_000,
    tier: 7,
    accel: 1.35,
    grip: 1.18,
    topSpeed: 1.4,
  },
]

/**
 * Traffic variety — loaded only after Start so menu/boot stay under the
 * CrazyGames mobile homepage initial-download budget.
 */
export const TRAFFIC_URLS: string[] = [
  CARS.find(c => c.id === 'tray')!.url,
  CARS.find(c => c.id === 'tuktuk')!.url,
  CARS.find(c => c.id === 'coupe_spirit')!.url,
  CARS.find(c => c.id === 'night_spec')!.url,
  CARS.find(c => c.id === 'classic_wedge')!.url,
]

export const CAR_KEY = 'tafheet-car-v1'

export function resolveCarId(id: string | null | undefined): CarId | null {
  if (!id) return null
  if (CARS.some(c => c.id === id)) return id as CarId
  return LEGACY_CAR_IDS[id] ?? null
}

export function carById(id: string | null | undefined): CarDef {
  return CARS.find(c => c.id === resolveCarId(id)) ?? CARS[1]
}

/** Vite `npm run dev` unlocks the full roster for testing. */
export const DEV_UNLOCK_ALL = import.meta.env.DEV

export function isCarUnlocked(car: CarDef, bestScore: number) {
  if (DEV_UNLOCK_ALL) return true
  return bestScore >= car.unlockScore
}

export function readSelectedCarId(): CarId {
  try {
    const stored = localStorage.getItem(CAR_KEY)
    const resolved = resolveCarId(stored)
    if (resolved) {
      if (stored !== resolved) writeSelectedCarId(resolved)
      return resolved
    }
  } catch { /* ignore */ }
  return 'tray'
}

export function writeSelectedCarId(id: CarId) {
  try { localStorage.setItem(CAR_KEY, id) } catch { /* session still works */ }
}
