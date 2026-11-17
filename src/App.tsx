import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import './App.css'
import { preloadBootAssets } from './bootAssets'
import { CHAIN_WINDOW, COMBO_TIER_TIME, readLeaderboard, rankRun, LEADERBOARD_KEY } from './gameplay'
import type { LeaderboardEntry } from './gameplay'
import { clearInputs, detectGraphicsQuality, initialStats, keys, steerAxis } from './gameUi'
import type { Stats } from './gameUi'

const GameScene = lazy(() => import('./GameScene'))

/** Visual + input lock: this many degrees of wheel twist = full steer. */
const STEER_LOCK_DEG = 140
const STEER_LOCK_RAD = (STEER_LOCK_DEG * Math.PI) / 180
/** Ignore twist samples too close to the hub (atan2 goes wild there). */
const STEER_HUB_RATIO = 0.18
const HOWTO_KEY = 'tafheet-howto-seen'
const STEER_MODE_KEY = 'tafheet-steer-mode'
const LOGO_URL = '/al-romansiah-logo.png?v=white1'
const MARK_URL = '/al-romansiah-mark.png?v=white1'

type OrientationMode = 'auto' | 'portrait' | 'landscape'
type SteerMode = 'wheel' | 'buttons'

function readHowToSeen() {
  try { return localStorage.getItem(HOWTO_KEY) === '1' } catch { return false }
}

function readSteerMode(): SteerMode {
  try {
    return localStorage.getItem(STEER_MODE_KEY) === 'buttons' ? 'buttons' : 'wheel'
  } catch {
    return 'wheel'
  }
}

function unwrapDelta(from: number, to: number) {
  let d = to - from
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

function TouchSteeringWheel() {
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
      aria-label="عجلة القيادة"
      aria-valuemin={-100}
      aria-valuemax={100}
      aria-valuenow={Math.round(ariaSteer * 100)}
      aria-valuetext={ariaSteer === 0 ? 'مستقيم' : ariaSteer > 0 ? `يسار ${Math.round(ariaSteer * 100)}٪` : `يمين ${Math.round(-ariaSteer * 100)}٪`}
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

function holdKeyHandlers(code: 'KeyA' | 'KeyD') {
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
  return (
    <div className="touch-steer-buttons" role="group" aria-label="توجيه">
      <button
        type="button"
        className="touch-btn touch-turn touch-turn-left"
        aria-label="يسار"
        onContextMenu={e => e.preventDefault()}
        {...holdKeyHandlers('KeyA')}
      >
        <span aria-hidden="true">←</span>
      </button>
      <button
        type="button"
        className="touch-btn touch-turn touch-turn-right"
        aria-label="يمين"
        onContextMenu={e => e.preventDefault()}
        {...holdKeyHandlers('KeyD')}
      >
        <span aria-hidden="true">→</span>
      </button>
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
  return (
    <div className="steer-mode" role="group" aria-label="طريقة التوجيه">
      <span className="steer-mode-label">التوجيه</span>
      <div className="steer-mode-options">
        <button
          type="button"
          className={`steer-mode-option${value === 'wheel' ? ' is-on' : ''}`}
          aria-pressed={value === 'wheel'}
          onClick={() => onChange('wheel')}
        >
          عجلة
        </button>
        <button
          type="button"
          className={`steer-mode-option${value === 'buttons' ? ' is-on' : ''}`}
          aria-pressed={value === 'buttons'}
          onClick={() => onChange('buttons')}
        >
          أزرار
        </button>
      </div>
    </div>
  )
}

function App() {
  const [stats, setStats] = useState(initialStats)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [runId, setRunId] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem('tafheet-best') || 0) } catch { return 0 } })
  const [help, setHelp] = useState(false)
  const [showHowTo, setShowHowTo] = useState(() => !readHowToSeen())
  const [steerMode, setSteerMode] = useState<SteerMode>(readSteerMode)
  const [leaderboard, setLeaderboard] = useState(readLeaderboard)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const savedRun = useRef(-1)
  const touchControlsRef = useRef<HTMLDivElement>(null)
  const [crashReveal, setCrashReveal] = useState(false)
  const quality = useMemo(() => detectGraphicsQuality(), [])
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [orientation, setOrientation] = useState<OrientationMode>('auto')
  const [boot, setBoot] = useState({
    visible: true,
    fading: false,
    mountScene: false,
    sceneReady: false,
    ratio: 0.02,
    label: 'نسخّن الطريق السريع…',
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
    setBest(previous => Math.max(previous, next.score))
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
      if (e.code === 'Escape') setPaused(v => !v)
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
    preloadBootAssets(progress => {
      if (cancelled) return
      setBoot(prev => ({
        ...prev,
        ratio: Math.max(prev.ratio, progress.ratio),
        label: progress.label,
      }))
    })
      .then(() => {
        if (cancelled) return
        setBoot(prev => ({
          ...prev,
          mountScene: true,
          ratio: Math.max(prev.ratio, 0.95),
          label: 'نطلع على الأسفلت…',
        }))
      })
      .catch(() => {
        if (cancelled) return
        // Still mount the scene — Suspense / AssetGate will finish the wait.
        setBoot(prev => ({
          ...prev,
          mountScene: true,
          ratio: Math.max(prev.ratio, 0.9),
          label: 'نطلع على الأسفلت…',
        }))
      })
    return () => { cancelled = true }
  }, [])

  const finishBoot = useCallback(() => {
    if (bootDone.current) return
    bootDone.current = true
    const minMs = 900
    const wait = Math.max(0, minMs - (performance.now() - bootStartedAt.current))
    window.setTimeout(() => {
      setBoot(prev => ({ ...prev, ratio: 1, label: 'جاهز.', fading: true }))
      window.setTimeout(() => {
        setBoot(prev => ({ ...prev, visible: false, fading: false }))
      }, 480)
    }, wait)
  }, [])

  const onSceneReady = useCallback(() => {
    setBoot(prev => ({
      ...prev,
      sceneReady: true,
      ratio: 1,
      label: 'جاهز.',
    }))
  }, [])

  useEffect(() => {
    if (boot.mountScene && boot.sceneReady) finishBoot()
  }, [boot.mountScene, boot.sceneReady, finishBoot])

  useEffect(() => {
    const sync = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', sync)
    sync()
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])

  const lockOrientation = useCallback(async (mode: OrientationMode) => {
    const orientationApi = screen.orientation as ScreenOrientation & {
      lock?: (type: string) => Promise<void>
      unlock?: () => void
    }
    try {
      if (mode === 'auto') {
        orientationApi.unlock?.()
        return
      }
      await orientationApi.lock?.(mode)
    } catch {
      /* Many mobile browsers require fullscreen before lock; layout CSS still applies. */
    }
  }, [])

  const toggleFullscreen = useCallback(async () => {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void
    }
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      if (root.requestFullscreen) await root.requestFullscreen()
      else root.webkitRequestFullscreen?.()
    } catch {
      /* iOS Safari often blocks programmatic fullscreen outside video. */
    }
  }, [])

  const chooseOrientation = useCallback(async (mode: OrientationMode) => {
    setOrientation(mode)
    if (mode !== 'auto' && !document.fullscreenElement) {
      await toggleFullscreen()
    }
    await lockOrientation(mode)
  }, [lockOrientation, toggleFullscreen])

  useEffect(() => {
    if (!isFullscreen && orientation !== 'auto') {
      lockOrientation('auto')
    } else if (isFullscreen) {
      lockOrientation(orientation)
    }
  }, [isFullscreen, orientation, lockOrientation])

  const dismissHowTo = useCallback(() => {
    setShowHowTo(false)
    try { localStorage.setItem(HOWTO_KEY, '1') } catch { /* still playable this session */ }
  }, [])

  const chooseSteerMode = useCallback((mode: SteerMode) => {
    clearInputs()
    setSteerMode(mode)
    try { localStorage.setItem(STEER_MODE_KEY, mode) } catch { /* preference still applies this session */ }
  }, [])

  const start = () => {
    clearInputs()
    setStats(initialStats)
    setRunId(v => v + 1)
    setStarted(true)
    setPaused(false)
    setShowLeaderboard(false)
    setShowHowTo(false)
  }

  // Keep the highway/car visible on the entry screen; only simulate once the run starts.
  const running = started && !paused && !help && !showHowTo && !showLeaderboard && !(started && stats.crashed)
  const showChrome = !boot.visible

  return (
    <main className={`game orient-${orientation}${isFullscreen ? ' is-fullscreen' : ''}${started ? ' is-playing' : ' is-idle'}`}>
      {boot.mountScene && (
        <Suspense fallback={null}>
          <GameScene
            running={running}
            runId={runId}
            onStats={reportStats}
            onReady={onSceneReady}
            showBuddy={started}
            crashed={stats.crashed}
            quality={quality}
          />
        </Suspense>
      )}
      {boot.visible && (
        <div className={`boot-screen${boot.fading ? ' boot-screen-out' : ''}`} role="status" aria-live="polite" aria-busy={!boot.fading}>
          <div className="boot-card">
            <img className="boot-logo" src={LOGO_URL} alt="الرومانسية" width={200} height={56} />
            <p className="boot-eyebrow">الرومانسية · الرياض</p>
            <h1 className="boot-title">أمسك<br /><em>الصينية.</em></h1>
            <p className="boot-label">{boot.label}</p>
            <div className="boot-track" aria-hidden="true">
              <div className="boot-fill" style={{ transform: `scaleX(${Math.max(0.04, boot.ratio)})` }} />
            </div>
            <span className="boot-percent">{Math.round(boot.ratio * 100)}٪</span>
          </div>
        </div>
      )}
      <div className="vignette" />
      {showChrome && (
        <>
          <header>
            <a className="brand" href="/" aria-label="الرومانسية — الصفحة الرئيسية">
              <img className="brand-logo" src={LOGO_URL} alt="الرومانسية" width={180} height={50} />
              <span className="brand-tag">الدجاجة تركب</span>
            </a>
            <div className="location">
              <span className="dot" /> الرياض · الرومانسية
              <span className="coordinates" dir="ltr">24°43′ N &nbsp; 46°40′ E</span>
            </div>
            <div className="mobile-display" role="group" aria-label="خيارات العرض">
              <button
                type="button"
                className={`chip-button${isFullscreen ? ' is-on' : ''}`}
                onClick={toggleFullscreen}
                aria-pressed={isFullscreen}
                aria-label={isFullscreen ? 'الخروج من ملء الشاشة' : 'ملء الشاشة'}
              >{isFullscreen ? 'خروج' : 'ملء'}</button>
              <button
                type="button"
                className={`chip-button${orientation === 'portrait' ? ' is-on' : ''}`}
                onClick={() => chooseOrientation(orientation === 'portrait' ? 'auto' : 'portrait')}
                aria-pressed={orientation === 'portrait'}
                aria-label="وضع عمودي"
              >طولي</button>
              <button
                type="button"
                className={`chip-button${orientation === 'landscape' ? ' is-on' : ''}`}
                onClick={() => chooseOrientation(orientation === 'landscape' ? 'auto' : 'landscape')}
                aria-pressed={orientation === 'landscape'}
                aria-label="وضع أفقي"
              >عرضي</button>
            </div>
            <button className="icon-button" onClick={() => setShowLeaderboard(v => !v)} aria-label="المتصدرون المحليون">♛</button>
            <button
              className="icon-button"
              onClick={() => {
                if (showHowTo) dismissHowTo()
                setHelp(v => !v)
              }}
              aria-label="طريقة اللعب"
            >؟</button>
            {started && (
              <button className="icon-button" onClick={() => setPaused(v => !v)} aria-label={paused ? 'متابعة' : 'إيقاف'}>
                {paused ? '▷' : 'Ⅱ'}
              </button>
            )}
          </header>
          <div className="topline">
            <span>جولة بلا نهاية <i /> طريق الصينية</span>
            <span className="arabic">الرومانسية على الخط</span>
          </div>
          {!started && (
            <section className="intro">
              <div className="eyebrow">
                <img src={MARK_URL} alt="" width={22} height={22} />
                <span>الرومانسية · الرياض</span>
              </div>
              <h1>أمسك<br /><em>الصينية.</em></h1>
              <p>دجاجة البيت على الطريق السريع.<br />درّف الداتسن بين المنعطفات. لا تسكب الطلب.</p>
              <SteerModePicker value={steerMode} onChange={chooseSteerMode} />
              <button className="start" onClick={start}>يلا نهجول <span>↖</span></button>
              <div className="start-note">اقرأ المنعطفات. اربط الانزلاقات. وصّلها للبيت.</div>
            </section>
          )}
        </>
      )}
      {showChrome && started && (
        <>
          <div className="score-panel">
            <span className="label">نقاط الجولة</span>
            <strong dir="ltr">{stats.score.toLocaleString('en-US').padStart(6, '0')}</strong>
            <span className="best">أفضل رقم &nbsp; <span dir="ltr">{best.toLocaleString('en-US')}</span></span>
          </div>
          <div className="timer">
            <span className="label">المسافة</span>
            <strong dir="ltr">{(stats.distance / 1000).toFixed(2)} <small>كم</small></strong>
            <span className="label">أطول سلسلة ×{stats.longestCombo}</span>
          </div>
          {stats.grace > 0 && !paused && !finished && (
            <div className="drift-callout">
              <span>{stats.drift ? 'خلّها جانبية' : 'اربط الانزلاقة التالية'}</span>
              <strong>{stats.drift ? 'درفت' : 'السلسلة حيّة'} <em dir="ltr">×{stats.combo}</em></strong>
              <div className="combo-bar" style={{ transform: `scaleX(${stats.grace / CHAIN_WINDOW})`, transformOrigin: 'right' }} />
            </div>
          )}
          {stats.event && !paused && <div className="run-event" role="status">{stats.event}</div>}
          {stats.offroad && <div className="offroad">خارج الطريق · انتهت الجولة</div>}
        </>
      )}
      {showChrome && (
        <>
          <div className="bottom-meta">
            <div className="route-icon">↖</div>
            <div>
              <strong>من المطبخ</strong>
              <span>صينية واحدة. الطريق كله.</span>
            </div>
          </div>
          <div className="speedometer">
            <div className="speed-top"><span>داتسن</span><span dir="ltr">2014 / RWD</span></div>
            <div className="speed-value" dir="ltr">{Math.round(stats.speed).toString().padStart(3, '0')}<span>كم/س</span></div>
            <div className="speed-bars">{Array.from({ length: 24 }, (_, i) => <i key={i} className={i < stats.speed / 225 * 24 ? 'lit' : ''} />)}</div>
            <div className="speed-bottom">
              <span>ناقل <b dir="ltr">{stats.speed < 1 ? 'N' : Math.min(5, Math.floor(stats.speed / 48) + 1)}</b></span>
              <span className="traction">{stats.drift ? '● فقدت التماسك' : '● جاهز للانزلاق'}</span>
            </div>
          </div>
          <footer>
            <div className="controls">
              <span><kbd>W</kbd><kbd>S</kbd> دواسة / فرامل</span>
              <span><kbd>A</kbd><kbd>D</kbd> توجيه</span>
              <span><kbd>SPACE</kbd> فرامل يد</span>
            </div>
            <span className="footer-note">
              <img src={LOGO_URL} alt="الرومانسية" width={110} height={30} />
            </span>
          </footer>
        </>
      )}
      {showChrome && started && (
        <div
          ref={touchControlsRef}
          className="touch-controls"
          onContextMenu={e => e.preventDefault()}
        >
          <div className="touch-steer">
            {steerMode === 'wheel' ? <TouchSteeringWheel /> : <TouchSteerButtons />}
          </div>
          <div className="touch-drive">
            <button
              type="button"
              className="touch-btn touch-handbrake"
              aria-label="فرامل اليد"
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
                aria-label="فرامل"
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
                aria-label="بنزين"
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
      {showChrome && showHowTo && !help && !finished && (
        <div className="modal-backdrop howto-backdrop" role="dialog" aria-modal="true" aria-labelledby="howto-title">
          <section className="modal howto-modal">
            <span className="eyebrow modal-brand">
              <img src={LOGO_URL} alt="الرومانسية" width={140} height={38} />
              <span>أول جولة</span>
            </span>
            <h2 id="howto-title">كيف تلعب.</h2>
            <ul className="howto-list">
              <li><kbd>W</kbd> / <kbd>↑</kbd> بنزين · <kbd>S</kbd> / <kbd>↓</kbd> فرامل · <kbd>A</kbd><kbd>D</kbd> توجيه · <kbd>SPACE</kbd> فرامل يد</li>
              <li>سرّع، لف، واضغط فرامل اليد لكسر تماسك الخلف — بعدين وجّه عكس الانزلاق عشان تمسكه.</li>
              <li>الدرفت فوق ٣٦ كم/س على الأسفلت يجيب نقاط. اربط الانزلاقات خلال {CHAIN_WINDOW} ثوانٍ، وارفع المضاعف لـ ×٥.</li>
              <li>الخروج عن الأسفلت، لمس سيارة مرور، أو قطع سلسلة الدرفت ينهي الجولة. التجاوزات القريبة تعطي بونص.</li>
              <li>على اللمس: اختَر عجلة أو أزرار يمين/يسار على الشاشة الرئيسية. الدواسات وفرامل اليد على اليمين.</li>
            </ul>
            <SteerModePicker value={steerMode} onChange={chooseSteerMode} />
            <button className="start" onClick={dismissHowTo}>تمام، يلا <span>↖</span></button>
          </section>
        </div>
      )}
      {showChrome && (help || (started && paused) || finished) && (
        <div className="modal-backdrop">
          <section className="modal">
            <span className="eyebrow modal-brand">
              <img src={LOGO_URL} alt="الرومانسية" width={140} height={38} />
              <span>جولة الصينية</span>
            </span>
            <h2>{help ? 'لاقِ زاويتك.' : finished ? 'الصينية لسه سخنة.' : 'الدجاجة تقدر تستنى.'}</h2>
            {help ? (
              <>
                <p>اضغط W أو ↑ للتسارع. وجّه بـ A / D أو ← / →. اضغط Space وأنت تدور لكسر تماسك الخلف، ثم أفلتها ووجّه عكس الانزلاق عشان تمسكه. خفّف الدواسة إذا طاح الخلف زيادة.</p>
                <p>الطريق يلتوي — اقرأ المنعطفات ودرّف فيها. الدرفت فوق ٣٦ كم/س على الأسفلت يجيب نقاط. الزاوية الثابتة ترفع المضاعف؛ الانزلاقات الضعيفة ما تحسب كثير. كل × يحتاج حوالي {COMBO_TIER_TIME} ثوانٍ درفت مستمر، يعني ×٥ يحتاج جولة طويلة مربوطة. عندك {CHAIN_WINDOW} ثانية تربط فيها الانزلاقة التالية. تغيير اتجاه الدرفت يعطي بونص. التجاوزات القريبة تعطي أكثر وأنت درفت. اضرب الدجاجات على الطريق لبونص — تنفجر والجولة تكمل. الخروج عن الأسفلت أو لمس أي سيارة مرور أو قطع سلسلة الدرفت ينهي الجولة.</p>
                <p>على الشاشات اللمسية: اختَر عجلة أو أزرار يمين/يسار للتوجيه، والدواسات وفرامل اليد على اليمين. استخدم ملء / طولي / عرضي للعرض. امسك البنزين ووجّه، اضغط فرامل اليد لحظة، ثم وجّه ضد الانزلاق عشان تمسكه.</p>
                <SteerModePicker value={steerMode} onChange={chooseSteerMode} />
                <button className="start" onClick={() => setHelp(false)}>تمام <span>↖</span></button>
              </>
            ) : finished ? (
              <>
                <p className="finish-reason">{stats.event}</p>
                <p>سجّلت <b dir="ltr">{stats.score.toLocaleString('en-US')}</b> نقطة على مسافة <b dir="ltr">{(stats.distance / 1000).toFixed(2)} كم</b>.<br />أطول سلسلة: ×{stats.longestCombo} · تجاوزات قريبة: {stats.nearMisses}<br />أفضل رقم: <span dir="ltr">{best.toLocaleString('en-US')}</span></p>
                <button className="start" onClick={start}>جولة ثانية <span>↖</span></button>
                <button className="text-button" onClick={() => setShowLeaderboard(true)}>عرض المتصدرين المحليين</button>
              </>
            ) : (
              <>
                <p>المطبخ يقدر يستنى.</p>
                <SteerModePicker value={steerMode} onChange={chooseSteerMode} />
                <button className="start" onClick={() => setPaused(false)}>كمّل سواقة <span>↖</span></button>
                <button className="text-button" onClick={start}>أعد الجولة</button>
              </>
            )}
          </section>
        </div>
      )}
      {showChrome && showLeaderboard && (
        <div className="modal-backdrop leaderboard-backdrop">
          <section className="modal leaderboard">
            <span className="eyebrow modal-brand">
              <img src={LOGO_URL} alt="الرومانسية" width={140} height={38} />
              <span>أفضل ١٠ / هذا الجهاز</span>
            </span>
            <h2>سجّل علامتك.</h2>
            <p>الجولات المكتملة مرتبة بالنقاط. التعادل يروح للأطول مسافة.</p>
            {leaderboard.length === 0 ? (
              <p>ما فيه جولات مكتملة بعد. جولتك الأولى تحدد العلامة.</p>
            ) : (
              <div className="ranking">
                <div className="ranking-row ranking-heading"><span>#</span><span>النقاط / التاريخ</span><span>كم</span><span>سلسلة</span></div>
                {leaderboard.map((entry, index) => (
                  <div className="ranking-row" key={entry.id}>
                    <b>{index + 1}</b>
                    <span><strong dir="ltr">{entry.score.toLocaleString('en-US')}</strong><small>{new Date(entry.date).toLocaleDateString('ar-SA')}</small></span>
                    <span dir="ltr">{(entry.distance / 1000).toFixed(2)}</span>
                    <span dir="ltr">×{entry.combo}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="start" onClick={() => setShowLeaderboard(false)}>رجوع <span>↖</span></button>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
