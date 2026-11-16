import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, useProgress, Sky } from '@react-three/drei'
import * as THREE from 'three'
import { initialDriving, stepDriving } from './driving'
import {
  newRun, stepScore, stepTraffic, stepMascots, spawnTraffic, spawnMascot,
  trafficCountForScore, TRAFFIC_BASE, TRAFFIC_MAX, MASCOT_COUNT,
} from './gameplay'
import type { RoadMascot } from './gameplay'
import { CollectibleMascot, MascotBuddy, RoadsideMascot } from './Mascot'
import { RoadsideRestaurants } from './Restaurant'
import { buildRoadGeometry, isOnAsphalt, resetRoad, roadCenter, roadsidePose, roadHeading, wrapAlongRoad, ROAD_HALF } from './road'
import { keys, type GraphicsQuality, type Stats } from './gameUi'
import { CAR_URL, TOWER_URL } from './bootAssets'

useGLTF.preload(CAR_URL)
useGLTF.preload(TOWER_URL)

type WheelRig = {
  steers: THREE.Object3D[]
  rolls: THREE.Object3D[]
  baseSteer: THREE.Quaternion[]
  baseRoll: THREE.Quaternion[]
  steerAxis: THREE.Vector3
  rollAxis: THREE.Vector3
}

function PlayerCar({ visual }: { visual: MutableRefObject<{ steering: number; speed: number }> }) {
  const { scene } = useGLTF(CAR_URL)
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
        if (mat && 'metalness' in mat) {
          const m = mat as THREE.MeshStandardMaterial
          m.metalness = Math.min(m.metalness, .08)
          m.roughness = Math.max(m.roughness, .5)
          m.envMapIntensity = 0
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
    const fl1 = find('FL_1'), fr1 = find('FR_1')
    const rolls = ['FL_2', 'FR_2', 'RL_2', 'RR_2'].map(find).filter(Boolean) as THREE.Object3D[]
    if (!fl1 || !fr1 || rolls.length < 4) {
      rig.current = null
      return
    }
    const rollAxis = new THREE.Vector3(1, 0, 0)
    const sample = find('FL_2_WHEEL_0')
    if (sample instanceof THREE.Mesh && sample.geometry) {
      sample.geometry.computeBoundingBox()
      const size = sample.geometry.boundingBox!.getSize(new THREE.Vector3())
      const dims = [size.x, size.y, size.z]
      const axis = dims.indexOf(Math.min(...dims))
      rollAxis.set(axis === 0 ? 1 : 0, axis === 1 ? 1 : 0, axis === 2 ? 1 : 0)
    }
    model.updateMatrixWorld(true)
    const localUp = new THREE.Vector3(0, 1, 0).transformDirection(new THREE.Matrix4().copy(fl1.matrixWorld).invert())
    const au = [Math.abs(localUp.x), Math.abs(localUp.y), Math.abs(localUp.z)]
    const steerI = au.indexOf(Math.max(...au))
    const steerAxis = new THREE.Vector3(steerI === 0 ? 1 : 0, steerI === 1 ? 1 : 0, steerI === 2 ? 1 : 0)
    if (localUp.getComponent(steerI) < 0) steerAxis.multiplyScalar(-1)
    rig.current = {
      steers: [fl1, fr1],
      rolls,
      baseSteer: [fl1, fr1].map(n => n.quaternion.clone()),
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
  running, runId, onStats, onReady, showBuddy, crashed, quality,
}: {
  running: boolean
  runId: number
  onStats: (s: Stats) => void
  onReady: () => void
  showBuddy: boolean
  crashed: boolean
  quality: GraphicsQuality
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
    boot.current = true
    onReady()
  }, [runId, onReady, particles])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, .04), s = state.current
    if (!boot.current) return
    const active = running && !s.crashed
    const steer = active ? Number(keys.has('ArrowLeft') || keys.has('KeyA')) - Number(keys.has('ArrowRight') || keys.has('KeyD')) : 0
    const brake = keys.has('Space') && active
    const gas = active && (keys.has('ArrowUp') || keys.has('KeyW'))
    const slow = active && (keys.has('ArrowDown') || keys.has('KeyS'))
    if (active) {
      const previousZ = s.z
      stepDriving(s, steer, gas, slow, brake, dt)
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
    car.current.position.set(s.x, .06, s.z)
    const lean = THREE.MathUtils.clamp(-s.yawRate * Math.min(s.speed, 40) * .00125, -.26, .26)
    car.current.rotation.set(0, s.yaw, lean)
    speedRef.current = s.speed
    sand.current.position.set(Math.round(s.x / 200) * 200, -.035, Math.round(s.z / 200) * 200)
    const pace = THREE.MathUtils.clamp(s.speed / 55, 0, 1)
    const worldVX = -Math.sin(s.yaw) * s.forward - Math.cos(s.yaw) * s.lateral
    const target = new THREE.Vector3(s.x - worldVX * .12, 3.8 - pace * .8, s.z + 8 + pace * 1.5)
    if (crashed) target.set(s.x + 3.5, 5.2, s.z + 10)
    else if (!running) target.set(roadCenter(s.z) + 8, 5.5, s.z + 11)
    camera.position.lerp(target, 1 - Math.exp(-dt * (crashed ? 4 : 9)))
    camera.lookAt(s.x + (crashed ? 0 : worldVX * .18), crashed ? 1.2 : .9, s.z - (crashed ? 4 : 16))
    if (camera instanceof THREE.PerspectiveCamera) {
      const fov = crashed ? 62 : running ? 58 + pace * 20 + Math.min(slipAngle, .7) * 6 : 56
      camera.fov = THREE.MathUtils.damp(camera.fov, fov, 3, dt)
      camera.updateProjectionMatrix()
    }
    s.smokeTime += active ? dt : 0
    while (s.smokeTime >= .025) {
      s.smokeTime -= .025
      if (!drift) continue
      for (const side of [-1, 1]) {
        const idx = smokeFree.current.pop()
        if (idx === undefined) continue
        const p = particles[idx]
        p.x = s.x + Math.sin(s.yaw) * 1.8 + Math.cos(s.yaw) * side * .85
        p.z = s.z + Math.cos(s.yaw) * 1.8 - Math.sin(s.yaw) * side * .85
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
        <PlayerCar visual={wheelVisual} />
      </Suspense>
    </group>
    {Array.from({ length: TRAFFIC_MAX }, (_, i) => (
      <group key={i} visible={false} ref={node => { trafficGroups.current[i] = node }}>
        <TrafficCarModel color={['#f08a2c', '#f23d86', '#fff1e4', '#6b3418', '#e7b89a'][i % 5]} />
      </group>
    ))}
    <Suspense fallback={null}>
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

function TrafficCarModel({ color }: { color: string }) {
  return <group>
    <mesh castShadow position={[0, .65, 0]}><boxGeometry args={[1.9, .75, 4.7]} /><meshStandardMaterial color={color} roughness={.4} /></mesh>
    <mesh castShadow position={[0, 1.2, .1]}><boxGeometry args={[1.65, .65, 2.3]} /><meshStandardMaterial color="#23343c" metalness={.3} roughness={.2} /></mesh>
    <mesh position={[0, 1.55, .15]}><boxGeometry args={[1.7, .12, 2.2]} /><meshStandardMaterial color={color} /></mesh>
    {[-1, 1].map(side => <group key={side}>
      {[-1.5, 1.5].map(z => <mesh key={z} rotation-z={Math.PI / 2} position={[side * .96, .38, z]}><cylinderGeometry args={[.37, .37, .22, 12]} /><meshStandardMaterial color="#202323" /></mesh>)}
      <mesh position={[side * .65, .76, 2.36]}><boxGeometry args={[.45, .22, .04]} /><meshStandardMaterial color="#fa3e24" emissive="#fa3e24" emissiveIntensity={2} /></mesh>
      <mesh position={[side * .65, .76, -2.36]}><boxGeometry args={[.45, .22, .04]} /><meshStandardMaterial color="#fff3c4" /></mesh>
    </group>)}
  </group>
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
}: {
  running: boolean
  runId: number
  onStats: (s: Stats) => void
  onReady: () => void
  showBuddy: boolean
  crashed: boolean
  quality: GraphicsQuality
}) {
  return (
    <Canvas
      shadows={quality.shadows}
      camera={{ position: [8, 5.5, 11], fov: 56 }}
      dpr={quality.dpr}
      gl={{ antialias: quality.antialias, toneMapping: THREE.ACESFilmicToneMapping, powerPreference: 'high-performance' }}
    >
      <AssetGate onReady={onReady} />
      <World
        running={running}
        runId={runId}
        onStats={onStats}
        onReady={() => {}}
        showBuddy={showBuddy}
        crashed={crashed}
        quality={quality}
      />
    </Canvas>
  )
}
