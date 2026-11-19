/** UI ↔ scene bridge kept free of Three.js so the intro can load without WebGL. */

export type Stats = {
  speed: number
  score: number
  combo: number
  drift: boolean
  offroad: boolean
  distance: number
  grace: number
  crashed: boolean
  longestCombo: number
  nearMisses: number
  event: string
}

export const initialStats: Stats = {
  speed: 0, score: 0, combo: 1, drift: false, offroad: false,
  distance: 0, grace: 0, crashed: false, longestCombo: 1, nearMisses: 0, event: '',
}

/** Shared key set — App writes, World reads. */
export const keys = new Set<string>()

/** Analog steer from touch wheel / gyro: +1 left … −1 right (matches A − D). */
export const steerAxis = { value: 0 }

export function clearInputs() {
  keys.clear()
  steerAxis.value = 0
}

export type GraphicsQuality = {
  dpr: [number, number]
  shadows: boolean
  shadowMap: number
  sky: boolean
  antialias: boolean
  sandSize: number
}

/** Touch / phone play surface — hide keyboard chrome and show on-screen controls. */
export function detectTouchPlay(): boolean {
  if (typeof window === 'undefined') return false
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const noHover = window.matchMedia('(hover: none)').matches
  const manyTouches = (navigator.maxTouchPoints ?? 0) > 1
  return coarse || (noHover && manyTouches)
}

export function detectGraphicsQuality(): GraphicsQuality {
  if (typeof window === 'undefined') {
    return { dpr: [1, 1.5], shadows: true, shadowMap: 1024, sky: true, antialias: true, sandSize: 1400 }
  }
  const coarse = window.matchMedia('(pointer: coarse)').matches
  const narrow = window.matchMedia('(max-width: 760px)').matches
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection
  const saveData = Boolean(connection?.saveData)
  const slowNet = connection?.effectiveType === '2g' || connection?.effectiveType === 'slow-2g'
  const lowCores = (navigator.hardwareConcurrency ?? 8) <= 4
  const low = coarse || narrow || saveData || slowNet || lowCores
  if (low) {
    return { dpr: [1, 1.15], shadows: false, shadowMap: 512, sky: false, antialias: false, sandSize: 900 }
  }
  return { dpr: [1, 1.5], shadows: true, shadowMap: 1024, sky: true, antialias: true, sandSize: 1400 }
}
