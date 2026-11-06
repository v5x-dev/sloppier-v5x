// The 3D workspace. An orbit camera, perspective or orthographic, looks at the ground grid
// and the Parts in the document. Placing a Part follows the pointer and snaps to nearby
// Snap Points. Clicking selects a Part, or places the one being placed.

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import type { PerspectiveCamera } from "three"
import {
  AxesHelper,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  Vector2,
  Vector3,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { useEffect, useRef } from "react"
import type * as Y from "yjs"
import { partsMap, placePart, readPlacedParts } from "@/design/document"
import type { PartRef, Quat } from "@/design/model"
import { canDraw, partShape } from "@/design/library"
import {
  START_TURN,
  placementPose,
  type PlacementTurn,
} from "@/design/placement"
import type { Vec3 } from "@/catalog/types"
import type { WorldSnap } from "@/design/snap"
import { readSceneColors } from "./colors"
import { createGrid } from "./grid"
import { ModelLoader, type ModelStatus } from "./models"
import { DEFAULT_COLORS, SceneStore } from "./scene-store"
import { INITIAL_STATUS, type Projection, type ViewportStatus } from "./status"

export type { Projection, ViewportStatus } from "./status"

export type ViewportProps = {
  doc: Y.Doc
  /** The models base, or undefined when it is not configured. */
  modelsBase: string | undefined
  /** The Part being placed, or none. */
  tool: PartRef | undefined
  selectedId: string | undefined
  projection: Projection
  onSelect: (id: string | undefined) => void
  onCancelTool: () => void
  onDelete: (id: string) => void
  onToggleProjection: () => void
  onStatus: (status: ViewportStatus) => void
}

const FOV = 35
const CLICK_SLOP_PX = 5
const TARGET = new Vector3(0, 40, 0)
const INITIAL_POSITION: [number, number, number] = [760, 640, 760]

// Module-level so the canvas sees the same props on every render. A new object per render
// would make react-three-fiber reconfigure the renderer.
const GL_OPTIONS = { antialias: true, toneMapping: NeutralToneMapping }
const CAMERA_OPTIONS = {
  fov: FOV,
  near: 1,
  far: 60000,
  position: INITIAL_POSITION,
}
const CANVAS_STYLE = { touchAction: "none" }

export default function DesignViewport(props: ViewportProps) {
  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      gl={GL_OPTIONS}
      camera={CAMERA_OPTIONS}
      style={CANVAS_STYLE}
    >
      <Workspace {...props} />
    </Canvas>
  )
}

/** The mutable state of the workspace. Kept in a ref so pointer events never re-render React. */
type Live = {
  store?: SceneStore
  perspective?: PerspectiveCamera
  ortho?: OrthographicCamera
  active?: PerspectiveCamera | OrthographicCamera
  controls?: OrbitControls
  frustumHeight: number
  ndc?: Vector2
  down?: { x: number; y: number }
  turn: PlacementTurn
  pose?: { position: Vec3; rotation: Quat }
  snapTarget?: WorldSnap
  frame?: number
  status: ViewportStatus
}

function Workspace(props: ViewportProps) {
  const { gl, scene, size, invalidate, camera, set } = useThree()
  // The canvas's own camera. `camera` above changes when the projection switches, and the
  // scene must not be rebuilt for that.
  const perspectiveCamera = useRef(camera as PerspectiveCamera).current
  const latest = useRef(props)
  latest.current = props
  const live = useRef<Live>({
    frustumHeight: 1000,
    turn: START_TURN,
    status: INITIAL_STATUS,
  })

  const emit = (patch: Partial<ViewportStatus>) => {
    const current = live.current.status
    const next = { ...current, ...patch }
    if (JSON.stringify(next) === JSON.stringify(current)) return
    live.current.status = next
    latest.current.onStatus(next)
  }

  // The scene, lights, grid, and cameras. Built once per canvas.
  useEffect(() => {
    const state = live.current
    const colors = readSceneColors()
    scene.background = colors.background
    const hemi = new HemisphereLight(colors.highlight, colors.background, 1.1)
    const key = new DirectionalLight(0xffffff, 1.4)
    key.position.set(500, 900, 380)
    scene.add(hemi, key)
    const pmrem = new PMREMGenerator(gl)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = environment
    pmrem.dispose()
    const grid = createGrid(colors)
    scene.add(grid.mesh)
    const axes = new AxesHelper(60)
    axes.position.y = 0.2
    scene.add(axes)

    const perspective = perspectiveCamera
    const ortho = new OrthographicCamera(-500, 500, 500, -500, 1, 60000)
    // Stops react-three-fiber resetting this frustum to pixel units on a resize.
    Object.assign(ortho, { manual: true })
    state.perspective = perspective
    state.ortho = ortho
    state.active = perspective

    const controls = new OrbitControls(perspective, gl.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.12
    controls.minDistance = 20
    controls.maxDistance = 20000
    controls.target.copy(TARGET)
    controls.update()
    const onChange = () => invalidate()
    controls.addEventListener("change", onChange)
    state.controls = controls

    const loader = new ModelLoader(
      latest.current.modelsBase,
      (status: ModelStatus) =>
        emit({ modelsLoading: status.loading, modelsFailed: status.failed })
    )
    const store = new SceneStore(scene, colors, loader, () => invalidate())
    state.store = store

    const map = partsMap(latest.current.doc)
    const sync = () => {
      const { parts, invalid } = readPlacedParts(latest.current.doc)
      const drawable = parts.filter(canDraw)
      store.sync(drawable)
      emit({
        parts: drawable.length,
        invalid: invalid.length + parts.length - drawable.length,
      })
    }
    sync()
    map.observeDeep(sync)
    // For benchmarks/viewport.mjs: the dev server only, never a production build.
    if (import.meta.env.DEV)
      Object.assign(window, {
        __designBench: {
          doc: latest.current.doc,
          renderer: gl,
          store,
          placePart,
        },
      })

    const onContextLost = (event: Event) => {
      event.preventDefault()
      emit({ contextLost: true })
    }
    gl.domElement.addEventListener("webglcontextlost", onContextLost)
    invalidate()

    return () => {
      map.unobserveDeep(sync)
      gl.domElement.removeEventListener("webglcontextlost", onContextLost)
      controls.removeEventListener("change", onChange)
      controls.dispose()
      store.dispose()
      grid.mesh.geometry.dispose()
      scene.remove(hemi, key, grid.mesh, axes)
      scene.environment = null
      environment.dispose()
      state.store = undefined
      state.controls = undefined
      if (state.frame) cancelAnimationFrame(state.frame)
    }
    // Built once per canvas: the document, camera, and renderer do not change identity during a session.
  }, [props.doc, gl, scene, perspectiveCamera, invalidate])

  // Switches between perspective and orthographic, keeping the view the same.
  useEffect(() => {
    const state = live.current
    const { controls, perspective, ortho } = state
    if (!controls || !perspective || !ortho) return
    const aspect = size.width / Math.max(1, size.height)
    if (props.projection === "orthographic" && state.active !== ortho) {
      const distance = perspective.position.distanceTo(controls.target)
      const height = 2 * distance * Math.tan((perspective.fov * Math.PI) / 360)
      state.frustumHeight = height
      ortho.position.copy(perspective.position)
      ortho.zoom = 1
      setFrustum(ortho, height, aspect)
      ortho.lookAt(controls.target)
      state.active = ortho
    } else if (
      props.projection === "perspective" &&
      state.active !== perspective
    ) {
      const height = state.frustumHeight / ortho.zoom
      const distance = height / (2 * Math.tan((FOV * Math.PI) / 360))
      const direction = ortho.position.clone().sub(controls.target).normalize()
      perspective.position
        .copy(controls.target)
        .addScaledVector(direction, distance)
      perspective.lookAt(controls.target)
      perspective.aspect = aspect
      perspective.updateProjectionMatrix()
      state.active = perspective
    } else return
    controls.object = state.active
    controls.update()
    set({ camera: state.active })
    invalidate()
  }, [props.projection, set, invalidate, size])

  // Keeps the orthographic frustum matched to the canvas.
  useEffect(() => {
    const state = live.current
    if (!state.ortho) return
    setFrustum(
      state.ortho,
      state.frustumHeight,
      size.width / Math.max(1, size.height)
    )
    invalidate()
  }, [size, invalidate])

  useFrame(() => {
    live.current.controls?.update()
  })

  // Pointer and keyboard.
  useEffect(() => {
    const canvas = gl.domElement
    const ndcOf = (event: PointerEvent): Vector2 => {
      const rect = canvas.getBoundingClientRect()
      return new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
    }
    const activeCamera = () => live.current.active ?? camera

    const refresh = () => {
      const state = live.current
      state.frame = undefined
      const store = state.store
      if (!store || !state.ndc) return
      const cam = activeCamera()
      const tool = latest.current.tool
      if (!tool) {
        const hovered = store.pick(state.ndc, cam)
        store.highlight("hover", hovered)
        canvas.style.cursor = hovered ? "pointer" : "default"
        store.setGhost(undefined, undefined, undefined)
        store.setSnapMarker(undefined)
        state.pose = undefined
        state.snapTarget = undefined
        emit({ snap: null })
        return
      }
      canvas.style.cursor = "crosshair"
      store.highlight("hover", undefined)
      const ground = store.groundAt(state.ndc, cam)
      if (!ground) return
      const shape = partShape(tool)
      const result = placementPose(
        shape,
        ground,
        state.turn,
        store.index,
        store.rayAt(state.ndc, cam)
      )
      state.pose = {
        position: result.pose.position,
        rotation: result.pose.rotation,
      }
      store.setGhost(
        tool,
        result.pose,
        DEFAULT_COLORS[shape.catalog.material],
        Boolean(result.snap)
      )
      if (result.snap) {
        state.snapTarget = result.snap.target
        store.setSnapMarker(result.snap.target)
        emit({ snap: "snapped" })
      } else {
        state.snapTarget = undefined
        store.setSnapMarker(undefined)
        emit({ snap: null })
      }
      invalidate()
    }
    const schedule = () => {
      const state = live.current
      if (state.frame === undefined)
        state.frame = requestAnimationFrame(refresh)
    }

    const onMove = (event: PointerEvent) => {
      live.current.ndc = ndcOf(event)
      schedule()
    }
    const onDown = (event: PointerEvent) => {
      live.current.down = { x: event.clientX, y: event.clientY }
    }
    const onUp = (event: PointerEvent) => {
      const state = live.current
      const down = state.down
      state.down = undefined
      if (
        !down ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) >
          CLICK_SLOP_PX
      )
        return
      const store = state.store
      if (!store) return
      const tool = latest.current.tool
      if (tool) {
        if (!state.pose) return
        const color = DEFAULT_COLORS[partShape(tool).catalog.material]
        placePart(latest.current.doc, {
          ...tool,
          position: state.pose.position,
          rotation: state.pose.rotation,
          color,
        })
        return
      }
      latest.current.onSelect(store.pick(ndcOf(event), activeCamera()))
    }
    const onLeave = () => {
      live.current.ndc = undefined
      live.current.store?.highlight("hover", undefined)
      invalidate()
    }
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerdown", onDown)
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("pointerleave", onLeave)

    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const p = latest.current
      const state = live.current
      if (event.key === "Escape") {
        if (p.tool) p.onCancelTool()
        else p.onSelect(undefined)
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (p.selectedId && !p.tool) {
          event.preventDefault()
          p.onDelete(p.selectedId)
        }
      } else if (event.key === "r" || event.key === "R") {
        if (!p.tool) return
        const turn = state.turn
        state.turn = state.snapTarget
          ? { ...turn, roll: turn.roll + Math.PI / 2 }
          : { ...turn, quarterTurns: (turn.quarterTurns + 1) % 4 }
        schedule()
      } else if (event.key === "f" || event.key === "F") {
        frameAll()
      } else if (event.key === "o" || event.key === "O") {
        p.onToggleProjection()
      }
    }
    window.addEventListener("keydown", onKey)

    return () => {
      canvas.removeEventListener("pointermove", onMove)
      canvas.removeEventListener("pointerdown", onDown)
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointerleave", onLeave)
      window.removeEventListener("keydown", onKey)
    }
    // The handlers read the latest props through `latest` and the camera through `live`.
  }, [gl, invalidate, perspectiveCamera])

  // Selection and the placement tool are outside the document, so they update the scene here.
  useEffect(() => {
    const state = live.current
    const store = state.store
    if (!store) return
    store.highlight("select", props.selectedId)
    if (!props.tool) {
      store.setGhost(undefined, undefined, undefined)
      store.setSnapMarker(undefined)
      state.turn = START_TURN
      state.pose = undefined
      state.snapTarget = undefined
    }
    invalidate()
  }, [props.selectedId, props.tool, invalidate])

  // A selected Part that another person deleted is no longer selected.
  useEffect(() => {
    if (!props.selectedId) return
    if (!partsMap(props.doc).has(props.selectedId)) props.onSelect(undefined)
  })

  return null

  function frameAll() {
    const state = live.current
    const controls = state.controls
    const { parts } = readPlacedParts(latest.current.doc)
    if (!controls || parts.length === 0) return
    const center = new Vector3()
    for (const p of parts) center.add(new Vector3(...p.position))
    center.divideScalar(parts.length)
    let radius = 150
    for (const p of parts)
      radius = Math.max(
        radius,
        center.distanceTo(new Vector3(...p.position)) + 150
      )
    const current = state.active ?? camera
    const direction = current.position.clone().sub(controls.target).normalize()
    controls.target.copy(center)
    if (current instanceof OrthographicCamera) {
      current.position.copy(center).addScaledVector(direction, radius * 4)
      current.zoom = 1
      state.frustumHeight = radius * 2
      setFrustum(current, radius * 2, size.width / Math.max(1, size.height))
    } else {
      current.position
        .copy(center)
        .addScaledVector(direction, radius / Math.sin((FOV * Math.PI) / 360))
    }
    controls.update()
    invalidate()
  }
}

function setFrustum(ortho: OrthographicCamera, height: number, aspect: number) {
  const half = height / 2
  ortho.left = -half * aspect
  ortho.right = half * aspect
  ortho.top = half
  ortho.bottom = -half
  ortho.updateProjectionMatrix()
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  )
}
