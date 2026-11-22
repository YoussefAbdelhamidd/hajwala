/** Thin CrazyGames HTML5 SDK v3 wrapper. Safe offline / file:// / non-CG hosts. */

export type CrazyEnvironment = 'local' | 'crazygames' | 'disabled'

type AdType = 'midgame' | 'rewarded'

type AdCallbacks = {
  adStarted?: () => void
  adFinished?: () => void
  adError?: (error: { code?: string; message?: string } | unknown) => void
}

export type CrazyDeviceType = 'desktop' | 'tablet' | 'mobile'

type CrazySystemInfo = {
  locale?: string
  device?: { type?: CrazyDeviceType | string }
}

type CrazySDK = {
  init: () => Promise<void>
  environment: CrazyEnvironment
  user?: {
    systemInfo?: CrazySystemInfo
  }
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

const SDK_SRC = 'https://sdk.crazygames.com/crazygames-sdk-v3.js'

let usable = false
let gameplayActive = false
let loadingActive = false
let loadPromise: Promise<boolean> | null = null

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

function loadSdkScript(): Promise<boolean> {
  if (sdk()) return Promise.resolve(true)
  if (loadPromise) return loadPromise

  loadPromise = new Promise(resolve => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SDK_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(Boolean(sdk())))
      existing.addEventListener('error', () => resolve(false))
      // Already loaded
      if (sdk()) resolve(true)
      window.setTimeout(() => resolve(Boolean(sdk())), 2500)
      return
    }

    const script = document.createElement('script')
    script.src = SDK_SRC
    script.async = true
    script.onload = () => resolve(Boolean(sdk()))
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
    window.setTimeout(() => resolve(Boolean(sdk())), 2500)
  })

  return loadPromise
}

/** Init once on the loading screen. Returns true when local/crazygames. */
export async function initCrazyGames(): Promise<boolean> {
  const ready = await loadSdkScript()
  const api = sdk()
  if (!ready || !api) {
    usable = false
    return false
  }
  try {
    await Promise.race([
      api.init(),
      new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error('CrazyGames init timeout')), 2500)
      }),
    ])
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

/** Prefer SDK device type over touch heuristics (CrazyGames technical requirements). */
export function getCrazyDeviceType(): CrazyDeviceType | null {
  if (!canCall()) return null
  try {
    const type = sdk()?.user?.systemInfo?.device?.type
    if (type === 'desktop' || type === 'tablet' || type === 'mobile') return type
    return null
  } catch {
    return null
  }
}

/**
 * Portal language from SDK `systemInfo.locale` (e.g. en_US, ar_SA).
 * CrazyGames wants games with translations to follow this, then fall back to English.
 */
export function getCrazyLocale(): string | null {
  if (!canCall()) return null
  try {
    const locale = sdk()?.user?.systemInfo?.locale
    return typeof locale === 'string' && locale.trim() ? locale.trim() : null
  } catch {
    return null
  }
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
