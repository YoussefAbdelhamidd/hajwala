import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import { preloadBootAssets } from './bootAssets'
import type { BootLabelKey } from './bootAssets'
import {
  gameplayStart,
  gameplayStop,
  getCrazyDeviceType,
  getCrazyLocale,
  happytime,
  initCrazyGames,
  loadingStart,
  loadingStop,
  requestMidgameAd,
} from './crazyGames'
import { CHAIN_WINDOW, readLeaderboard, rankRun, LEADERBOARD_KEY } from './gameplay'
import type { LeaderboardEntry } from './gameplay'
import {
  clearInputs,
  detectGraphicsQuality,
  detectTouchPlay,
  detectTouchPlayFromDevice,
  initialStats,
  keys,
  steerAxis,
} from './gameUi'
import type { Stats } from './gameUi'
import { useI18n, type MessageKey } from './i18n'
import {
  CARS,
  carById,
  DEV_UNLOCK_ALL,
  isCarUnlocked,
  readSelectedCarId,
  writeSelectedCarId,
  type CarId,
} from './cars'

const GameScene = lazy(() => import('./GameScene'))
const GaragePreview = lazy(() => import('./GaragePreview'))

/** Visual + input lock: this many degrees of wheel twist = full steer. */
const STEER_LOCK_DEG = 140
const STEER_LOCK_RAD = (STEER_LOCK_DEG * Math.PI) / 180
/** Ignore twist samples too close to the hub (atan2 goes wild there). */
const STEER_HUB_RATIO = 0.18
/** Degrees of device tilt past the deadzone that map to full analog steer. */
const GYRO_FULL_DEG = 28
const GYRO_DEADZONE_DEG = 2.5
const GYRO_SMOOTH = 0.28
/** Motion gravity → degrees scale (used only as units; calibration zeros the rest). */
const GYRO_MOTION_RAD2DEG = 180 / Math.PI
const COACH_KEY = 'tafheet-coach-seen-v1'
const STEER_MODE_KEY = 'tafheet-steer-mode'

type SteerMode = 'wheel' | 'buttons' | 'gyro'
type GyroPermission = 'granted' | 'denied' | 'unsupported'
type MotionPermissionEvent = {
  requestPermission?: () => Promise<'granted' | 'denied'>
}

function readCoachSeen() {
  try { return localStorage.getItem(COACH_KEY) === '1' } catch { return false }
}

function readSteerMode(): SteerMode {
  try {
    const stored = localStorage.getItem(STEER_MODE_KEY)
    if (stored === 'buttons' || stored === 'gyro' || stored === 'wheel') return stored
    return 'wheel'
  } catch {
    return 'wheel'
  }
}

function hasMotionSensors() {
  return typeof window !== 'undefined' && ('DeviceOrientationEvent' in window || 'DeviceMotionEvent' in window)
}

/** Only Safari on iOS/iPadOS needs a real permission prompt. OEM stubs (Huawei etc.) must be ignored. */
function isAppleMotionPermissionPlatform() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS desktop-class UA
  return navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1
}

function needsGyroPermissionPrompt() {
  if (!isAppleMotionPermissionPlatform()) return false
  const DOE = DeviceOrientationEvent as unknown as MotionPermissionEvent | undefined
  const DME = typeof DeviceMotionEvent !== 'undefined'
    ? (DeviceMotionEvent as unknown as MotionPermissionEvent)
    : undefined
  return typeof DOE?.requestPermission === 'function' || typeof DME?.requestPermission === 'function'
}

function screenOrientationAngle() {
  const fromApi = screen.orientation?.angle
  if (typeof fromApi === 'number') return ((fromApi % 360) + 360) % 360
  const legacy = (window as Window & { orientation?: number }).orientation
  if (typeof legacy === 'number') return ((legacy % 360) + 360) % 360
  return 0
}

/** Map device roll onto screen left/right tilt in degrees (negative = lean left). */
function tiltFromOrientation(e: DeviceOrientationEvent): number | null {
  if (e.beta == null || e.gamma == null) return null
  const angle = screenOrientationAngle()
  if (angle >= 45 && angle < 135) return e.beta
  if (angle >= 225 && angle < 315) return -e.beta
  if (angle >= 135 && angle < 225) return -e.gamma
  return e.gamma
}

/**
 * Fallback for OEMs (incl. many Huawei builds) that never deliver orientation
 * angles but do deliver accelerationIncludingGravity.
 */
function tiltFromMotion(e: DeviceMotionEvent): number | null {
  const a = e.accelerationIncludingGravity
  if (!a || a.x == null || a.y == null) return null
  const angle = screenOrientationAngle()
  const { x, y } = a
  let rad: number
  if (angle >= 45 && angle < 135) rad = Math.atan2(-y, -x)
  else if (angle >= 225 && angle < 315) rad = Math.atan2(y, x)
  else if (angle >= 135 && angle < 225) rad = Math.atan2(-x, y)
  else rad = Math.atan2(x, y)
  return rad * GYRO_MOTION_RAD2DEG
}

/** +1 left … −1 right, matching keyboard A − D and the touch wheel. */
function steerFromTilt(tiltDeg: number, centerDeg: number) {
  const delta = tiltDeg - centerDeg
  const excess = Math.max(0, Math.abs(delta) - GYRO_DEADZONE_DEG)
  if (excess === 0) return 0
  return Math.max(-1, Math.min(1, (-Math.sign(delta) * excess) / GYRO_FULL_DEG))
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    const id = window.setTimeout(() => resolve(fallback), ms)
    promise.then(
      value => { window.clearTimeout(id); resolve(value) },
      () => { window.clearTimeout(id); resolve(fallback) },
    )
  })
}

/** Survives remounts so the in-run panel can skip a second iOS prompt. */
let gyroPermissionGranted = false

async function requestGyroPermission(): Promise<GyroPermission> {
  if (!hasMotionSensors()) return 'unsupported'
  // Android / Huawei / Chrome: never call stub requestPermission — it denies or hangs.
  if (!needsGyroPermissionPrompt()) {
    gyroPermissionGranted = true
    return 'granted'
  }

  try {
    const DOE = DeviceOrientationEvent as unknown as MotionPermissionEvent
    const DME = typeof DeviceMotionEvent !== 'undefined'
      ? (DeviceMotionEvent as unknown as MotionPermissionEvent)
      : undefined

    const tasks: Promise<'granted' | 'denied'>[] = []
    if (typeof DOE.requestPermission === 'function') {
      tasks.push(withTimeout(DOE.requestPermission(), 2500, 'denied'))
    }
    if (typeof DME?.requestPermission === 'function') {
      tasks.push(withTimeout(DME.requestPermission(), 2500, 'denied'))
    }

    if (tasks.length === 0) {
      gyroPermissionGranted = true
      return 'granted'
    }

    const results = await Promise.all(tasks)
    const ok = results.some(result => result === 'granted')
    gyroPermissionGranted = ok
    return ok ? 'granted' : 'denied'
  } catch {
    // Treat broken permission APIs as granted and let sensor listeners decide.
    gyroPermissionGranted = true
    return 'granted'
  }
}

function unwrapDelta(from: number, to: number) {
  let d = to - from
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function TouchSteeringWheel() {
  const { t } = useI18n()
  const padRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<HTMLSpanElement>(null)
  const [held, setHeld] = useState(false)
  const [ariaSteer, setAriaSteer] = useState(0)
  const drag = useRef<{
    pointerId: number
    grabAngle: number | null
    baseSteer: number
  } | null>(null)

  const fingerPolar = (clientX: number, clientY: number) => {
    const el = padRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const cx = r.left + r.width * 0.5
    const cy = r.top + r.height * 0.5
    const dx = clientX - cx
    const dy = clientY - cy
    return {
      angle: Math.atan2(dy, dx),
      radius: Math.hypot(dx, dy),
      minRadius: Math.min(r.width, r.height) * 0.5 * STEER_HUB_RATIO,
    }
  }

  const applySteer = (value: number) => {
    const next = Math.max(-1, Math.min(1, value))
    steerAxis.value = next
    // +steer = left = counter-clockwise visually (negative CSS rotate).
    if (artRef.current) artRef.current.style.transform = `rotate(${-next * STEER_LOCK_DEG}deg)`
    setAriaSteer(next)
  }

  const release = (pointerId?: number) => {
    if (pointerId != null && drag.current?.pointerId !== pointerId) return
    drag.current = null
    setHeld(false)
    applySteer(0)
  }

  return (
    <div
      ref={padRef}
      className={`touch-steer-pad${held ? ' is-held' : ''}`}
      role="slider"
      aria-label={t('touch.wheel')}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(ariaSteer * 100)}
      aria-valuetext={
        ariaSteer === 0
          ? t('touch.straight')
          : ariaSteer > 0
            ? t('touch.leftPct', { n: Math.round(ariaSteer * 100) })
            : t('touch.rightPct', { n: Math.round(-ariaSteer * 100) })
      }
      onContextMenu={e => e.preventDefault()}
      onPointerDown={e => {
        e.preventDefault()
        const polar = fingerPolar(e.clientX, e.clientY)
        if (!polar) return
        e.currentTarget.setPointerCapture(e.pointerId)
        // Only lock the grab angle once the finger is on the rim — hub is unstable.
        drag.current = {
          pointerId: e.pointerId,
          grabAngle: polar.radius >= polar.minRadius ? polar.angle : null,
          baseSteer: steerAxis.value,
        }
        setHeld(true)
      }}
      onPointerMove={e => {
        const state = drag.current
        if (!state || state.pointerId !== e.pointerId) return
        const polar = fingerPolar(e.clientX, e.clientY)
        if (!polar || polar.radius < polar.minRadius) return
        if (state.grabAngle == null) {
          state.grabAngle = polar.angle
          return
        }
        // Screen Y is down, so clockwise (right turn) raises atan2 — negate for −1 right.
        applySteer(state.baseSteer - unwrapDelta(state.grabAngle, polar.angle) / STEER_LOCK_RAD)
      }}
      onPointerUp={e => release(e.pointerId)}
      onPointerCancel={e => release(e.pointerId)}
      onLostPointerCapture={e => release(e.pointerId)}
    >
      <div className={`touch-wheel${held ? ' is-held' : ''}`}>
        <span ref={artRef} className="touch-wheel-art" aria-hidden="true" />
      </div>
    </div>
  )
}

function holdKeyHandlers(code: 'KeyA' | 'KeyD' | 'KeyQ') {
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault()
      e.currentTarget.setPointerCapture(e.pointerId)
      keys.add(code)
      steerAxis.value = 0
    },
    onPointerUp: () => keys.delete(code),
    onPointerCancel: () => keys.delete(code),
    onLostPointerCapture: () => keys.delete(code),
  }
}

function TouchSteerButtons() {
  const { t } = useI18n()
  return (
    <div className="touch-steer-buttons" role="group" aria-label={t('touch.steer')}>
      <button
        type="button"
        className="touch-btn touch-turn touch-turn-left"
        aria-label={t('touch.left')}
        onContextMenu={e => e.preventDefault()}
        {...holdKeyHandlers('KeyA')}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        className="touch-btn touch-turn touch-turn-right"
        aria-label={t('touch.right')}
        onContextMenu={e => e.preventDefault()}
        {...holdKeyHandlers('KeyD')}
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  )
}

function initialGyroStatus(): 'active' | 'denied' | 'unsupported' {
  if (!hasMotionSensors()) return 'unsupported'
  // Only Apple needs an explicit grant before listeners are useful.
  if (needsGyroPermissionPrompt() && !gyroPermissionGranted) return 'denied'
  return 'active'
}

function TouchGyroSteer() {
  const { t } = useI18n()
  const needleRef = useRef<HTMLSpanElement>(null)
  const centerRef = useRef<number | null>(null)
  const smoothRef = useRef(0)
  const gotOrientationRef = useRef(false)
  const [status, setStatus] = useState<'active' | 'denied' | 'unsupported'>(initialGyroStatus)
  const [busy, setBusy] = useState(false)
  const [ariaSteer, setAriaSteer] = useState(0)

  const applySteer = useCallback((value: number) => {
    const next = Math.max(-1, Math.min(1, value))
    steerAxis.value = next
    if (needleRef.current) needleRef.current.style.transform = `translateX(-50%) rotate(${-next * 55}deg)`
    setAriaSteer(next)
  }, [])

  const ingestTilt = useCallback((tilt: number) => {
    if (centerRef.current == null) centerRef.current = tilt
    const target = steerFromTilt(tilt, centerRef.current)
    smoothRef.current += (target - smoothRef.current) * GYRO_SMOOTH
    if (Math.abs(smoothRef.current) < 0.01 && Math.abs(target) < 0.01) smoothRef.current = 0
    applySteer(smoothRef.current)
  }, [applySteer])

  const calibrate = useCallback(() => {
    centerRef.current = null
    smoothRef.current = 0
    applySteer(0)
  }, [applySteer])

  const enable = useCallback(async () => {
    setBusy(true)
    try {
      const permission = await requestGyroPermission()
      // On non-Apple (and on broken stubs), always start listening after a tap —
      // some WebViews only unlock sensors after a gesture.
      if (permission === 'unsupported') {
        setStatus('unsupported')
        return
      }
      gyroPermissionGranted = true
      setStatus('active')
      calibrate()
    } finally {
      setBusy(false)
    }
  }, [calibrate])

  useEffect(() => {
    if (status !== 'active') {
      applySteer(0)
      return
    }

    gotOrientationRef.current = false

    const onOrient = (e: Event) => {
      const tilt = tiltFromOrientation(e as DeviceOrientationEvent)
      if (tilt == null) return
      gotOrientationRef.current = true
      ingestTilt(tilt)
    }

    const onMotion = (e: DeviceMotionEvent) => {
      // Prefer orientation angles when they work; many Huawei phones only get motion.
      if (gotOrientationRef.current) return
      const tilt = tiltFromMotion(e)
      if (tilt == null) return
      ingestTilt(tilt)
    }

    window.addEventListener('deviceorientation', onOrient)
    // Absolute variant used by some Android / OEM browsers.
    window.addEventListener('deviceorientationabsolute', onOrient)
    window.addEventListener('devicemotion', onMotion)

    return () => {
      window.removeEventListener('deviceorientation', onOrient)
      window.removeEventListener('deviceorientationabsolute', onOrient)
      window.removeEventListener('devicemotion', onMotion)
      applySteer(0)
    }
  }, [status, applySteer, ingestTilt])

  if (status === 'unsupported') {
    return (
      <div className="touch-gyro touch-gyro-msg" role="status">
        {t('touch.gyroUnsupported')}
      </div>
    )
  }

  if (status === 'denied') {
    return (
      <div className="touch-gyro">
        <button
          type="button"
          className="touch-btn touch-gyro-enable"
          disabled={busy}
          onClick={enable}
        >
          {busy ? t('touch.gyroEnabling') : t('touch.gyroEnable')}
        </button>
      </div>
    )
  }

  return (
    <div
      className="touch-gyro"
      role="slider"
      aria-label={t('touch.gyroLabel')}
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(ariaSteer * 100)}
      aria-valuetext={
        ariaSteer === 0
          ? t('touch.straight')
          : ariaSteer > 0
            ? t('touch.leftPct', { n: Math.round(ariaSteer * 100) })
            : t('touch.rightPct', { n: Math.round(-ariaSteer * 100) })
      }
    >
      <div className="touch-gyro-meter" aria-hidden="true">
        <i className="touch-gyro-track" />
        <span ref={needleRef} className="touch-gyro-needle" />
        <i className="touch-gyro-center" />
      </div>
      <button type="button" className="touch-btn touch-gyro-cal" onClick={calibrate} aria-label={t('touch.calibrateAria')}>
        {t('touch.calibrate')}
      </button>
      <span className="touch-gyro-hint">{t('touch.tiltHint')}</span>
    </div>
  )
}

function SteerModePicker({
  value,
  onChange,
}: {
  value: SteerMode
  onChange: (mode: SteerMode) => void
}) {
  const { t } = useI18n()
  return (
    <div className="steer-mode" role="group" aria-label={t('steer.group')}>
      <span className="steer-mode-label">{t('steer.label')}</span>
      <div className="steer-mode-options">
        <button
          type="button"
          className={`steer-mode-option${value === 'wheel' ? ' is-on' : ''}`}
          aria-pressed={value === 'wheel'}
          onClick={() => onChange('wheel')}
        >
          {t('steer.wheel')}
        </button>
        <button
          type="button"
          className={`steer-mode-option${value === 'buttons' ? ' is-on' : ''}`}
          aria-pressed={value === 'buttons'}
          onClick={() => onChange('buttons')}
        >
          {t('steer.buttons')}
        </button>
        <button
          type="button"
          className={`steer-mode-option${value === 'gyro' ? ' is-on' : ''}`}
          aria-pressed={value === 'gyro'}
          onClick={() => onChange('gyro')}
        >
          {t('steer.gyro')}
        </button>
      </div>
    </div>
  )
}

function App() {
  const { locale, dir, setLocale, syncCrazyLocale, t, formatEvent } = useI18n()
  const [stats, setStats] = useState(initialStats)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [runId, setRunId] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem('tafheet-best') || 0) } catch { return 0 } })
  const [help, setHelp] = useState(false)
  const [showCoach, setShowCoach] = useState(() => !readCoachSeen())
  const [steerMode, setSteerMode] = useState<SteerMode>(readSteerMode)
  const [leaderboard, setLeaderboard] = useState(readLeaderboard)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showGarage, setShowGarage] = useState(false)
  const [carId, setCarId] = useState<CarId>(() => readSelectedCarId())
  const [garageFocusId, setGarageFocusId] = useState<CarId>(() => readSelectedCarId())
  const selectedCar = useMemo(() => carById(carId), [carId])
  const [adBusy, setAdBusy] = useState(false)
  const savedRun = useRef(-1)
  const happyPending = useRef(false)
  const finishAdDone = useRef(new Set<number>())
  const touchControlsRef = useRef<HTMLDivElement>(null)
  const [crashReveal, setCrashReveal] = useState(false)
  const quality = useMemo(() => detectGraphicsQuality(), [])
  const [isTouch, setIsTouch] = useState(() => detectTouchPlay())
  const [boot, setBoot] = useState<{
    visible: boolean
    fading: boolean
    mountScene: boolean
    sceneReady: boolean
    ratio: number
    label: MessageKey
  }>({
    visible: true,
    fading: false,
    mountScene: false,
    sceneReady: false,
    ratio: 0.02,
    label: 'boot.warming',
  })
  const bootStartedAt = useRef(performance.now())
  const bootDone = useRef(false)

  useEffect(() => {
    if (!stats.crashed) {
      setCrashReveal(false)
      return
    }
    const id = window.setTimeout(() => setCrashReveal(true), 1300)
    return () => window.clearTimeout(id)
  }, [stats.crashed, runId])

  const finished = started && stats.crashed && crashReveal

  const reportStats = useCallback((next: Stats) => {
    setStats(next)
    setBest(previous => {
      if (next.crashed && next.score > previous) happyPending.current = true
      return Math.max(previous, next.score)
    })
    if (next.crashed && savedRun.current !== runId) {
      savedRun.current = runId
      const entry: LeaderboardEntry = {
        id: crypto.randomUUID(),
        score: next.score,
        distance: Math.floor(next.distance),
        combo: next.longestCombo,
        nearMisses: next.nearMisses,
        date: new Date().toISOString(),
      }
      setLeaderboard(previous => rankRun(previous, entry))
    }
  }, [runId])

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      keys.add(e.code)
      // Escape closes CrazyGames fullscreen — pause with P / the pause button only.
      if (e.code === 'KeyP') setPaused(v => !v)
    }
    const up = (e: KeyboardEvent) => keys.delete(e.code)
    const blur = () => { clearInputs(); setPaused(true) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      clearInputs()
    }
  }, [])

  // Kill iOS/Android long-press callouts (Copy / Select All) while multi-touch driving.
  useEffect(() => {
    if (!started) return
    const block = (e: Event) => e.preventDefault()
    const clearSel = () => window.getSelection()?.removeAllRanges()
    document.addEventListener('selectstart', block)
    document.addEventListener('selectionchange', clearSel)
    document.addEventListener('contextmenu', block)
    const root = touchControlsRef.current
    const touchOpts: AddEventListenerOptions = { passive: false, capture: true }
    root?.addEventListener('touchstart', block, touchOpts)
    root?.addEventListener('touchmove', block, touchOpts)
    return () => {
      document.removeEventListener('selectstart', block)
      document.removeEventListener('selectionchange', clearSel)
      document.removeEventListener('contextmenu', block)
      root?.removeEventListener('touchstart', block, touchOpts)
      root?.removeEventListener('touchmove', block, touchOpts)
    }
  }, [started])

  useEffect(() => {
    try { localStorage.setItem('tafheet-best', String(best)) } catch { /* storage unavailable */ }
  }, [best])

  useEffect(() => {
    try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(leaderboard)) } catch { /* current-session scores still work */ }
  }, [leaderboard])

  useEffect(() => {
    let cancelled = false
    bootStartedAt.current = performance.now()
    ;(async () => {
      // Kick asset fetch immediately; init SDK in parallel so Chrome hits playable faster.
      const assets = preloadBootAssets(progress => {
        if (cancelled) return
        setBoot(prev => ({
          ...prev,
          ratio: Math.max(prev.ratio, progress.ratio * 0.9),
          label: progress.label as BootLabelKey,
        }))
      }, selectedCar.url).catch(() => { /* Suspense / AssetGate still finishes the wait. */ })

      await initCrazyGames()
      if (cancelled) return
      syncCrazyLocale(getCrazyLocale())
      loadingStart()
      await assets
      if (cancelled) return
      setBoot(prev => ({
        ...prev,
        mountScene: true,
        ratio: Math.max(prev.ratio, 0.95),
        label: 'boot.asphalt',
      }))
    })()
    return () => { cancelled = true }
  // selectedCar.url is read once at boot; garage swaps load via useGLTF later.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishBoot = useCallback(() => {
    if (bootDone.current) return
    bootDone.current = true
    const minMs = 350
    const wait = Math.max(0, minMs - (performance.now() - bootStartedAt.current))
    window.setTimeout(() => {
      setBoot(prev => ({ ...prev, ratio: 1, label: 'boot.ready', fading: true }))
      window.setTimeout(() => {
        loadingStop()
        setBoot(prev => ({ ...prev, visible: false, fading: false }))
      }, 280)
    }, wait)
  }, [])

  const onSceneReady = useCallback(() => {
    setBoot(prev => ({
      ...prev,
      sceneReady: true,
      ratio: 1,
      label: 'boot.ready',
    }))
  }, [])

  useEffect(() => {
    if (boot.mountScene && boot.sceneReady) finishBoot()
  }, [boot.mountScene, boot.sceneReady, finishBoot])

  const markCoachSeen = useCallback(() => {
    try { localStorage.setItem(COACH_KEY, '1') } catch { /* still playable this session */ }
  }, [])

  const dismissCoach = useCallback(() => {
    setShowCoach(false)
    markCoachSeen()
  }, [markCoachSeen])

  const chooseSteerMode = useCallback(async (mode: SteerMode) => {
    clearInputs()
    // iOS requires permission from a user gesture — request here when picking gyro.
    if (mode === 'gyro') await requestGyroPermission()
    setSteerMode(mode)
    try { localStorage.setItem(STEER_MODE_KEY, mode) } catch { /* preference still applies this session */ }
  }, [])

  const openGarage = useCallback(() => {
    setGarageFocusId(carId)
    setHelp(false)
    setShowGarage(true)
  }, [carId])

  const chooseCar = useCallback((id: CarId) => {
    const next = carById(id)
    if (!isCarUnlocked(next, best)) return
    setCarId(id)
    setGarageFocusId(id)
    writeSelectedCarId(id)
    // Close so the drift-in is visible on the intro / road.
    setShowGarage(false)
  }, [best])

  const start = () => {
    clearInputs()
    happyPending.current = false
    setStats(initialStats)
    setRunId(v => v + 1)
    setStarted(true)
    setPaused(false)
    setShowLeaderboard(false)
    setShowGarage(false)
    setHelp(false)
    if (!readCoachSeen()) setShowCoach(true)
  }

  const goMenu = () => {
    clearInputs()
    happyPending.current = false
    setStarted(false)
    setPaused(false)
    setShowLeaderboard(false)
    setShowGarage(false)
    setHelp(false)
    setShowCoach(false)
    setCrashReveal(false)
    setStats(initialStats)
    // Reset world/camera to the intro spawn (same as a fresh load).
    setRunId(v => v + 1)
  }

  useEffect(() => {
    const syncTouch = () => {
      const fromSdk = detectTouchPlayFromDevice(getCrazyDeviceType())
      setIsTouch(fromSdk ?? detectTouchPlay())
    }
    const coarse = window.matchMedia('(pointer: coarse)')
    const hover = window.matchMedia('(hover: none)')
    coarse.addEventListener?.('change', syncTouch)
    hover.addEventListener?.('change', syncTouch)
    syncTouch()
    return () => {
      coarse.removeEventListener?.('change', syncTouch)
      hover.removeEventListener?.('change', syncTouch)
    }
  }, [])

  // Prefer CrazyGames systemInfo once the SDK finishes init during boot.
  useEffect(() => {
    if (boot.visible) return
    const fromSdk = detectTouchPlayFromDevice(getCrazyDeviceType())
    if (fromSdk != null) setIsTouch(fromSdk)
  }, [boot.visible])

  // Keep the highway/car visible on the entry screen; only simulate once the run starts.
  const running = started && !paused && !help && !showLeaderboard && !showGarage && !adBusy && !(started && stats.crashed)
  const showChrome = !boot.visible
  const coachVisible = started && showCoach && running && !stats.crashed

  // Teach controls in-run, then clear once the player drifts or after a short window.
  useEffect(() => {
    if (!coachVisible) return
    if (stats.drift || stats.combo > 1) {
      dismissCoach()
      return
    }
    const id = window.setTimeout(dismissCoach, 10000)
    return () => window.clearTimeout(id)
  }, [coachVisible, stats.drift, stats.combo, dismissCoach])

  useEffect(() => {
    if (!started) return
    if (running) gameplayStart()
    else gameplayStop()
  }, [started, running])

  useEffect(() => {
    if (!finished) return
    if (finishAdDone.current.has(runId)) return
    let cancelled = false
    ;(async () => {
      await requestMidgameAd({
        onStart: () => { if (!cancelled) setAdBusy(true) },
        onEnd: () => { if (!cancelled) setAdBusy(false) },
      })
      if (cancelled) return
      finishAdDone.current.add(runId)
      if (happyPending.current) {
        happyPending.current = false
        happytime()
      }
    })()
    return () => { cancelled = true }
  }, [finished, runId])

  return (
    <main
      className={`game${started ? ' is-playing' : ' is-idle'}${isTouch ? ' is-touch' : ' is-desktop'}`}
      dir={dir}
      lang={locale}
      data-input={isTouch ? 'touch' : 'desktop'}
    >
      {boot.mountScene && (
        <Suspense fallback={null}>
          <GameScene
            running={running}
            runId={runId}
            onStats={reportStats}
            onReady={onSceneReady}
            showBuddy={false}
            crashed={stats.crashed}
            quality={quality}
            carUrl={selectedCar.url}
            carFeel={selectedCar}
            loadTraffic={started}
          />
        </Suspense>
      )}
      {boot.visible && (
        <div className={`boot-screen${boot.fading ? ' boot-screen-out' : ''}`} role="status" aria-live="polite" aria-busy={!boot.fading}>
          <div className="boot-card">
            <p className="boot-eyebrow">{t('boot.eyebrow')}</p>
            <h1 className="boot-title">{t('boot.title.hold')}<br /><em>{t('boot.title.tray')}</em></h1>
            <p className="boot-label">{t(boot.label)}</p>
            <div className="boot-track" aria-hidden="true">
              <div className="boot-fill" style={{ transform: `scaleX(${Math.max(0.04, boot.ratio)})` }} />
            </div>
            <span className="boot-percent" dir="ltr">{Math.round(boot.ratio * 100)}%</span>
          </div>
        </div>
      )}
      <div className="vignette" />
      {showChrome && (
        <>
          <header>
            <a className="brand" href="./" aria-label={t('brand.home')}>
              <span className="brand-title">{t('brand.name')}</span>
              <span className="brand-tag">{t('brand.tag')}</span>
            </a>
            <div className="location">
              <span className="dot" /> {t('loc.riyadhDrift')}
              <span className="coordinates" dir="ltr">24°43′ N &nbsp; 46°40′ E</span>
            </div>
            <button
              type="button"
              className="chip-button lang-chip lang-chip-end"
              onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}
              aria-label={t('nav.lang')}
            >{locale === 'ar' ? 'EN' : 'ع'}</button>
            <button className="icon-button" onClick={() => setShowLeaderboard(v => !v)} aria-label={t('nav.leaderboard')} disabled={adBusy}>♛</button>
            <button
              className="icon-button"
              onClick={() => {
                if (showGarage) setShowGarage(false)
                else openGarage()
              }}
              aria-label={t('nav.garage')}
              disabled={adBusy}
            >▣</button>
            <button
              className="icon-button"
              onClick={() => {
                setPaused(false)
                setHelp(v => !v)
              }}
              aria-label={t('nav.howto')}
              disabled={adBusy}
            >?</button>
            {started && (
              <button className="icon-button" onClick={() => setPaused(v => !v)} aria-label={paused ? t('nav.resume') : t('nav.pause')} disabled={adBusy}>
                {paused ? '▷' : 'Ⅱ'}
              </button>
            )}
          </header>
          <div className="topline">
            <span>{t('topline.left')}</span>
            <span className="arabic">{t('topline.right')}</span>
          </div>
          {!started && (
            <section className="intro">
              <div className="eyebrow">
                <span>{t('intro.eyebrow')}</span>
              </div>
              <h1>{t('boot.title.hold')}<br /><em>{t('boot.title.tray')}</em></h1>
              <p>{t('intro.body')}</p>
              {isTouch && <SteerModePicker value={steerMode} onChange={chooseSteerMode} />}
              <button type="button" className="garage-cta" onClick={openGarage}>
                <span className="garage-cta-label">{t('garage.cta')}</span>
                <strong>{t(`car.${selectedCar.id}.name` as MessageKey)}</strong>
                <span className="garage-cta-hint">{t('garage.ctaHint')} <span aria-hidden="true">↗</span></span>
              </button>
              <button className="start" onClick={start} disabled={adBusy}>{t('intro.start')} <span>↖</span></button>
              <div className="start-note">{isTouch ? t('intro.noteMobile') : t('intro.noteDesktop')}</div>
            </section>
          )}
        </>
      )}
      {showChrome && started && (
        <>
          <div className="score-panel">
            <span className="label">{t('hud.score')}</span>
            <strong dir="ltr">{stats.score.toLocaleString('en-US').padStart(6, '0')}</strong>
            <span className="best">{t('hud.best')} &nbsp; <span dir="ltr">{best.toLocaleString('en-US')}</span></span>
          </div>
          <div className="timer">
            <span className="label">{t('hud.distance')}</span>
            <strong dir="ltr">{(stats.distance / 1000).toFixed(2)} <small>{t('hud.km')}</small></strong>
            <span className="label">{t('hud.longest')} ×{stats.longestCombo}</span>
          </div>
          {stats.grace > 0 && !paused && !finished && (
            <div className="drift-callout">
              <span>{stats.drift ? t('hud.keepSideways') : t('hud.linkNext')}</span>
              <strong>{stats.drift ? t('hud.drifting') : t('hud.chainLive')} <em dir="ltr">×{stats.combo}</em></strong>
              <div className="combo-bar" style={{ transform: `scaleX(${stats.grace / CHAIN_WINDOW})`, transformOrigin: dir === 'rtl' ? 'right' : 'left' }} />
            </div>
          )}
          {stats.event && !paused && (
            <div
              className={`run-event${stats.event === 'chain_broken' || stats.event.startsWith('chain_broken') ? ' run-event-soft' : ''}`}
              role="status"
            >{formatEvent(stats.event)}</div>
          )}
          {stats.offroad && <div className="offroad">{t('hud.offroad')}</div>}
        </>
      )}
      {showChrome && (
        <>
          <div className="bottom-meta">
            <div className="route-icon">↖</div>
            <div>
              <strong>{t('meta.fromKitchen')}</strong>
              <span>{t('meta.oneTray')}</span>
            </div>
          </div>
          <div className="speedometer">
            <div className="speed-top"><span>{t('speed.car')}</span><span dir="ltr">{t(`car.${selectedCar.id}.name` as MessageKey)}</span></div>
            <div className="speed-value" dir="ltr">{Math.round(stats.speed).toString().padStart(3, '0')}<span>{t('speed.unit')}</span></div>
            <div className="speed-bars">{Array.from({ length: 24 }, (_, i) => <i key={i} className={i < stats.speed / 225 * 24 ? 'lit' : ''} />)}</div>
            <div className="speed-bottom">
              <span>{t('speed.gear')} <b dir="ltr">{stats.speed < 1 ? 'N' : Math.min(5, Math.floor(stats.speed / 48) + 1)}</b></span>
              <span className="traction">{stats.drift ? t('speed.lostGrip') : t('speed.ready')}</span>
            </div>
          </div>
          {!isTouch && (
            <footer>
              <div className="controls">
                <span><kbd>W</kbd><kbd>S</kbd> {t('controls.pedals')}</span>
                <span><kbd>A</kbd><kbd>D</kbd> {t('controls.steer')}</span>
                <span><kbd>SPACE</kbd> {t('controls.handbrake')}</span>
                <span><kbd>P</kbd> {t('controls.pause')}</span>
              </div>
              <span className="footer-note">{t('brand.name')}</span>
            </footer>
          )}
        </>
      )}
      {showChrome && coachVisible && (
        <div className="coach-overlay" role="status">
          <div className="coach-card">
            {!isTouch && (
              <div className="coach-keys" aria-hidden="true">
                <span><kbd>W</kbd><kbd>S</kbd></span>
                <span><kbd>A</kbd><kbd>D</kbd></span>
                <span><kbd>SPACE</kbd></span>
              </div>
            )}
            <p>{isTouch ? t('coach.mobile') : t('coach.desktop')}</p>
            <button type="button" className="text-button coach-skip" onClick={dismissCoach}>
              {t('coach.skip')}
            </button>
          </div>
        </div>
      )}
      {showChrome && started && isTouch && (
        <div
          ref={touchControlsRef}
          className="touch-controls"
          onContextMenu={e => e.preventDefault()}
        >
          <div className="touch-steer">
            {steerMode === 'wheel' ? (
              <TouchSteeringWheel />
            ) : steerMode === 'buttons' ? (
              <TouchSteerButtons />
            ) : (
              <TouchGyroSteer />
            )}
          </div>
          <div className="touch-drive">
            <button
              type="button"
              className="touch-btn touch-handbrake"
              aria-label={t('touch.handbrake')}
              onContextMenu={e => e.preventDefault()}
              onPointerDown={e => {
                e.preventDefault()
                e.currentTarget.setPointerCapture(e.pointerId)
                keys.add('Space')
              }}
              onPointerUp={() => keys.delete('Space')}
              onPointerCancel={() => keys.delete('Space')}
              onLostPointerCapture={() => keys.delete('Space')}
            />
            <div className="touch-pedals">
              <button
                type="button"
                className="touch-pedal touch-brake"
                aria-label={t('touch.brake')}
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => {
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  keys.add('KeyS')
                }}
                onPointerUp={() => keys.delete('KeyS')}
                onPointerCancel={() => keys.delete('KeyS')}
                onLostPointerCapture={() => keys.delete('KeyS')}
              />
              <button
                type="button"
                className="touch-pedal touch-gas"
                aria-label={t('touch.gas')}
                onContextMenu={e => e.preventDefault()}
                onPointerDown={e => {
                  e.preventDefault()
                  e.currentTarget.setPointerCapture(e.pointerId)
                  keys.add('KeyW')
                }}
                onPointerUp={() => keys.delete('KeyW')}
                onPointerCancel={() => keys.delete('KeyW')}
                onLostPointerCapture={() => keys.delete('KeyW')}
              />
            </div>
          </div>
        </div>
      )}
      {showChrome && (help || (started && paused) || finished) && !adBusy && (
        <div className="modal-backdrop">
          <section className="modal">
            <span className="eyebrow modal-brand">
              <span>{t('modal.eyebrow')}</span>
            </span>
            <h2>{help ? t('modal.helpTitle') : finished ? t('modal.finishTitle') : t('modal.pauseTitle')}</h2>
            {help ? (
              <>
                {isTouch ? (
                  <>
                    <p>{t('howto.mobile1')}</p>
                    <p>{t('howto.mobile2')}</p>
                    <p>{t('howto.mobile3')}</p>
                    <SteerModePicker value={steerMode} onChange={chooseSteerMode} />
                  </>
                ) : (
                  <>
                    <p>{t('howto.desktop1')}</p>
                    <p>{t('howto.desktop2')}</p>
                    <p>{t('howto.desktop3')}</p>
                    <p>{t('howto.desktop4')}</p>
                  </>
                )}
                <button className="start" onClick={() => setHelp(false)}>{t('modal.ok')} <span>↖</span></button>
              </>
            ) : finished ? (
              <>
                <p className="finish-reason">{formatEvent(stats.event)}</p>
                <p style={{ whiteSpace: 'pre-line' }}>
                  {t('modal.finishBody', {
                    score: stats.score.toLocaleString('en-US'),
                    km: (stats.distance / 1000).toFixed(2),
                    combo: stats.longestCombo,
                    near: stats.nearMisses,
                    best: best.toLocaleString('en-US'),
                  })}
                </p>
                <button className="start" onClick={start}>{t('modal.again')} <span>↖</span></button>
                <button type="button" className="start start-secondary" onClick={goMenu}>{t('modal.menu')} <span>↖</span></button>
                <button className="text-button" onClick={() => setShowLeaderboard(true)}>{t('modal.showBoard')}</button>
              </>
            ) : (
              <>
                <p>{t('modal.pauseBody')}</p>
                {isTouch && <SteerModePicker value={steerMode} onChange={chooseSteerMode} />}
                <button className="start" onClick={() => setPaused(false)}>{t('modal.continue')} <span>↖</span></button>
                <button type="button" className="start start-secondary" onClick={goMenu}>{t('modal.menu')} <span>↖</span></button>
                <button className="text-button" onClick={start}>{t('modal.restart')}</button>
              </>
            )}
          </section>
        </div>
      )}
      {showChrome && showLeaderboard && (
        <div className="modal-backdrop leaderboard-backdrop">
          <section className="modal leaderboard">
            <span className="eyebrow modal-brand">
              <span>{t('board.eyebrow')}</span>
            </span>
            <h2>{t('board.title')}</h2>
            <p>{t('board.blurb')}</p>
            {leaderboard.length === 0 ? (
              <p>{t('board.empty')}</p>
            ) : (
              <div className="ranking">
                <div className="ranking-row ranking-heading"><span>#</span><span>{t('board.headScore')}</span><span>{t('board.headKm')}</span><span>{t('board.headCombo')}</span></div>
                {leaderboard.map((entry, index) => (
                  <div className="ranking-row" key={entry.id}>
                    <b>{index + 1}</b>
                    <span><strong dir="ltr">{entry.score.toLocaleString('en-US')}</strong><small>{new Date(entry.date).toLocaleDateString(locale === 'ar' ? 'ar-SA' : 'en-GB')}</small></span>
                    <span dir="ltr">{(entry.distance / 1000).toFixed(2)}</span>
                    <span dir="ltr">×{entry.combo}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="start" onClick={() => setShowLeaderboard(false)}>{t('board.back')} <span>↖</span></button>
          </section>
        </div>
      )}
      {showChrome && showGarage && (
        <div className="modal-backdrop garage-backdrop" role="dialog" aria-modal="true" aria-labelledby="garage-title">
          <section className="modal garage">
            <span className="eyebrow modal-brand">
              <span>{t('garage.eyebrow')}</span>
            </span>
            <h2 id="garage-title">{t('garage.title')}</h2>
            <p>{t('garage.blurb')}</p>
            {DEV_UNLOCK_ALL && <p className="garage-dev">{t('garage.devAll')}</p>}
            <Suspense fallback={<div className="garage-preview garage-preview-loading" />}>
              <GaragePreview
                url={carById(garageFocusId).url}
                locked={!isCarUnlocked(carById(garageFocusId), best)}
                label={t(`car.${garageFocusId}.name` as MessageKey)}
              />
            </Suspense>
            <p className="garage-focus-name">{t(`car.${garageFocusId}.name` as MessageKey)}</p>
            <div className="garage-list">
              {CARS.map(car => {
                const unlocked = isCarUnlocked(car, best)
                const selected = car.id === carId
                const focused = car.id === garageFocusId
                return (
                  <button
                    key={car.id}
                    type="button"
                    className={`garage-row${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}${unlocked ? '' : ' is-locked'}`}
                    onClick={() => setGarageFocusId(car.id)}
                  >
                    <span className="garage-name">{t(`car.${car.id}.name` as MessageKey)}</span>
                    <span className="garage-meta">
                      {!unlocked
                        ? t('garage.locked', { score: car.unlockScore.toLocaleString('en-US') })
                        : selected
                          ? t('garage.selected')
                          : focused
                            ? t('garage.preview')
                            : ''}
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="garage-actions">
              <button
                type="button"
                className="start"
                disabled={!isCarUnlocked(carById(garageFocusId), best) || garageFocusId === carId}
                onClick={() => chooseCar(garageFocusId)}
              >
                {garageFocusId === carId ? t('garage.selected') : t('garage.use')} <span>✓</span>
              </button>
              <button type="button" className="start start-secondary" onClick={() => setShowGarage(false)}>
                {t('garage.back')} <span>↖</span>
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
