import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useProgress, Sky } from '@react-three/drei'
import * as THREE from 'three'
import { DEFAULT_FEEL, initialDriving, stepDriving, type DriveFeel } from './driving'
import {
  newRun, stepScore, stepTraffic, stepMascots, spawnTraffic, spawnMascot,
  trafficCountForScore, TRAFFIC_BASE, TRAFFIC_MAX, MASCOT_COUNT,
} from './gameplay'
import type { RoadMascot } from './gameplay'
import { CollectibleMascot, MascotBuddy, RoadsideMascot } from './Mascot'
import { RoadsideRestaurants } from './Restaurant'
import { buildRoadGeometry, isOnAsphalt, resetRoad, roadCenter, roadsidePose, roadHeading, wrapAlongRoad, ROAD_HALF } from './road'
import { keys, steerAxis, type GraphicsQuality, type Stats } from './gameUi'
import { CAR_URL, TOWER_URL } from './bootAssets'
import { TRAFFIC_URLS } from './cars'

useGLTF.preload(TOWER_URL)

type WheelRig = {
  steers: THREE.Object3D[]
  rolls: THREE.Object3D[]
  baseSteer: THREE.Quaternion[]
  baseRoll: THREE.Quaternion[]
  steerAxis: THREE.Vector3
  rollAxis: THREE.Vector3
}

function PlayerCar({
  visual,
  carUrl,
}: {
  visual: MutableRefObject<{ steering: number; speed: number }>
  carUrl: string
}) {
  const { scene } = useGLTF(carUrl)
  const spin = useRef(0)
  const root = useRef<THREE.Group>(null!)
  const rig = useRef<WheelRig | null>(null)
  const scratch = useMemo(() => ({
    q: new THREE.Quaternion(),
    axis: new THREE.Vector3(),
    pos: new THREE.Vector3(),
  }), [])
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = true
      o.receiveShadow = true
      o.frustumCulled = true
      if (o.name.includes('Ddsen') && !o.name.includes('WHEEL') && !o.name.includes('FL_2') && !o.name.includes('FR_2') && !o.name.includes('RL_2') && !o.name.includes('RR_2')) {
        const src = (Array.isArray(o.material) ? o.material[0] : o.material) as THREE.MeshStandardMaterial
        const map = src?.map ?? null
        if (map) { map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true }
        o.material = new THREE.MeshBasicMaterial({ map, toneMapped: true })
        return
      }
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach(mat => {
        if (!mat) return
        const name = (mat.name || '').toLowerCase()
        const isGlass = name.includes('glass') || name.includes('window') || name.includes('ambar')
        if ('metalness' in mat) {
          const m = mat as THREE.MeshStandardMaterial
          m.metalness = Math.min(m.metalness, .08)
          m.roughness = Math.max(m.roughness, .5)
          m.envMapIntensity = 0
          if (!isGlass) {
            m.transparent = false
            m.opacity = 1
            m.depthWrite = true
            m.alphaTest = 0
            m.side = THREE.FrontSide
          }
        }
      })
    })
    let box = new THREE.Box3().setFromObject(clone)
    const dimensions = box.getSize(new THREE.Vector3())
    clone.rotation.y = dimensions.x > dimensions.z ? Math.PI / 2 : Math.PI
    box = new THREE.Box3().setFromObject(clone)
    clone.scale.multiplyScalar(4.7 / box.getSize(new THREE.Vector3()).z)
    box = new THREE.Box3().setFromObject(clone)
    const center = box.getCenter(new THREE.Vector3())
    clone.position.set(-center.x, -box.min.y, -center.z)
    return clone
  }, [scene])
  useEffect(() => {
    const find = (name: string) => model.getObjectByName(name)
    const steers = (['FL_1', 'FR_1'] as const).map(find).filter(Boolean) as THREE.Object3D[]
    const rolls = (['FL_2', 'FR_2', 'RL_2', 'RR_2'] as const).map(find).filter(Boolean) as THREE.Object3D[]
    // Tray car uses 4 wheels; tuk-tuk can ship 3 (front + 2 rear).
    if (steers.length < 1 || rolls.length < 3) {
      rig.current = null
      return
    }
    model.updateMatrixWorld(true)
    // Axle = car local +X (right) in the first wheel's local space, snapped to a cardinal axis.
    const invRoll = new THREE.Matrix4().copy(rolls[0].matrixWorld).invert()
    const rollAxis = new THREE.Vector3(1, 0, 0).transformDirection(model.matrixWorld).transformDirection(invRoll)
    if (rollAxis.lengthSq() < 1e-8) rollAxis.set(1, 0, 0)
    else {
      rollAxis.normalize()
      const ax = Math.abs(rollAxis.x), ay = Math.abs(rollAxis.y), az = Math.abs(rollAxis.z)
      if (ax >= ay && ax >= az) rollAxis.set(Math.sign(rollAxis.x) || 1, 0, 0)
      else if (ay >= az) rollAxis.set(0, Math.sign(rollAxis.y) || 1, 0)
      else rollAxis.set(0, 0, Math.sign(rollAxis.z) || 1)
    }
    const pivot = steers[0]
    const localUp = new THREE.Vector3(0, 1, 0).transformDirection(new THREE.Matrix4().copy(pivot.matrixWorld).invert())
    const au = [Math.abs(localUp.x), Math.abs(localUp.y), Math.abs(localUp.z)]
    const steerI = au.indexOf(Math.max(...au))
    const steerAxis = new THREE.Vector3(steerI === 0 ? 1 : 0, steerI === 1 ? 1 : 0, steerI === 2 ? 1 : 0)
    if (localUp.getComponent(steerI) < 0) steerAxis.multiplyScalar(-1)
    rig.current = {
      steers,
      rolls,
      baseSteer: steers.map(n => n.quaternion.clone()),
      baseRoll: rolls.map(n => n.quaternion.clone()),
      steerAxis,
      rollAxis,
    }
  }, [model])
  useFrame((_, dt) => {
    const wheels = rig.current
    if (!wheels) return
    const { steering, speed } = visual.current
    spin.current += (speed / .32) * dt
    const steerAngle = THREE.MathUtils.clamp(steering * 1.4, -.6, .6)
    wheels.steers.forEach((node, i) => {
      scratch.q.setFromAxisAngle(wheels.steerAxis, steerAngle)
      node.quaternion.copy(wheels.baseSteer[i]).multiply(scratch.q)
    })
    wheels.rolls.forEach((node, i) => {
      scratch.q.setFromAxisAngle(wheels.rollAxis, spin.current)
      node.quaternion.copy(wheels.baseRoll[i]).multiply(scratch.q)
    })
  })
  return <group ref={root}><primitive object={model} /></group>
}

/** Shared tower prototype — one material pass, then cheap clones for recycled slots. */
let towerPrototype: THREE.Object3D | null = null
function prepareTower(scene: THREE.Object3D) {
  if (towerPrototype) return towerPrototype
  const clone = scene.clone(true)
  clone.traverse(o => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true
      o.receiveShadow = true
      o.frustumCulled = true
    }
  })
  const box = new THREE.Box3().setFromObject(clone)
  const height = Math.max(0.001, box.getSize(new THREE.Vector3()).y)
  clone.scale.multiplyScalar(1 / height)
  const centered = new THREE.Box3().setFromObject(clone)
  const center = centered.getCenter(new THREE.Vector3())
  clone.position.set(-center.x, -centered.min.y, -center.z)
  towerPrototype = clone
  return clone
}

function TowerModel({ size }: { size: number }) {
  const { scene } = useGLTF(TOWER_URL)
  const model = useMemo(() => prepareTower(scene).clone(true), [scene])
  return <group scale={size}><primitive object={model} /></group>
}

function CurvedRoad({ zRef, runId }: { zRef: MutableRefObject<number>; runId: number }) {
  const asphalt = useRef<THREE.Mesh>(null!)
  const edges = useRef<THREE.Mesh>(null!)
  const dashes = useRef<THREE.Mesh>(null!)
  const builtAt = useRef(Number.POSITIVE_INFINITY)
  const ready = useRef(false)
  const rebuild = (z: number) => {
    if (!asphalt.current || !edges.current || !dashes.current) return
    const geo = buildRoadGeometry(z)
    asphalt.current.geometry.dispose()
    edges.current.geometry.dispose()
    dashes.current.geometry.dispose()
    asphalt.current.geometry = geo.asphalt
    edges.current.geometry = geo.edges
    dashes.current.geometry = geo.dashes
    builtAt.current = z
    ready.current = true
  }
  useEffect(() => {
    builtAt.current = Number.POSITIVE_INFINITY
    ready.current = false
  }, [runId])
  useFrame(() => {
    const z = zRef.current
    // Rebuild less often — 90 units reduces hitch frequency on long runs.
    if (!ready.current || Math.abs(z - builtAt.current) > 90) rebuild(z)
  })
  return (
    <group>
      <mesh ref={asphalt} receiveShadow><bufferGeometry /><meshStandardMaterial color="#3a2c2e" roughness={.94} /></mesh>
      <mesh ref={edges}><bufferGeometry /><meshBasicMaterial color="#ffe0c8" /></mesh>
      <mesh ref={dashes}><bufferGeometry /><meshBasicMaterial color="#ffe7d4" /></mesh>
    </group>
  )
}

function World({
  running, runId, onStats, onReady, showBuddy, crashed, quality, carUrl, carFeel, loadTraffic,
}: {
  running: boolean
  runId: number
  onStats: (s: Stats) => void
  onReady: () => void
  showBuddy: boolean
  crashed: boolean
  quality: GraphicsQuality
  carUrl: string
  carFeel: DriveFeel
  loadTraffic: boolean
}) {
  const car = useRef<THREE.Group>(null!)
  const sand = useRef<THREE.Mesh>(null!)
  const trafficGroups = useRef<(THREE.Group | null)[]>([])
  const traffic = useRef<ReturnType<typeof spawnTraffic>[]>([])
  const mascots = useRef<RoadMascot[]>([])
  const smoke = useRef<THREE.InstancedMesh>(null!)
  const state = useRef({ ...initialDriving(), ...newRun(), tick: 0, smokeTime: 0 })
  const playerZ = useRef(0)
  const boot = useRef(false)
  const wheelVisual = useRef({ steering: 0, speed: 0 })
  const speedRef = useRef(0)
  const particles = useMemo(() => Array.from({ length: 90 }, () => ({ x: 0, z: 0, y: -10, life: 0 })), [])
  const smokeFree = useRef<number[]>([])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const lastHud = useRef<Stats | null>(null)
  const snapCam = useRef(true)
  const enter = useRef({ active: false, t: 0 })
  const prevCarUrl = useRef(carUrl)

  useLayoutEffect(() => {
    boot.current = false
    resetRoad((runId + 1) * 977)
    const spawn = { ...initialDriving(), ...newRun(), tick: 0, smokeTime: 0 }
    spawn.x = roadCenter(0)
    spawn.z = 0
    spawn.yaw = roadHeading(0)
    state.current = spawn
    traffic.current = Array.from({ length: TRAFFIC_BASE }, (_, i) => spawnTraffic(i, 0, 0))
    mascots.current = Array.from({ length: MASCOT_COUNT }, (_, i) => spawnMascot(i, 0))
    particles.forEach(p => { p.life = 0 })
    smokeFree.current = particles.map((_, i) => i)
    wheelVisual.current = { steering: 0, speed: 0 }
    playerZ.current = 0
    lastHud.current = null
    snapCam.current = true
    enter.current = { active: false, t: 0 }
    boot.current = true
    onReady()
  }, [runId, onReady, particles])

  useEffect(() => {
    if (prevCarUrl.current === carUrl) return
    prevCarUrl.current = carUrl
    // New car drifts into place instead of popping on the spot.
    enter.current = { active: true, t: 0 }
  }, [carUrl])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, .04), s = state.current
    if (!boot.current) return
    const active = running && !s.crashed
    // QWERTY A/D/W + AZERTY Q/D/Z (CrazyGames quality guideline).
    const keyboardSteer = Number(keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('KeyQ'))
      - Number(keys.has('ArrowRight') || keys.has('KeyD'))
    const analog = steerAxis.value
    const steer = active
      ? Math.max(-1, Math.min(1, Math.abs(analog) > 0.02 ? analog : keyboardSteer))
      : 0
    const brake = keys.has('Space') && active
    const gas = active && (keys.has('ArrowUp') || keys.has('KeyW') || keys.has('KeyZ'))
    const slow = active && (keys.has('ArrowDown') || keys.has('KeyS'))
    if (active) {
      const previousZ = s.z
      stepDriving(s, steer, gas, slow, brake, dt, carFeel)
      const progress = Math.max(0, previousZ - s.z)
      s.distance += progress
      if (isOnAsphalt(s.x, s.z)) s.score += progress * .15
    }
    playerZ.current = s.z
    wheelVisual.current.steering += ((active ? steer * .5 : 0) - wheelVisual.current.steering) * Math.min(1, dt * 12)
    wheelVisual.current.speed = active ? s.speed : 0
    const onAsphalt = isOnAsphalt(s.x, s.z)
    const signedSlip = Math.atan2(s.lateral, s.forward)
    const slipAngle = Math.abs(signedSlip)
    let drift = active && stepScore(s, dt, s.speed, signedSlip, onAsphalt)
    if (active) {
      const want = trafficCountForScore(s.score)
      while (traffic.current.length < want) {
        const ahead = Math.min(s.z - 140, ...traffic.current.map(t => t.pathZ))
        traffic.current.push(spawnTraffic(traffic.current.length, ahead + 140, s.distance, Math.random, s.score))
      }
      drift = stepTraffic(s, traffic.current, dt, drift)
      stepMascots(s, mascots.current, dt)
    }
    for (let i = 0; i < TRAFFIC_MAX; i++) {
      const node = trafficGroups.current[i]
      if (!node) continue
      const other = traffic.current[i]
      if (!other) {
        node.visible = false
        continue
      }
      node.visible = true
      node.position.set(other.x, .06, other.z)
      node.rotation.y = roadHeading(other.pathZ)
    }
    let lean = THREE.MathUtils.clamp(-s.yawRate * Math.min(s.speed, 40) * .00125, -.26, .26)
    let displayX = s.x
    let displayZ = s.z
    let displayYaw = s.yaw
    let enterDrift = false
    if (enter.current.active) {
      enter.current.t = Math.min(1, enter.current.t + dt / 2.75)
      const u = enter.current.t
      // Smoothstep ease-in-out — soft start and soft settle.
      const e = u * u * (3 - 2 * u)
      const remain = 1 - e
      const back = 30 * remain
      const side = 6.2 * Math.sin(Math.PI * remain)
      const yaw = s.yaw
      displayX = s.x + Math.cos(yaw) * side + Math.sin(yaw) * back
      displayZ = s.z - Math.sin(yaw) * side + Math.cos(yaw) * back
      displayYaw = yaw - 0.58 * remain
      lean = -0.16 * remain
      wheelVisual.current.speed = 26 * (0.4 + 0.6 * remain)
      wheelVisual.current.steering = -0.34 * remain
      enterDrift = remain > 0.12
      if (u >= 1) enter.current.active = false
    }
    car.current.position.set(displayX, .06, displayZ)
    car.current.rotation.set(0, displayYaw, lean)
    speedRef.current = enter.current.active ? wheelVisual.current.speed : s.speed
    sand.current.position.set(Math.round(s.x / 200) * 200, -.035, Math.round(s.z / 200) * 200)
    const pace = THREE.MathUtils.clamp((enter.current.active ? wheelVisual.current.speed : s.speed) / 55, 0, 1)
    const worldVX = -Math.sin(s.yaw) * s.forward - Math.cos(s.yaw) * s.lateral
    const target = new THREE.Vector3(displayX - worldVX * .12, 3.8 - pace * .8, displayZ + 8 + pace * 1.5)
    if (crashed && !enter.current.active) target.set(s.x + 3.5, 5.2, s.z + 10)
    else if (!running && !enter.current.active) target.set(roadCenter(s.z) + 8, 5.5, s.z + 11)
    else if (!running && enter.current.active) target.set(displayX + 7, 5.2, displayZ + 12)
    if (snapCam.current) {
      camera.position.copy(target)
      snapCam.current = false
    } else {
      camera.position.lerp(target, 1 - Math.exp(-dt * (crashed ? 4 : 9)))
    }
    camera.lookAt(displayX + (crashed && !enter.current.active ? 0 : worldVX * .18), crashed && !enter.current.active ? 1.2 : .9, displayZ - (crashed && !enter.current.active ? 4 : 16))
    if (camera instanceof THREE.PerspectiveCamera) {
      const fov = crashed && !enter.current.active ? 62 : running || enter.current.active ? 58 + pace * 20 + Math.min(slipAngle, .7) * 6 : 56
      camera.fov = THREE.MathUtils.damp(camera.fov, fov, 3, dt)
      camera.updateProjectionMatrix()
    }
    s.smokeTime += (active || enterDrift) ? dt : 0
    while (s.smokeTime >= .025) {
      s.smokeTime -= .025
      if (!(drift || enterDrift)) continue
      for (const side of [-1, 1]) {
        const idx = smokeFree.current.pop()
        if (idx === undefined) continue
        const p = particles[idx]
        p.x = displayX + Math.sin(displayYaw) * 1.8 + Math.cos(displayYaw) * side * .85
        p.z = displayZ + Math.cos(displayYaw) * 1.8 - Math.sin(displayYaw) * side * .85
        p.y = .2
        p.life = 1
      }
    }
    particles.forEach((p, i) => {
      const wasAlive = p.life > 0
      p.life = Math.max(0, p.life - dt * .65)
      if (wasAlive && p.life <= 0) smokeFree.current.push(i)
      p.y += dt * .7
      dummy.position.set(p.x, p.y, p.z)
      dummy.scale.setScalar(p.life > 0 ? (1 - p.life) * 2 + .15 : 0)
      dummy.updateMatrix()
      smoke.current.setMatrixAt(i, dummy.matrix)
    })
    smoke.current.instanceMatrix.needsUpdate = true
    s.tick += dt
    // ~4 Hz HUD updates; always flush on crash so the finish modal appears promptly.
    if (s.tick > .25 || (s.crashed && active)) {
      s.tick = 0
      const next: Stats = {
        speed: s.speed * 3.6,
        score: Math.floor(s.score),
        combo: s.combo,
        drift,
        offroad: !onAsphalt,
        distance: s.distance,
        grace: s.grace,
        crashed: s.crashed,
        longestCombo: s.longestCombo,
        nearMisses: s.nearMisses,
        event: s.eventTime > 0 ? s.event : '',
      }
      const prev = lastHud.current
      const changed = !prev
        || prev.score !== next.score
        || Math.round(prev.speed) !== Math.round(next.speed)
        || prev.combo !== next.combo
        || prev.drift !== next.drift
        || prev.offroad !== next.offroad
        || prev.crashed !== next.crashed
        || prev.grace !== next.grace
        || prev.event !== next.event
        || Math.floor(prev.distance) !== Math.floor(next.distance)
        || prev.nearMisses !== next.nearMisses
      if (changed) {
        lastHud.current = next
        onStats(next)
      }
    }
  })

  return <>
    {quality.sky && <Sky sunPosition={[70, 28, -40]} turbidity={6} rayleigh={1.1} mieCoefficient={0.004} mieDirectionalG={0.8} />}
    <color attach="background" args={['#f3b48a']} />
    <fog attach="fog" args={['#f3b48a', 80, 340]} />
    <ambientLight intensity={1.5} />
    <directionalLight
      position={[-35, 60, 30]}
      intensity={3}
      castShadow={quality.shadows}
      shadow-mapSize={[quality.shadowMap, quality.shadowMap]}
      shadow-camera-left={-65}
      shadow-camera-right={65}
      shadow-camera-top={65}
      shadow-camera-bottom={-65}
    />
    <group ref={car}>
      <Suspense fallback={<mesh><boxGeometry args={[1.8, 1, 4.5]} /><meshStandardMaterial color="#fff1e4" /></mesh>}>
        <PlayerCar key={carUrl} visual={wheelVisual} carUrl={carUrl} />
      </Suspense>
    </group>
    <Suspense fallback={null}>
      {loadTraffic && Array.from({ length: TRAFFIC_MAX }, (_, i) => (
        <group key={i} visible={false} ref={node => { trafficGroups.current[i] = node }}>
          <TrafficCarModel url={TRAFFIC_URLS[i % TRAFFIC_URLS.length]} />
        </group>
      ))}
      <RoadsideMascot hidden={showBuddy} />
      {showBuddy && <MascotBuddy car={car} crashed={crashed} runId={runId} speedRef={speedRef} />}
      {Array.from({ length: MASCOT_COUNT }, (_, i) => (
        <CollectibleMascot key={i} mascots={mascots} index={i} />
      ))}
    </Suspense>
    <mesh ref={sand} rotation-x={-Math.PI / 2} position={[0, -.035, 0]} receiveShadow>
      <planeGeometry args={[quality.sandSize, quality.sandSize]} />
      <meshStandardMaterial color="#e39a58" roughness={1} />
    </mesh>
    <CurvedRoad zRef={playerZ} runId={runId} />
    <RoadPosts zRef={playerZ} />
    <RoadsideScenery zRef={playerZ} />
    <RoadsideRestaurants zRef={playerZ} />
    <instancedMesh ref={smoke} args={[undefined, undefined, 90]} frustumCulled={false}>
      <sphereGeometry args={[.6, 7, 5]} />
      <meshStandardMaterial color="#f0c0a4" transparent opacity={.36} depthWrite={false} />
    </instancedMesh>
  </>
}

function RoadPosts({ zRef }: { zRef: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null!)
  const spacing = 28
  const pairs = 12
  const span = spacing * pairs
  const seeds = useMemo(() => Array.from({ length: pairs * 2 }, (_, i) => ({
    side: i % 2 === 0 ? -1 : 1,
    pathZ: 70 - Math.floor(i / 2) * spacing,
  })), [pairs, spacing])
  useFrame(() => {
    const focus = zRef.current
    for (let i = 0; i < seeds.length; i++) {
      const node = group.current.children[i]
      if (!node) continue
      const seed = seeds[i]
      const pathZ = wrapAlongRoad(seed.pathZ, focus, span, 50)
      const pose = roadsidePose(pathZ, seed.side, ROAD_HALF + 1.8)
      node.position.set(pose.x, .55, pose.z)
      node.visible = true
    }
  })
  return <group ref={group}>{seeds.map((_, i) => <mesh key={i} visible={false}><boxGeometry args={[.16, 1.1, .16]} /><meshStandardMaterial color="#fff1e4" /></mesh>)}</group>
}

function RoadsideScenery({ zRef }: { zRef: MutableRefObject<number> }) {
  const towers = useRef<THREE.Group>(null!)
  const dunes = useRef<THREE.Group>(null!)
  const towerSpacing = 160
  const towerPairs = 3
  const towerSpan = towerSpacing * towerPairs
  const towerSpec = useMemo(() => Array.from({ length: towerPairs * 2 }, (_, i) => ({
    side: i % 2 === 0 ? -1 : 1,
    dist: 32 + (i % 3) * 8,
    size: 24 + (i % 3) * 8,
    pathZ: 100 - Math.floor(i / 2) * towerSpacing,
  })), [towerPairs, towerSpacing])
  const duneSpacing = 55
  const dunePairs = 6
  const duneSpan = duneSpacing * dunePairs
  const duneSpec = useMemo(() => Array.from({ length: dunePairs * 2 }, (_, i) => ({
    side: i % 2 === 0 ? -1 : 1,
    dist: 70 + (i % 4) * 35,
    scale: [22 + i % 3 * 18, 9 + i % 4 * 3, 30] as [number, number, number],
    color: i % 2 ? '#e8883a' : '#f0a0b8',
    pathZ: 100 - Math.floor(i / 2) * duneSpacing,
  })), [dunePairs, duneSpacing])
  useFrame(() => {
    const focus = zRef.current
    towerSpec.forEach((spec, i) => {
      const node = towers.current.children[i]
      if (!node) return
      const pathZ = wrapAlongRoad(spec.pathZ, focus, towerSpan, 120)
      const pose = roadsidePose(pathZ, spec.side, spec.dist)
      node.position.set(pose.x, 0, pose.z)
      node.rotation.y = pose.yaw
      node.visible = true
    })
    duneSpec.forEach((spec, i) => {
      const node = dunes.current.children[i]
      if (!node) return
      const pathZ = wrapAlongRoad(spec.pathZ, focus, duneSpan, 80)
      const pose = roadsidePose(pathZ, spec.side, spec.dist)
      node.position.set(pose.x, -5, pose.z)
      node.visible = true
    })
  })
  return <>
    <group ref={towers}>
      {towerSpec.map((spec, i) => (
        <group key={i} visible={false}>
          <Suspense fallback={null}><TowerModel size={spec.size} /></Suspense>
        </group>
      ))}
    </group>
    <group ref={dunes}>
      {duneSpec.map((spec, i) => (
        <mesh key={i} visible={false} scale={spec.scale}>
          <sphereGeometry args={[1, 8, 6]} />
          <meshStandardMaterial color={spec.color} roughness={1} />
        </mesh>
      ))}
    </group>
  </>
}

/** One prepared prototype per traffic URL — clones share geometry/materials. */
const trafficProtos = new Map<string, THREE.Object3D>()

function prepareTrafficCar(scene: THREE.Object3D) {
  const clone = scene.clone(true)
  clone.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return
    // Traffic never casts shadows — biggest cost saver with 18 cars.
    o.castShadow = false
    o.receiveShadow = false
    o.frustumCulled = true
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    mats.forEach(mat => {
      if (!mat || !('metalness' in mat)) return
      const m = mat as THREE.MeshStandardMaterial
      m.metalness = Math.min(m.metalness, .08)
      m.roughness = Math.max(m.roughness, .5)
      m.envMapIntensity = 0
      const name = (m.name || '').toLowerCase()
      const isGlass = name.includes('glass') || name.includes('window') || name.includes('ambar')
      if (!isGlass) {
        m.transparent = false
        m.opacity = 1
        m.depthWrite = true
      }
    })
  })
  let box = new THREE.Box3().setFromObject(clone)
  const dimensions = box.getSize(new THREE.Vector3())
  clone.rotation.y = dimensions.x > dimensions.z ? Math.PI / 2 : Math.PI
  box = new THREE.Box3().setFromObject(clone)
  clone.scale.multiplyScalar(4.5 / box.getSize(new THREE.Vector3()).z)
  box = new THREE.Box3().setFromObject(clone)
  const center = box.getCenter(new THREE.Vector3())
  clone.position.set(-center.x, -box.min.y, -center.z)
  return clone
}

function TrafficCarModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const model = useMemo(() => {
    let proto = trafficProtos.get(url)
    if (!proto) {
      proto = prepareTrafficCar(scene)
      trafficProtos.set(url, proto)
    }
    return proto.clone(true)
  }, [scene, url])
  return <primitive object={model} />
}

/** Fires once when drei/three loaders finish (or after a safety timeout). */
function AssetGate({ onReady }: { onReady: () => void }) {
  const { active, progress, loaded, total } = useProgress()
  const fired = useRef(false)
  const mark = () => {
    if (fired.current) return
    fired.current = true
    onReady()
  }
  useEffect(() => {
    if (active) return
    if (loaded > 0 && loaded >= total) mark()
    if (progress >= 100 && total > 0) mark()
  }, [active, progress, loaded, total, onReady])
  useEffect(() => {
    // Prefetched assets may never trip the loading manager — settle after parse.
    const id = window.setTimeout(mark, 1600)
    return () => window.clearTimeout(id)
  }, [onReady])
  useEffect(() => {
    const id = window.setTimeout(mark, 14000)
    return () => window.clearTimeout(id)
  }, [onReady])
  return null
}

export default function GameScene({
  running,
  runId,
  onStats,
  onReady,
  showBuddy,
  crashed,
  quality,
  carUrl = CAR_URL,
  carFeel = DEFAULT_FEEL,
  loadTraffic = false,
}: {
  running: boolean
  runId: number
  onStats: (s: Stats) => void
  onReady: () => void
  showBuddy: boolean
  crashed: boolean
  quality: GraphicsQuality
  carUrl?: string
  carFeel?: DriveFeel
  /** Defer traffic GLBs until after Start so initial download stays ≤20MB. */
  loadTraffic?: boolean
}) {
  useEffect(() => {
    useGLTF.preload(carUrl)
  }, [carUrl])

  useEffect(() => {
    if (!loadTraffic) return
    TRAFFIC_URLS.forEach(url => useGLTF.preload(url))
  }, [loadTraffic])

  return (
    <Canvas
      shadows={quality.shadows}
      camera={{ position: [8, 5.5, 11], fov: 56 }}
      dpr={quality.dpr}
      gl={{ antialias: quality.antialias, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: 'high-performance' }}
    >
      <AssetGate onReady={onReady} />
      <Suspense fallback={null}>
        <World
          running={running}
          runId={runId}
          loadTraffic={loadTraffic}
          onStats={onStats}
          onReady={() => {}}
          showBuddy={showBuddy}
          crashed={crashed}
          quality={quality}
          carUrl={carUrl}
          carFeel={carFeel}
        />
      </Suspense>
    </Canvas>
  )
}
