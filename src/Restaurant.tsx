import { Suspense, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame, useLoader } from '@react-three/fiber'
import { useTexture } from '@react-three/drei'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import * as THREE from 'three'
import { roadsidePose, wrapAlongRoad } from './road'

const ROOT = '/restaurant'

type Spot = { side: number; dist: number; pathZ: number; scale: number; yawBias: number }

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable roadside spots that follow the curved highway. Kept light for mobile. */
export function restaurantPlacements(seed = 42): Spot[] {
  const rand = mulberry32(seed)
  const spots: Spot[] = []
  const count = 4
  const spacing = 160
  for (let i = 0; i < count; i++) {
    spots.push({
      side: i % 2 === 0 ? -1 : 1,
      dist: 28 + rand() * 12,
      pathZ: 180 - i * spacing - rand() * 20,
      scale: .78 + rand() * .22,
      yawBias: (rand() - .5) * .15,
    })
  }
  return spots
}

const RESTAURANT_SPAN = 160 * 4

let restaurantPrototype: THREE.Object3D | null = null
let restaurantMapBound: THREE.Texture | null = null

function prepareRestaurant(source: THREE.Object3D, map: THREE.Texture) {
  if (restaurantPrototype && restaurantMapBound === map) return restaurantPrototype
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 4
  const clone = source.clone(true)
  clone.traverse(obj => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true
      obj.receiveShadow = true
      obj.frustumCulled = true
      obj.material = new THREE.MeshBasicMaterial({ map, toneMapped: true })
    }
  })
  const box = new THREE.Box3().setFromObject(clone)
  const height = Math.max(.001, box.getSize(new THREE.Vector3()).y)
  clone.scale.setScalar(12 / height)
  box.setFromObject(clone)
  const center = box.getCenter(new THREE.Vector3())
  clone.position.set(-center.x, -box.min.y, -center.z)
  restaurantPrototype = clone
  restaurantMapBound = map
  return clone
}

function RestaurantModel({ scale }: { scale: number }) {
  const source = useLoader(OBJLoader, `${ROOT}/base.obj`)
  const map = useTexture(`${ROOT}/texture_diffuse.jpg`)
  const model = useMemo(() => prepareRestaurant(source, map).clone(true), [source, map])
  useLayoutEffect(() => {
    map.colorSpace = THREE.SRGBColorSpace
    model.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        const material = obj.material as THREE.MeshBasicMaterial
        material.map = map
        material.needsUpdate = true
      }
    })
  }, [map, model])
  return <group scale={scale}><primitive object={model} /></group>
}

export function RoadsideRestaurants({ zRef }: { zRef: MutableRefObject<number> }) {
  const group = useRef<THREE.Group>(null!)
  const placements = useMemo(() => restaurantPlacements(), [])
  useFrame(() => {
    const focus = zRef.current
    placements.forEach((spot, i) => {
      const node = group.current.children[i]
      if (!node) return
      const pathZ = wrapAlongRoad(spot.pathZ, focus, RESTAURANT_SPAN, 140)
      const pose = roadsidePose(pathZ, spot.side, spot.dist)
      // Face the road from the shoulder.
      node.position.set(pose.x, 0, pose.z)
      node.rotation.y = pose.yaw + (spot.side > 0 ? Math.PI / 2 : -Math.PI / 2) + spot.yawBias
      node.visible = true
    })
  })
  return (
    <Suspense fallback={null}>
      <group ref={group}>
        {placements.map((spot, i) => (
          <group key={i} visible={false}>
            <RestaurantModel scale={spot.scale} />
          </group>
        ))}
      </group>
    </Suspense>
  )
}
