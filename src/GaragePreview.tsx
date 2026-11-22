import { Suspense, useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { useGLTF, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'
import { CAR_URL } from './bootAssets'

function PreviewModel({ url }: { url: string }) {
  const { scene } = useGLTF(url)
  const root = useRef<THREE.Group>(null!)
  const model = useMemo(() => {
    const clone = scene.clone(true)
    clone.traverse(o => {
      if (!(o instanceof THREE.Mesh)) return
      o.castShadow = false
      o.receiveShadow = false
      o.frustumCulled = true
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      mats.forEach(mat => {
        if (mat && 'metalness' in mat) {
          const m = mat as THREE.MeshStandardMaterial
          m.metalness = Math.min(m.metalness, .08)
          m.roughness = Math.max(m.roughness, .45)
          m.envMapIntensity = 0
        }
      })
    })
    let box = new THREE.Box3().setFromObject(clone)
    const size = box.getSize(new THREE.Vector3())
    clone.rotation.y = size.x > size.z ? Math.PI / 2 : Math.PI
    box = new THREE.Box3().setFromObject(clone)
    const len = box.getSize(new THREE.Vector3()).z || 1
    clone.scale.multiplyScalar(3.4 / len)
    box = new THREE.Box3().setFromObject(clone)
    const center = box.getCenter(new THREE.Vector3())
    clone.position.set(-center.x, -box.min.y, -center.z)
    return clone
  }, [scene])

  useFrame((_, dt) => {
    if (root.current) root.current.rotation.y += dt * 0.55
  })

  return <group ref={root}><primitive object={model} /></group>
}

export default function GaragePreview({
  url,
  locked,
  label,
}: {
  url: string
  locked: boolean
  label: string
}) {
  useEffect(() => { useGLTF.preload(url) }, [url])
  return (
    <div className={`garage-preview${locked ? ' is-locked' : ''}`} aria-label={label}>
      <Canvas
        camera={{ position: [3.2, 1.6, 4.2], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
      >
        <color attach="background" args={['#2a120e']} />
        <ambientLight intensity={1.15} />
        <directionalLight position={[4, 6, 2]} intensity={1.6} />
        <directionalLight position={[-3, 2, -2]} intensity={0.45} />
        <Suspense fallback={null}>
          <PreviewModel url={url || CAR_URL} />
          <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={8} blur={2.2} far={4} />
        </Suspense>
      </Canvas>
      {locked && <span className="garage-preview-lock" aria-hidden="true">▣</span>}
    </div>
  )
}
