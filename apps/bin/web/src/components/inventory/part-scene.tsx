import { OrbitControls } from "@react-three/drei"
import { Canvas, useFrame } from "@react-three/fiber"
import { useEffect, useMemo, useRef, useState, type RefObject } from "react"
import {
  Box3,
  Mesh,
  Vector3,
  type Group,
  type Material,
  type Object3D,
} from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

// Seconds-per-turn is 2π / this. About one turn every ten seconds.
const SPIN_SPEED = 0.6

function disposeModel(root: Object3D) {
  root.traverse((object) => {
    if (object instanceof Mesh) {
      object.geometry.dispose()
      const materials: Material[] = Array.isArray(object.material)
        ? object.material
        : [object.material]
      for (const material of materials) material.dispose()
    }
  })
}

// Centers the model, scales its longest side to 2 units, and turns it.
function Turntable({
  object,
  dragging,
  onReady,
}: {
  object: Object3D
  dragging: RefObject<boolean>
  onReady: () => void
}) {
  const turntable = useRef<Group>(null)
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(object)
    const size = box.getSize(new Vector3())
    return {
      scale: 2 / Math.max(size.x, size.y, size.z, 1e-6),
      center: box.getCenter(new Vector3()),
    }
  }, [object])
  const reducedMotion = useMemo(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  )

  useEffect(onReady, [onReady])
  useFrame((_, delta) => {
    if (turntable.current && !reducedMotion && !dragging.current) {
      turntable.current.rotation.y += delta * SPIN_SPEED
    }
  })

  return (
    <group ref={turntable}>
      <group scale={fit.scale}>
        <primitive
          object={object}
          position={[-fit.center.x, -fit.center.y, -fit.center.z]}
        />
      </group>
    </group>
  )
}

export default function PartScene({
  url,
  onReady,
  onError,
}: {
  url: string
  onReady: () => void
  onError: () => void
}) {
  const [model, setModel] = useState<Object3D | null>(null)
  const dragging = useRef(false)

  useEffect(() => {
    let disposed = false
    let loaded: Object3D | undefined
    new GLTFLoader()
      .loadAsync(url)
      .then((gltf) => {
        if (disposed) {
          disposeModel(gltf.scene)
          return
        }
        loaded = gltf.scene
        setModel(gltf.scene)
      })
      .catch(() => {
        if (!disposed) onError()
      })
    return () => {
      disposed = true
      if (loaded) disposeModel(loaded)
    }
  }, [url, onError])

  return (
    <Canvas
      camera={{ position: [2.7, 2, 2.7], fov: 32 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      style={{ position: "absolute", inset: 0 }}
    >
      <hemisphereLight args={[0xffffff, 0x3a3a46, 1.4]} />
      <directionalLight position={[3, 5, 4]} intensity={2.4} />
      <directionalLight position={[-4, -2, -3]} intensity={0.8} />
      {model ? (
        <Turntable object={model} dragging={dragging} onReady={onReady} />
      ) : null}
      {/* Drag to look around. Wheel zoom would trap the scrolling of the pane. */}
      <OrbitControls
        enableZoom={false}
        enablePan={false}
        enableDamping
        onStart={() => {
          dragging.current = true
        }}
        onEnd={() => {
          dragging.current = false
        }}
      />
    </Canvas>
  )
}
