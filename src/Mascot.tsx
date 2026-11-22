import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import type { MutableRefObject } from 'react'

import { MASCOT_ROOT } from './bootAssets'

const ROOT = MASCOT_ROOT

/** Local seat in the player car group — rear deck / trunk (car faces −Z). */
const TRUNK = { x: 0, y: 0.92, z: 1.72 }
const BUDDY_SCALE = 0.52
const JUMP_DURATION = 0.85
const EJECT_DURATION = 1.35

/** One prepared prototype — clones share materials/textures, frustum cull when off-screen. */
let mascotPrototype: THREE.Group | null = null
let mascotMapBound: THREE.Texture | null = null

function prepareMascot(source: THREE.Group, map: THREE.Texture) {
  if (mascotPrototype && mascotMapBound === map) return mascotPrototype
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  const root = source.clone(true) as THREE.Group
  root.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
      obj.frustumCulled = true
      obj.material = new THREE.MeshBasicMaterial({ map, toneMapped: false })
    }
  })
  mascotPrototype = root
  mascotMapBound = map
  return root
}

function MascotModel() {
  const source = useLoader(OBJLoader, `${ROOT}/base.obj`)
  const map = useTexture(`${ROOT}/texture_diffuse.jpg`)
  const model = useMemo(() => prepareMascot(source as THREE.Group, map).clone(true), [source, map])
  useLayoutEffect(() => {
    // Ensure late-loaded texture sticks on this clone.
    map.colorSpace = THREE.SRGBColorSpace
    model.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        const material = obj.material as THREE.MeshBasicMaterial
        material.map = map
        material.needsUpdate = true
      }
    })
  }, [map, model])
  return <primitive object={model} />
}

export function RoadsideMascot({ hidden }: { hidden?: boolean }) {
  const ref = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    const group = ref.current
    if (!group) return
    group.visible = !hidden
    if (hidden) return
    // Stay on the shoulder near spawn — outside the widened 4-lane asphalt.
    group.position.set(18.2, Math.sin(clock.elapsedTime * 1.7) * 0.05, -1.5)
    group.rotation.y = Math.sin(clock.elapsedTime * 0.8) * 0.2
  })
  return <group ref={ref} scale={5.2}><MascotModel /></group>
}

type Phase = 'jump' | 'seated' | 'eject'

export function MascotBuddy({
  car,
  crashed,
  runId,
  speedRef,
}: {
  car: MutableRefObject<THREE.Group>
  crashed: boolean
  runId: number
  speedRef: MutableRefObject<number>
}) {
  const ref = useRef<THREE.Group>(null)
  const phase = useRef<Phase>('jump')
  const animT = useRef(0)
  const scratch = useMemo(() => ({
    trunkWorld: new THREE.Vector3(),
    start: new THREE.Vector3(18.2, 0.2, -1.5),
    mid: new THREE.Vector3(),
    pos: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    jumpFrom: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI * 0.35, 0.4)),
    carQuat: new THREE.Quaternion(),
    flip: new THREE.Quaternion(),
    flipAxis: new THREE.Vector3(1, 0.2, 0).normalize(),
    spinQ: new THREE.Quaternion(),
    spinEuler: new THREE.Euler(0, 0, 0, 'XYZ'),
    ejectPos: new THREE.Vector3(),
    ejectVel: new THREE.Vector3(),
    ejectSpin: new THREE.Vector3(),
    ejectQuat: new THREE.Quaternion(),
    side: new THREE.Vector3(),
    forward: new THREE.Vector3(),
    upKick: new THREE.Vector3(0, 1, 0),
  }), [])

  useEffect(() => {
    phase.current = 'jump'
    animT.current = 0
  }, [runId])

  useEffect(() => {
    if (!crashed || phase.current === 'eject') return
    const group = ref.current
    const body = car.current
    if (!group || !body) return
    phase.current = 'eject'
    animT.current = 0
    group.getWorldPosition(scratch.ejectPos)
    group.getWorldQuaternion(scratch.ejectQuat)
    body.getWorldQuaternion(scratch.carQuat)
    scratch.forward.set(0, 0, -1).applyQuaternion(scratch.carQuat)
    scratch.side.set(1, 0, 0).applyQuaternion(scratch.carQuat)
    const pace = Math.max(6, speedRef.current)
    // Launch up and out the rear / sideways — reads as tumbling out of the trunk.
    scratch.ejectVel
      .copy(scratch.forward)
      .multiplyScalar(-pace * 0.55)
      .addScaledVector(scratch.side, (Math.random() > 0.5 ? 1 : -1) * (4 + pace * 0.12))
    scratch.upKick.set(0, 7 + pace * 0.08, 0)
    scratch.ejectVel.add(scratch.upKick)
    scratch.ejectSpin.set(
      2.8 + Math.random() * 2.2,
      (Math.random() - 0.5) * 4,
      -3.4 - Math.random() * 2,
    )
  }, [crashed, car, speedRef, scratch])

  useFrame(({ clock }, dt) => {
    const group = ref.current
    const body = car.current
    if (!group || !body) return
    const s = scratch
    body.updateMatrixWorld(true)
    s.trunkWorld.set(TRUNK.x, TRUNK.y, TRUNK.z)
    body.localToWorld(s.trunkWorld)
    body.getWorldQuaternion(s.carQuat)

    if (phase.current === 'jump') {
      animT.current = Math.min(1, animT.current + dt / JUMP_DURATION)
      const u = animT.current
      const ease = 1 - Math.pow(1 - u, 3)
      // Arc from the roadside shoulder into the open trunk.
      s.mid.lerpVectors(s.start, s.trunkWorld, 0.5)
      s.mid.y += 4.2
      const a = 1 - ease
      s.pos.set(0, 0, 0)
        .addScaledVector(s.start, a * a)
        .addScaledVector(s.mid, 2 * a * ease)
        .addScaledVector(s.trunkWorld, ease * ease)
      group.position.copy(s.pos)
      s.quat.slerpQuaternions(s.jumpFrom, s.carQuat, ease)
      // Tumble through the leap, settle upright in the trunk.
      s.flip.setFromAxisAngle(s.flipAxis, Math.sin(ease * Math.PI) * 1.1)
      group.quaternion.copy(s.quat).multiply(s.flip)
      if (u >= 1) {
        phase.current = 'seated'
        animT.current = 0
      }
      return
    }

    if (phase.current === 'seated') {
      const bob = Math.sin(clock.elapsedTime * 5.5) * 0.012
      const sway = Math.sin(clock.elapsedTime * 3.2) * 0.02
      s.pos.set(TRUNK.x + sway * 0.15, TRUNK.y + bob, TRUNK.z)
      body.localToWorld(s.pos)
      group.position.copy(s.pos)
      // Face the chase cam (behind the car), not the road ahead.
      group.quaternion.copy(s.carQuat)
      group.rotateX(0.12)
      return
    }

    // Accident: ballistic tumble out of the trunk, then settle on the asphalt.
    animT.current = Math.min(1, animT.current + dt / EJECT_DURATION)
    s.ejectVel.y -= 22 * dt
    s.ejectPos.addScaledVector(s.ejectVel, dt)
    if (s.ejectPos.y < 0.35) {
      s.ejectPos.y = 0.35
      s.ejectVel.y *= -0.28
      s.ejectVel.x *= 0.72
      s.ejectVel.z *= 0.72
      s.ejectSpin.multiplyScalar(0.82)
    }
    group.position.copy(s.ejectPos)
    s.spinEuler.set(s.ejectSpin.x * dt, s.ejectSpin.y * dt, s.ejectSpin.z * dt)
    s.spinQ.setFromEuler(s.spinEuler)
    group.quaternion.multiply(s.spinQ)
  })

  return <group ref={ref} scale={BUDDY_SCALE}><MascotModel /></group>
}

const ROAD_SCALE = 2.65
const BURST = 18

type RoadPickup = { x: number; z: number; phase: 'idle' | 'explode'; phaseT: number }

/** Road pickup — bob while idle; burst apart on collect. */
export function CollectibleMascot({
  mascots,
  index,
}: {
  mascots: MutableRefObject<RoadPickup[]>
  index: number
}) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const burst = useRef<THREE.InstancedMesh>(null)
  const bits = useMemo(() => Array.from({ length: BURST }, () => ({
    vx: 0, vy: 0, vz: 0, life: 0,
  })), [])
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const seeded = useRef(false)

  useFrame(({ clock }) => {
    const group = root.current
    const mesh = body.current
    const cloud = burst.current
    const bird = mascots.current[index]
    if (!group || !mesh || !cloud || !bird) {
      if (group) group.visible = false
      return
    }
    group.visible = true
    group.position.set(bird.x, 0, bird.z)

    if (bird.phase === 'idle') {
      seeded.current = false
      mesh.visible = true
      const bob = Math.sin(clock.elapsedTime * 3.4 + bird.x) * 0.08
      const spin = clock.elapsedTime * 1.1 + bird.z * 0.02
      mesh.position.set(0, 0.35 + bob, 0)
      mesh.rotation.set(0, spin, Math.sin(clock.elapsedTime * 2.1) * 0.08)
      mesh.scale.setScalar(ROAD_SCALE)
      bits.forEach((p, i) => {
        p.life = 0
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        cloud.setMatrixAt(i, dummy.matrix)
      })
      cloud.instanceMatrix.needsUpdate = true
      return
    }

    // Explode: hide the chicken after a quick puff, spray bits outward.
    const t = bird.phaseT
    if (!seeded.current) {
      seeded.current = true
      bits.forEach(p => {
        const a = Math.random() * Math.PI * 2
        const speed = 4 + Math.random() * 9
        p.vx = Math.cos(a) * speed
        p.vz = Math.sin(a) * speed
        p.vy = 3 + Math.random() * 7
        p.life = 1
      })
    }
    const puff = Math.min(1, t / 0.12)
    mesh.visible = t < 0.22
    mesh.position.set(0, 0.4 + t * 1.8, 0)
    mesh.rotation.set(t * 4, t * 8, t * 3)
    mesh.scale.setScalar(ROAD_SCALE * (1 + puff * 1.6) * Math.max(0, 1 - t * 3.2))

    bits.forEach((p, i) => {
      if (p.life <= 0) {
        dummy.scale.setScalar(0)
        dummy.updateMatrix()
        cloud.setMatrixAt(i, dummy.matrix)
        return
      }
      p.life = Math.max(0, 1 - t / 0.65)
      const age = t
      dummy.position.set(p.vx * age, 0.4 + p.vy * age - 9 * age * age, p.vz * age)
      dummy.scale.setScalar(p.life > 0 ? 0.25 + (1 - p.life) * 0.55 : 0)
      dummy.updateMatrix()
      cloud.setMatrixAt(i, dummy.matrix)
    })
    cloud.instanceMatrix.needsUpdate = true
  })

  return (
    <group ref={root} visible={false}>
      <group ref={body}><MascotModel /></group>
      <instancedMesh ref={burst} args={[undefined, undefined, BURST]} frustumCulled={false}>
        <sphereGeometry args={[1, 6, 5]} />
        <meshBasicMaterial color="#f23d86" toneMapped={false} transparent opacity={0.9} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}
