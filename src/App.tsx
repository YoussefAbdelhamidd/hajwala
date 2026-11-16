import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { preloadBootAssets } from './bootAssets'
import { CHAIN_WINDOW, COMBO_TIER_TIME, readLeaderboard, rankRun, LEADERBOARD_KEY } from './gameplay'
import type { LeaderboardEntry } from './gameplay'
import { detectGraphicsQuality, initialStats, keys } from './gameUi'
import type { Stats } from './gameUi'

const GameScene = lazy(() => import('./GameScene'))

function App() {
  const [stats, setStats] = useState(initialStats)
  const [started, setStarted] = useState(false)
  const [paused, setPaused] = useState(false)
  const [runId, setRunId] = useState(0)
  const [best, setBest] = useState(() => { try { return Number(localStorage.getItem('tafheet-best') || 0) } catch { return 0 } })
  const [help, setHelp] = useState(false)
  const [leaderboard, setLeaderboard] = useState(readLeaderboard)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const savedRun = useRef(-1)
  const [crashReveal, setCrashReveal] = useState(false)
  const quality = useMemo(() => detectGraphicsQuality(), [])
  const [boot, setBoot] = useState({
    visible: true,
    fading: false,
    mountScene: false,
    sceneReady: false,
    ratio: 0.02,
    label: 'Warming the highway…',
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
    const blur = () => { keys.clear(); setPaused(true) }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      keys.clear()
    }
  }, [])

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
          label: 'Rolling onto the asphalt…',
        }))
      })
      .catch(() => {
        if (cancelled) return
        // Still mount the scene — Suspense / AssetGate will finish the wait.
        setBoot(prev => ({
          ...prev,
          mountScene: true,
          ratio: Math.max(prev.ratio, 0.9),
          label: 'Rolling onto the asphalt…',
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
      setBoot(prev => ({ ...prev, ratio: 1, label: 'Ready.', fading: true }))
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
      label: 'Ready.',
    }))
  }, [])

  useEffect(() => {
    if (boot.mountScene && boot.sceneReady) finishBoot()
  }, [boot.mountScene, boot.sceneReady, finishBoot])

  const start = () => {
    keys.clear()
    setStats(initialStats)
    setRunId(v => v + 1)
    setStarted(true)
    setPaused(false)
    setShowLeaderboard(false)
  }

  // Keep the highway/car visible on the entry screen; only simulate once the run starts.
  const running = started && !paused && !help && !showLeaderboard && !(started && stats.crashed)
  const showChrome = !boot.visible

  return (
    <main className="game">
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
            <img className="boot-logo" src="/al-romansiah-logo.png" alt="alRomansiah" width={200} height={56} />
            <p className="boot-eyebrow">AL ROMANSIAH · RIYADH</p>
            <h1 className="boot-title">HOLD THE<br /><em>PLATTER.</em></h1>
            <p className="boot-label">{boot.label}</p>
            <div className="boot-track" aria-hidden="true">
              <div className="boot-fill" style={{ transform: `scaleX(${Math.max(0.04, boot.ratio)})` }} />
            </div>
            <span className="boot-percent">{Math.round(boot.ratio * 100)}%</span>
          </div>
        </div>
      )}
      <div className="vignette" />
      {showChrome && (
        <>
          <header>
            <a className="brand" href="/" aria-label="Al Romansiah home">
              <img className="brand-logo" src="/al-romansiah-logo.png" alt="alRomansiah" width={180} height={50} />
              <span className="brand-tag">THE CHICKEN RIDES</span>
            </a>
            <div className="location">
              <span className="dot" /> RIYADH · AL ROMANSIAH
              <span className="coordinates">24°43′ N &nbsp; 46°40′ E</span>
            </div>
            <button className="icon-button" onClick={() => setShowLeaderboard(v => !v)} aria-label="Local leaderboard">♛</button>
            <button className="icon-button" onClick={() => setHelp(v => !v)} aria-label="How to play">?</button>
            {started && (
              <button className="icon-button" onClick={() => setPaused(v => !v)} aria-label={paused ? 'Resume' : 'Pause'}>
                {paused ? '▷' : 'Ⅱ'}
              </button>
            )}
          </header>
          <div className="topline">
            <span>ENDLESS RUN <i /> PLATTER HIGHWAY</span>
            <span className="arabic" lang="ar">الرومانسية على الخط</span>
          </div>
          {!started && (
            <section className="intro">
              <div className="eyebrow">
                <img src="/al-romansiah-mark.png" alt="" width={22} height={22} />
                <span>AL ROMANSIAH · RIYADH</span>
              </div>
              <h1>HOLD THE<br /><em>PLATTER.</em></h1>
              <p>The house chicken is on the highway.<br />Drift the Datsun through the curves. Don’t spill the order.</p>
              <button className="start" onClick={start}>LET’S HAJWAL <span>↗</span></button>
              <div className="start-note">READ THE BENDS. LINK THE SLIDES. BRING IT HOME.</div>
            </section>
          )}
        </>
      )}
      {showChrome && started && (
        <>
          <div className="score-panel">
            <span className="label">RUN SCORE</span>
            <strong>{stats.score.toLocaleString().padStart(6, '0')}</strong>
            <span className="best">PERSONAL BEST &nbsp; {best.toLocaleString()}</span>
          </div>
          <div className="timer">
            <span className="label">DISTANCE</span>
            <strong>{(stats.distance / 1000).toFixed(2)} <small>KM</small></strong>
            <span className="label">BEST CHAIN ×{stats.longestCombo}</span>
          </div>
          {stats.grace > 0 && !paused && !finished && (
            <div className="drift-callout">
              <span>{stats.drift ? 'KEEP IT SIDEWAYS' : 'LINK THE NEXT SLIDE'}</span>
              <strong>{stats.drift ? 'DRIFTING' : 'CHAIN ALIVE'} <em>×{stats.combo}</em></strong>
              <div className="combo-bar" style={{ transform: `scaleX(${stats.grace / CHAIN_WINDOW})`, transformOrigin: 'left' }} />
            </div>
          )}
          {stats.event && !paused && <div className="run-event" role="status">{stats.event}</div>}
          {stats.offroad && <div className="offroad">OFF ROAD · RUN OVER</div>}
        </>
      )}
      {showChrome && (
        <>
          <div className="bottom-left">
            <div className="route-icon">↗</div>
            <div>
              <strong>FROM THE KITCHEN</strong>
              <span>One platter. The whole highway.</span>
            </div>
          </div>
          <div className="speedometer">
            <div className="speed-top"><span>داتسن</span><span>2014 / RWD</span></div>
            <div className="speed-value">{Math.round(stats.speed).toString().padStart(3, '0')}<span>KM/H</span></div>
            <div className="speed-bars">{Array.from({ length: 24 }, (_, i) => <i key={i} className={i < stats.speed / 225 * 24 ? 'lit' : ''} />)}</div>
            <div className="speed-bottom">
              <span>GEAR <b>{stats.speed < 1 ? 'N' : Math.min(5, Math.floor(stats.speed / 48) + 1)}</b></span>
              <span className="traction">{stats.drift ? '● TRACTION LOST' : '● READY TO SLIDE'}</span>
            </div>
          </div>
          <footer>
            <div className="controls">
              <span><kbd>W</kbd><kbd>S</kbd> THROTTLE / BRAKE</span>
              <span><kbd>A</kbd><kbd>D</kbd> STEER</span>
              <span><kbd>SPACE</kbd> HANDBRAKE</span>
            </div>
            <span className="footer-note">
              <img src="/al-romansiah-logo.png" alt="alRomansiah" width={110} height={30} />
            </span>
          </footer>
        </>
      )}
      {showChrome && started && (
        <div className="touch-controls">
          <div className="touch-steer">
            <button
              type="button"
              className="touch-btn touch-left"
              aria-label="Steer left"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); keys.add('KeyA') }}
              onPointerUp={() => keys.delete('KeyA')}
              onPointerCancel={() => keys.delete('KeyA')}
              onLostPointerCapture={() => keys.delete('KeyA')}
            >←</button>
            <button
              type="button"
              className="touch-btn touch-right"
              aria-label="Steer right"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); keys.add('KeyD') }}
              onPointerUp={() => keys.delete('KeyD')}
              onPointerCancel={() => keys.delete('KeyD')}
              onLostPointerCapture={() => keys.delete('KeyD')}
            >→</button>
          </div>
          <div className="touch-drive">
            <button
              type="button"
              className="touch-btn touch-handbrake"
              aria-label="Handbrake"
              onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); keys.add('Space') }}
              onPointerUp={() => keys.delete('Space')}
              onPointerCancel={() => keys.delete('Space')}
              onLostPointerCapture={() => keys.delete('Space')}
            >
              <img src="/automobile.png" alt="" draggable={false} width={56} height={56} />
            </button>
            <div className="touch-pedals">
              <img className="touch-pedals-art" src="/pedals.png" alt="" draggable={false} width={140} height={140} />
              <button
                type="button"
                className="touch-pedal touch-brake"
                aria-label="Brake"
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); keys.add('KeyS') }}
                onPointerUp={() => keys.delete('KeyS')}
                onPointerCancel={() => keys.delete('KeyS')}
                onLostPointerCapture={() => keys.delete('KeyS')}
              />
              <button
                type="button"
                className="touch-pedal touch-gas"
                aria-label="Gas"
                onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); keys.add('KeyW') }}
                onPointerUp={() => keys.delete('KeyW')}
                onPointerCancel={() => keys.delete('KeyW')}
                onLostPointerCapture={() => keys.delete('KeyW')}
              />
            </div>
          </div>
        </div>
      )}
      {showChrome && (help || (started && paused) || finished) && (
        <div className="modal-backdrop">
          <section className="modal">
            <span className="eyebrow modal-brand">
              <img src="/al-romansiah-logo.png" alt="alRomansiah" width={140} height={38} />
              <span>THE PLATTER RUN</span>
            </span>
            <h2>{help ? 'Find your angle.' : finished ? 'Platter’s still warm.' : 'The chicken can wait.'}</h2>
            {help ? (
              <>
                <p>Hold W or ↑ to accelerate. Steer with A / D or ← / →. Tap Space while turning to break rear traction, then release it and countersteer to catch the slide. Ease off the throttle if the rear swings too far.</p>
                <p>The highway snakes — read the curves and drift through them. Drift above 36 km/h on the asphalt to earn points. Solid angle builds the multiplier; weak slides barely count. Each × needs about {COMBO_TIER_TIME}s of committed slide, so ×5 takes a long linked run. You have {CHAIN_WINDOW}s to link the next slide. Changing drift direction earns a bonus. Close passes earn more while drifting. Hit the chickens on the road for bonus points — they explode, but the run keeps going. Leaving the asphalt, touching any traffic car, or losing your drift chain ends the run.</p>
                <p>On touch screens: steer on the left, gas/brake pedals and handbrake on the right. Hold gas and steer, briefly tap handbrake, then steer against the slide to catch it.</p>
                <button className="start" onClick={() => setHelp(false)}>GOT IT <span>↗</span></button>
              </>
            ) : finished ? (
              <>
                <p className="finish-reason">{stats.event}</p>
                <p>You scored <b>{stats.score.toLocaleString()}</b> points over <b>{(stats.distance / 1000).toFixed(2)} km</b>.<br />Longest combo: ×{stats.longestCombo} · Close passes: {stats.nearMisses}<br />Personal best: {best.toLocaleString()}</p>
                <button className="start" onClick={start}>ANOTHER RUN <span>↗</span></button>
                <button className="text-button" onClick={() => setShowLeaderboard(true)}>View local leaderboard</button>
              </>
            ) : (
              <>
                <p>The kitchen can wait.</p>
                <button className="start" onClick={() => setPaused(false)}>KEEP DRIVING <span>↗</span></button>
                <button className="text-button" onClick={start}>Restart run</button>
              </>
            )}
          </section>
        </div>
      )}
      {showChrome && showLeaderboard && (
        <div className="modal-backdrop leaderboard-backdrop">
          <section className="modal leaderboard">
            <span className="eyebrow modal-brand">
              <img src="/al-romansiah-logo.png" alt="alRomansiah" width={140} height={38} />
              <span>TOP 10 / THIS DEVICE</span>
            </span>
            <h2>Leave your mark.</h2>
            <p>Completed runs ranked by score. Ties go to the longest distance.</p>
            {leaderboard.length === 0 ? (
              <p>No completed runs yet. Your first run sets the mark.</p>
            ) : (
              <div className="ranking">
                <div className="ranking-row ranking-heading"><span>#</span><span>SCORE / DATE</span><span>KM</span><span>CHAIN</span></div>
                {leaderboard.map((entry, index) => (
                  <div className="ranking-row" key={entry.id}>
                    <b>{index + 1}</b>
                    <span><strong>{entry.score.toLocaleString()}</strong><small>{new Date(entry.date).toLocaleDateString()}</small></span>
                    <span>{(entry.distance / 1000).toFixed(2)}</span>
                    <span>×{entry.combo}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="start" onClick={() => setShowLeaderboard(false)}>BACK <span>↗</span></button>
          </section>
        </div>
      )}
    </main>
  )
}

export default App
