import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const cacheDir = fileURLToPath(new URL('./.cache/', import.meta.url))
fs.mkdirSync(cacheDir, { recursive: true })
function compile(name) {
  const source = fs.readFileSync(new URL(`../src/${name}.ts`, import.meta.url), 'utf8')
  const js = ts.transpile(source, { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 })
    .replace(/from ['"](\.[^'"]+)['"]/g, (_, spec) => `from '${spec}.js'`)
  fs.writeFileSync(path.join(cacheDir, `${name}.js`), js)
}
;['road', 'driving', 'gameplay'].forEach(compile)
const g = await import(pathToFileURL(path.join(cacheDir, 'gameplay.js')).href)
const { initialDriving } = await import(pathToFileURL(path.join(cacheDir, 'driving.js')).href)

test('direction transitions preserve the multiplier and award a single link bonus', () => {
  for (const fps of [30, 60, 120]) {
    const s = g.newRun()
    // Solid angle (.7 quality) needs ~2 tiers × COMBO_TIER_TIME of committed slide.
    for (let i = 0; i < fps * (g.COMBO_TIER_TIME * 2 / .7 + .2); i++) g.stepScore(s, 1 / fps, 30, .35, true)
    assert.equal(s.combo, 3)
    const slide = s.slide
    for (let i = 0; i < fps; i++) g.stepScore(s, 1 / fps, 30, 0, true)
    assert.equal(s.combo, 3)
    assert.equal(s.slide, slide)
    const score = s.score
    g.stepScore(s, 1 / fps, 30, -.35, true)
    assert.equal(s.combo, 3)
    assert.ok(s.score - score >= 750)
    assert.match(s.event, /LINKED DRIFT/)
    const next = s.score
    g.stepScore(s, 1 / fps, 30, -.35, true)
    assert.ok(s.score - next < 20)
  }
})
test('expired transitions and offroad end the run; deep spins keep the chain', () => {
  for (const reason of ['expired', 'offroad']) {
    const s = g.newRun()
    g.stepScore(s, 4.2, 30, .35, true)
    g.stepScore(s, reason === 'expired' ? 1.6 : .04, 30, 0, reason !== 'offroad')
    assert.equal(s.combo, 1)
    assert.equal(s.grace, 0)
    assert.equal(s.crashed, true)
  }
  const spin = g.newRun()
  g.stepScore(spin, 4.2, 30, .35, true)
  assert.equal(g.stepScore(spin, .04, 30, 1.4, true), true)
  assert.equal(spin.crashed, false)
  assert.ok(spin.grace > 0)
})
test('all traffic contact ends the run, including scrapes and low-speed taps', () => {
  const make = () => ({ ...initialDriving(), ...g.newRun(), forward: 40, speed: 40, x: 0, z: 0, yaw: 0 })
  const car = (x, z) => ({ pathZ: z, x, z, lane: 0, speed: 15, passed: false })
  const heavy = make()
  g.stepTraffic(heavy, [car(0, -2)], .01, false)
  assert.equal(heavy.crashed, true)
  assert.equal(heavy.combo, 1)
  const scrape = make()
  g.stepTraffic(scrape, [car(1.8, -2)], .01, true)
  assert.equal(scrape.crashed, true)
  assert.ok(scrape.speed < 40)
  assert.equal(scrape.combo, 1)
  const tap = { ...make(), forward: 15, speed: 15 }
  g.stepTraffic(tap, [car(0, -2)], .01, false)
  assert.equal(tap.crashed, true)
  assert.ok(g.overlapsTraffic(0, 0, Math.PI / 2, { x: 2, z: 0 }))
  assert.equal(g.overlapsTraffic(0, 0, 0, { x: 9, z: 0 }), false)
})
test('close passes pay once, sideways passes pay more, traffic recycles ahead', () => {
  for (const drift of [false, true]) {
    const s = { ...initialDriving(), ...g.newRun(), forward: 40, speed: 40, combo: 3, x: 0, z: 0, yaw: 0 }
    const traffic = [{ pathZ: 6, x: 3, z: 6, lane: 4, speed: 15, passed: false }]
    g.stepTraffic(s, traffic, .01, drift)
    assert.equal(s.score, (drift ? 600 : 200) * 3)
    assert.equal(s.nearMisses, 1)
    g.stepTraffic(s, traffic, .01, drift)
    assert.equal(s.nearMisses, 1)
    traffic[0].pathZ = 80
    traffic[0].z = 80
    g.stepTraffic(s, traffic, .01, drift)
    assert.ok(traffic[0].z < s.z - 140)
    assert.equal(traffic[0].passed, false)
  }
})
test('traffic starts ahead with a safe stagger and density increases gradually', () => {
  const early = Array.from({ length: 10 }, (_, i) => g.spawnTraffic(i, 0, 0, () => .5))
  assert.equal(early[0].z, -140)
  assert.ok(early.every((car, i) => i === 0 || early[i - 1].z - car.z >= 42))
  assert.ok(g.spawnTraffic(1, 0, 10000, () => .5).z > early[1].z)
  assert.ok(g.spawnTraffic(1, 0, 0, () => .5, 10000).z > early[1].z)
  assert.equal(g.trafficCountForScore(0), g.TRAFFIC_BASE)
  assert.ok(g.trafficCountForScore(8000) > g.TRAFFIC_BASE)
  assert.equal(g.trafficCountForScore(1e9), g.TRAFFIC_MAX)
})
test('local leaderboard sorts scores, resolves ties by distance, caps at ten, and ignores invalid data', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i), score: i * 100, distance: i * 10, combo: 2, nearMisses: 1, date: new Date().toISOString() }))
  const ranked = g.rankRun(rows, { ...rows[11], id: 'winner', distance: 2000 })
  assert.equal(ranked.length, 10)
  assert.equal(ranked[0].id, 'winner')
  globalThis.localStorage = { getItem: () => JSON.stringify([...rows, { id: 'invalid', score: 'no' }]) }
  assert.equal(g.readLeaderboard().length, 10)
  globalThis.localStorage = { getItem: () => '{invalid' }
  assert.deepEqual(g.readLeaderboard(), [])
  globalThis.localStorage = { getItem: () => { throw Error('blocked') } }
  assert.deepEqual(g.readLeaderboard(), [])
})

test('startup has no chain timeout; leaving the road still ends a fresh run', () => {
  const s = g.newRun()
  for (let i = 0; i < 600; i++) g.stepScore(s, 1 / 60, 20, 0, true)
  assert.equal(s.crashed, false)
  g.stepScore(s, 1 / 60, 20, 0, false)
  assert.equal(s.crashed, true)
  assert.match(s.event, /OFF ROAD/)
})
test('ended runs freeze scoring and traffic and a new run starts clean', () => {
  const s = { ...initialDriving(), ...g.newRun() }
  g.stepScore(s, .1, 30, .35, true)
  g.stepScore(s, 1.6, 30, 0, true)
  const before = { ...s }
  const traffic = [{ x: 3, z: 6, speed: 15, passed: false }]
  assert.equal(g.stepScore(s, 1, 30, .35, true), false)
  assert.equal(g.stepTraffic(s, traffic, 1, true), false)
  assert.deepEqual(s, before)
  assert.equal(traffic[0].z, 6)
  const fresh = g.newRun()
  assert.equal(fresh.crashed, false)
  assert.equal(fresh.direction, 0)
  assert.equal(fresh.grace, 0)
})
test('road mascots award combo points on hit, explode, and do not end the run', () => {
  const s = { ...initialDriving(), ...g.newRun(), x: 0, z: 0, combo: 2 }
  const bird = { pathZ: 0, x: 0, z: 0, lane: 0, phase: 'idle', phaseT: 0 }
  g.stepMascots(s, [bird], .01)
  assert.equal(s.crashed, false)
  assert.equal(s.score, g.MASCOT_POINTS * 2)
  assert.equal(bird.phase, 'explode')
  assert.match(s.event, /CHICKEN HIT/)
  const score = s.score
  g.stepMascots(s, [bird], .01)
  assert.equal(s.score, score)
  assert.equal(bird.phase, 'explode')
  g.stepMascots(s, [bird], g.MASCOT_EXPLODE)
  assert.equal(bird.phase, 'idle')
  assert.ok(bird.pathZ < s.z - 200)
  assert.equal(g.overlapsMascot(0, 0, { x: 0, z: 0, pathZ: 0, lane: 0, phase: 'idle', phaseT: 0 }), true)
  assert.equal(g.overlapsMascot(0, 0, { x: 9, z: 0, pathZ: 0, lane: 0, phase: 'idle', phaseT: 0 }), false)
})
test('road mascots spawn ahead on lanes and recycle behind the car', () => {
  const pack = Array.from({ length: g.MASCOT_COUNT }, (_, i) => g.spawnMascot(i, 0, () => .5))
  assert.ok(pack.every(m => m.pathZ < -200))
  assert.ok(pack.every((m, i) => i === 0 || pack[i - 1].pathZ > m.pathZ))
  const s = { ...initialDriving(), ...g.newRun(), z: 0 }
  const passed = { pathZ: 50, x: 0, z: 50, lane: 0, phase: 'idle', phaseT: 0 }
  g.stepMascots(s, [passed], .01)
  assert.ok(passed.pathZ < -200)
  assert.equal(passed.phase, 'idle')
})
