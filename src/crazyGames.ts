/** Thin CrazyGames HTML5 SDK v3 wrapper. Safe on non-CrazyGames hosts. */

export type CrazyEnvironment = 'local' | 'crazygames' | 'disabled'

type AdType = 'midgame' | 'rewarded'

type AdCallbacks = {
  adStarted?: () => void
  adFinished?: () => void
  adError?: (error: { code?: string; message?: string } | unknown) => void
}

type CrazySDK = {
  init: () => Promise<void>
  environment: CrazyEnvironment
  game: {
    loadingStart: () => void
    loadingStop: () => void
    gameplayStart: () => void
    gameplayStop: () => void
    happytime: () => void
  }
  ad: {
    requestAd: (type: AdType, callbacks?: AdCallbacks) => void
  }
}

declare global {
  interface Window {
    CrazyGames?: { SDK: CrazySDK }
  }
}

let usable = false
let gameplayActive = false
let loadingActive = false

function sdk(): CrazySDK | null {
  return window.CrazyGames?.SDK ?? null
}

function canCall() {
  return usable && Boolean(sdk())
}

function safe(label: string, fn: () => void) {
  if (!canCall()) return
  try {
    fn()
  } catch (error) {
    console.warn(`[CrazyGames] ${label}`, error)
  }
}

/** Init once on the loading screen. Returns true when local/crazygames. */
export async function initCrazyGames(): Promise<boolean> {
  const api = sdk()
  if (!api) {
    usable = false
    return false
  }
  try {
    await api.init()
    const env = api.environment
    usable = env === 'local' || env === 'crazygames'
    if (!usable) {
      console.info(`[CrazyGames] environment=${env}; SDK calls skipped`)
    }
    return usable
  } catch (error) {
    usable = false
    console.warn('[CrazyGames] init failed', error)
    return false
  }
}

export function getCrazyEnvironment(): CrazyEnvironment | null {
  if (!sdk()) return null
  try {
    return sdk()!.environment
  } catch {
    return null
  }
}

export function isCrazyGamesReady() {
  return usable
}

export function loadingStart() {
  if (loadingActive) return
  safe('loadingStart', () => {
    sdk()!.game.loadingStart()
    loadingActive = true
  })
}

export function loadingStop() {
  if (!loadingActive) return
  safe('loadingStop', () => {
    sdk()!.game.loadingStop()
    loadingActive = false
  })
}

export function gameplayStart() {
  if (gameplayActive) return
  safe('gameplayStart', () => {
    sdk()!.game.gameplayStart()
    gameplayActive = true
  })
}

export function gameplayStop() {
  if (!gameplayActive) return
  safe('gameplayStop', () => {
    sdk()!.game.gameplayStop()
    gameplayActive = false
  })
}

export function happytime() {
  safe('happytime', () => sdk()!.game.happytime())
}

/**
 * Midgame / rewarded break. Resolves true if an ad finished.
 * Mute/pause only in adStarted — requests can fail without showing anything.
 */
export function requestAd(
  type: AdType,
  hooks: { onStart?: () => void; onEnd?: () => void } = {},
): Promise<boolean> {
  return new Promise(resolve => {
    if (!canCall()) {
      resolve(false)
      return
    }
    let started = false
    try {
      sdk()!.ad.requestAd(type, {
        adStarted: () => {
          started = true
          hooks.onStart?.()
        },
        adFinished: () => {
          hooks.onEnd?.()
          resolve(true)
        },
        adError: () => {
          if (started) hooks.onEnd?.()
          resolve(false)
        },
      })
    } catch (error) {
      console.warn('[CrazyGames] requestAd', error)
      if (started) hooks.onEnd?.()
      resolve(false)
    }
  })
}

export function requestMidgameAd(hooks?: { onStart?: () => void; onEnd?: () => void }) {
  return requestAd('midgame', hooks)
}
