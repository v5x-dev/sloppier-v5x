// The 3D workspace. An orbit camera, perspective or orthographic, looks at the ground grid
// and the Parts in the document. Placing a Part follows the pointer and snaps to nearby
// Snap Points. Clicking selects Parts; shift-click and shift-drag add to the selection.
// Dragging a handle moves or turns the selection. The drag previews on screen and writes to
// the document once, when the pointer is released.

import { Canvas, useFrame, useThree } from "@react-three/fiber"
import type { PerspectiveCamera } from "three"
import {
  AxesHelper,
  DirectionalLight,
  HemisphereLight,
  NeutralToneMapping,
  OrthographicCamera,
  PMREMGenerator,
  Quaternion,
  Vector2,
  Vector3,
} from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { useEffect, useRef, type RefObject } from "react"
import * as Y from "yjs"
import {
  partsMap,
  placePart,
  readConnections,
  readPlacedParts,
} from "@/design/document"
import type { PartRef, PlacedPart, Quat } from "@/design/model"
import { canDraw, partShape } from "@/design/library"
import {
  START_TURN,
  GRID_MM,
  placementPose,
  type PlacementTurn,
} from "@/design/placement"
import type { Vec3 } from "@/catalog/types"
import { toWorldSnap, type WorldSnap } from "@/design/snap"
import { connectionsForNew, hingeOf } from "@/design/connect"
import {
  commitPlan,
  groupOf,
  planMove,
  planTurn,
  targetsOf,
  type Plan,
  type Target,
} from "@/design/edit"
import { readSceneColors } from "./colors"
import { createGrid } from "./grid"
import { ModelLoader, type ModelStatus } from "./models"
import { Gizmo, type GizmoMode, type Handle } from "./gizmo"
import { angleOnRing, closestOnAxis, rayPlaneHit, type Ray } from "./gizmo-math"
import { DEFAULT_COLORS, SceneStore } from "./scene-store"
import { INITIAL_STATUS, type Projection, type ViewportStatus } from "./status"

export type { Projection, ViewportStatus } from "./status"

export type ViewportProps = {
  doc: Y.Doc
  /** The models base, or undefined when it is not configured. */
  modelsBase: string | undefined
  /** The Part being placed, or none. */
  tool: PartRef | undefined
  selection: ReadonlySet<string>
  onSelection: (next: Set<string>) => void
  mode: GizmoMode
  /** Handles follow the selected Part's own axes, not the world's. */
  local: boolean
  /** A screw or shaft to turn the selection about, or none for the selection's centre. */
  pivot: string | undefined
  /** The angle a turn snaps to, in radians. */
  angleStep: number
  projection: Projection
  onCancelTool: () => void
  onToggleProjection: () => void
  onStatus: (status: ViewportStatus) => void
  onNotice: (text: string | undefined) => void
}

const FOV = 35
const CLICK_SLOP_PX = 5
const TARGET = new Vector3(0, 40, 0)
const INITIAL_POSITION: [number, number, number] = [760, 640, 760]
const GIZMO_SCALE_DISTANCE = 800

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
  const box = useRef<HTMLDivElement>(null)
  return (
    <>
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        gl={GL_OPTIONS}
        camera={CAMERA_OPTIONS}
        style={CANVAS_STYLE}
      >
        <Workspace {...props} box={box} />
      </Canvas>
      <div
        ref={box}
        hidden
        className="pointer-events-none absolute rounded-sm border border-primary bg-primary/10"
      />
    </>
  )
}

/** A Part's link as the viewport draws it: the two ends, read from the Parts' shapes. */
type LinkSpec = {
  fastener: string
  fastenerSnap?: string
  host: string
  hostSnap: string
}

/** A drag under way. Handle drags move or turn the selection; box drags pick Parts. */
type Drag =
  | {
      kind: "handle"
      handle: Handle
      pivot: Vector3
      startHit?: Vector3
      startT?: number
      axis?: Vector3
      targets: Target[]
      alone: boolean
      hinge: boolean
      plan?: Plan
      moved: boolean
    }
  | { kind: "box"; start: { x: number; y: number }; additive: boolean }

/** The mutable state of the workspace. Kept in a ref so pointer events never re-render React. */
type Live = {
  store?: SceneStore
  gizmo?: Gizmo
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
  drag?: Drag
  hinge?: { point: Vector3; direction: Vector3 }
  links: LinkSpec[]
  status: ViewportStatus
}

function Workspace(
  props: ViewportProps & { box: RefObject<HTMLDivElement | null> }
) {
  const { gl, scene, size, invalidate, camera, set } = useThree()
  // The canvas's own camera. `camera` above changes when the projection switches, and the
  // scene must not be rebuilt for that.
  const perspectiveCamera = useRef(camera as PerspectiveCamera).current
  const latest = useRef(props)
  latest.current = props
  const live = useRef<Live>({
    frustumHeight: 1000,
    turn: START_TURN,
    links: [],
    status: INITIAL_STATUS,
  })

  const activeCamera = () => live.current.active ?? camera

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
    const gizmo = new Gizmo(scene)
    state.gizmo = gizmo

    const map = partsMap(latest.current.doc)
    const sync = () => {
      const { parts, invalid } = readPlacedParts(latest.current.doc)
      const drawable = parts.filter(canDraw)
      store.sync(drawable)
      state.links = linkSpecs(latest.current.doc, drawable)
      drawLinks()
      emit({
        parts: drawable.length,
        invalid: invalid.length + parts.length - drawable.length,
      })
      // A Part that someone else deleted leaves the selection.
      const present = new Set(drawable.map((p) => p.id))
      const kept = [...latest.current.selection].filter((id) => present.has(id))
      if (kept.length !== latest.current.selection.size)
        latest.current.onSelection(new Set(kept))
    }
    sync()
    map.observeDeep(sync)
    const connections = latest.current.doc.getMap("connections")
    connections.observeDeep(sync)
    // For benchmarks/viewport.mjs: the dev server only, never a production build.
    if (import.meta.env.DEV)
      Object.assign(window, {
        __designBench: {
          doc: latest.current.doc,
          renderer: gl,
          store,
          placePart,
          documentBytes: () =>
            Y.encodeStateAsUpdate(latest.current.doc).byteLength,
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
      connections.unobserveDeep(sync)
      gl.domElement.removeEventListener("webglcontextlost", onContextLost)
      controls.removeEventListener("change", onChange)
      controls.dispose()
      store.dispose()
      gizmo.dispose()
      grid.mesh.geometry.dispose()
      scene.remove(hemi, key, grid.mesh, axes)
      scene.environment = null
      environment.dispose()
      state.store = undefined
      state.gizmo = undefined
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
    const state = live.current
    state.controls?.update()
    placeGizmo()
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
    const refresh = () => {
      const state = live.current
      state.frame = undefined
      const store = state.store
      if (!store || !state.ndc) return
      const cam = activeCamera()
      const tool = latest.current.tool
      if (!tool) {
        const hovered = store.pick(state.ndc, cam)
        const handle = state.gizmo?.pick(state.ndc, cam)
        store.highlight(hovered)
        state.gizmo?.highlight(
          state.drag?.kind === "handle" ? state.drag.handle : handle
        )
        canvas.style.cursor = handle ? "grab" : hovered ? "pointer" : "default"
        store.setGhost(undefined, undefined, undefined)
        store.setSnapMarker(undefined)
        state.pose = undefined
        state.snapTarget = undefined
        emit({ snap: null })
        return
      }
      canvas.style.cursor = "crosshair"
      store.highlight(undefined)
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
      const state = live.current
      state.ndc = ndcOf(event)
      const drag = state.drag
      if (drag?.kind === "handle") {
        dragHandle(drag, state.ndc)
        return
      }
      if (drag?.kind === "box") {
        showBox(drag.start, { x: event.clientX, y: event.clientY })
        return
      }
      schedule()
    }
    const onDown = (event: PointerEvent) => {
      const state = live.current
      state.down = { x: event.clientX, y: event.clientY }
      if (latest.current.tool || event.button !== 0) return
      const store = state.store
      const handle =
        store && state.ndc
          ? state.gizmo?.pick(state.ndc, activeCamera())
          : undefined
      if (handle && store && state.gizmo) {
        // A handle takes the pointer: orbit does not start, and the click does not select.
        event.stopImmediatePropagation()
        state.controls && (state.controls.enabled = false)
        state.down = undefined
        beginHandleDrag(handle, event.altKey)
        canvas.setPointerCapture(event.pointerId)
        return
      }
      if (
        event.shiftKey &&
        store &&
        state.ndc &&
        store.pick(state.ndc, activeCamera()) === undefined
      ) {
        // Shift on empty space: a box that selects the Parts inside it.
        event.stopImmediatePropagation()
        state.controls && (state.controls.enabled = false)
        state.drag = {
          kind: "box",
          start: { x: event.clientX, y: event.clientY },
          additive: true,
        }
        state.down = undefined
        canvas.setPointerCapture(event.pointerId)
      }
    }
    const onUp = (event: PointerEvent) => {
      const state = live.current
      const drag = state.drag
      state.drag = undefined
      if (drag?.kind === "handle") {
        finishHandleDrag(drag)
        if (state.controls) state.controls.enabled = true
        state.gizmo?.highlight(undefined)
        if (canvas.hasPointerCapture(event.pointerId))
          canvas.releasePointerCapture(event.pointerId)
        return
      }
      if (drag?.kind === "box") {
        hideBox()
        if (state.controls) state.controls.enabled = true
        if (canvas.hasPointerCapture(event.pointerId))
          canvas.releasePointerCapture(event.pointerId)
        selectInBox(drag, { x: event.clientX, y: event.clientY })
        return
      }
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
        placeTool(tool, state.pose)
        return
      }
      const hit = store.pick(ndcOf(event), activeCamera())
      const current = latest.current.selection
      if (event.shiftKey) {
        if (hit === undefined) return
        const next = new Set(current)
        if (next.has(hit)) next.delete(hit)
        else next.add(hit)
        latest.current.onSelection(next)
        return
      }
      latest.current.onSelection(hit === undefined ? new Set() : new Set([hit]))
    }
    const onLeave = () => {
      live.current.ndc = undefined
      live.current.store?.highlight(undefined)
      invalidate()
    }
    const onContext = (event: MouseEvent) => {
      // A right-click on a Part selects it first, so the menu acts on what was clicked.
      const store = live.current.store
      if (!store || latest.current.tool) return
      const hit = store.pick(ndcOf(event as PointerEvent), activeCamera())
      if (hit !== undefined && !latest.current.selection.has(hit))
        latest.current.onSelection(new Set([hit]))
    }
    canvas.addEventListener("pointermove", onMove)
    canvas.addEventListener("pointerdown", onDown, { capture: true })
    canvas.addEventListener("pointerup", onUp)
    canvas.addEventListener("pointerleave", onLeave)
    canvas.addEventListener("contextmenu", onContext)

    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target)) return
      const p = latest.current
      const state = live.current
      if (event.key === "r" || event.key === "R") {
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
      canvas.removeEventListener("pointerdown", onDown, { capture: true })
      canvas.removeEventListener("pointerup", onUp)
      canvas.removeEventListener("pointerleave", onLeave)
      canvas.removeEventListener("contextmenu", onContext)
      window.removeEventListener("keydown", onKey)
    }
    // The handlers read the latest props through `latest` and the camera through `live`.
  }, [gl, invalidate, perspectiveCamera])

  // Selection, mode and the placement tool are outside the document, so they update here.
  useEffect(() => {
    const state = live.current
    const store = state.store
    if (!store) return
    store.setSelection(props.selection)
    if (!props.tool) {
      store.setGhost(undefined, undefined, undefined)
      store.setSnapMarker(undefined)
      state.turn = START_TURN
      state.pose = undefined
      state.snapTarget = undefined
    }
    invalidate()
  }, [props.selection, props.tool, invalidate])

  // The hinge a rotation turns about, when the team picked a screw or shaft.
  useEffect(() => {
    const state = live.current
    state.hinge = props.pivot
      ? hingeOf(latest.current.doc, props.pivot)
      : undefined
    state.gizmo?.setMode(
      props.mode,
      props.mode === "rotate" ? state.hinge?.direction : undefined
    )
    invalidate()
  }, [props.mode, props.pivot, props.doc, invalidate])

  return null

  // ---- Handles ---------------------------------------------------------------

  /** Starts a drag on a handle: fixes the pivot, the grabbed Parts, and where the drag began. */
  function beginHandleDrag(handle: Handle, alone: boolean) {
    const state = live.current
    const store = state.store
    const gizmo = state.gizmo
    if (!store || !gizmo || !state.ndc) return
    const cam = activeCamera()
    const rotating = latest.current.mode === "rotate"
    const hinge =
      rotating && handle.kind !== "axis" && handle.kind !== "plane"
        ? state.hinge
        : undefined
    const pivotFastener = hinge ? latest.current.pivot : undefined
    const selection = latest.current.selection
    if (selection.size === 0) return
    const group = groupOf(latest.current.doc, selection, {
      pivot: pivotFastener,
      alone,
    })
    const targets = targetsOf(latest.current.doc, group)
    const pivot = hinge ? hinge.point.clone() : centroidOf(selection)
    const drag: Drag = {
      kind: "handle",
      handle,
      pivot,
      targets,
      alone,
      hinge: Boolean(hinge),
      moved: false,
    }
    const ray = store.rayAt(state.ndc, cam)
    if (handle.kind === "axis") {
      drag.axis = gizmo.directionOf(handle)
      drag.startT = closestOnAxis(ray, pivot, drag.axis)
    } else if (handle.kind === "plane") {
      drag.axis = gizmo.directionOf(handle)
      drag.startHit = rayPlaneHit(ray, pivot, drag.axis) ?? undefined
    } else {
      drag.axis = gizmo.directionOf(handle)
      drag.startHit = rayPlaneHit(ray, pivot, drag.axis) ?? undefined
      if (!drag.startHit) return
    }
    state.drag = drag
    gizmo.highlight(handle)
  }

  /** Previews the drag at the pointer's position. Only the instances change. */
  function dragHandle(drag: Extract<Drag, { kind: "handle" }>, ndc: Vector2) {
    const state = live.current
    const store = state.store
    if (!store || !state.gizmo || !drag.axis) return
    const ray: Ray = store.rayAt(ndc, activeCamera())
    const step = GRID_MM
    const handle = drag.handle
    let plan: Plan | { blocked: "ground" } | undefined
    if (handle.kind === "axis") {
      const t = closestOnAxis(ray, drag.pivot, drag.axis)
      const raw = t - (drag.startT ?? t)
      const q = Math.round(raw / step) * step
      const delta: Vec3 = [drag.axis.x * q, drag.axis.y * q, drag.axis.z * q]
      plan = planMove(drag.targets, delta, drag.alone)
    } else if (handle.kind === "plane") {
      const hit = rayPlaneHit(ray, drag.pivot, drag.axis)
      if (!hit || !drag.startHit) return
      const offset = hit.clone().sub(drag.startHit)
      const [u, v] = state.gizmo.planeAxes(handle.normal)
      const a = Math.round(offset.dot(u) / step) * step
      const b = Math.round(offset.dot(v) / step) * step
      const delta: Vec3 = [
        u.x * a + v.x * b,
        u.y * a + v.y * b,
        u.z * a + v.z * b,
      ]
      plan = planMove(drag.targets, delta, drag.alone)
    } else {
      const hit = rayPlaneHit(ray, drag.pivot, drag.axis)
      if (!hit || !drag.startHit) return
      const reference = drag.startHit.clone().sub(drag.pivot)
      const angle = angleOnRing(hit, drag.pivot, drag.axis, reference)
      const snapped =
        Math.round(angle / latest.current.angleStep) * latest.current.angleStep
      plan = planTurn(
        drag.targets,
        [drag.pivot.x, drag.pivot.y, drag.pivot.z],
        [drag.axis.x, drag.axis.y, drag.axis.z],
        snapped,
        {
          alone: drag.alone,
          liftAllowed: !drag.hinge,
        }
      )
      if ("blocked" in plan) {
        latest.current.onNotice(
          "A turn about a screw or shaft cannot take a Part under the ground."
        )
        return
      }
      latest.current.onNotice(undefined)
    }
    if ("blocked" in plan) return
    drag.plan = plan
    drag.moved = plan.changes.some((c, i) => {
      const t = drag.targets[i]
      return (
        c.position.some((v, k) => Math.abs(v - t.pose.position[k]) > 1e-6) ||
        c.rotation.some((v, k) => Math.abs(v - t.pose.rotation[k]) > 1e-6)
      )
    })
    store.preview(plan.changes)
    drawLinks()
    invalidate()
  }

  /** Writes the drag to the document as one step, then drops the preview. */
  function finishHandleDrag(drag: Extract<Drag, { kind: "handle" }>) {
    const state = live.current
    const store = state.store
    if (!store) return
    if (drag.plan && drag.moved) commitPlan(latest.current.doc, drag.plan)
    store.clearPreview()
    state.gizmo?.highlight(undefined)
    syncNow()
    latest.current.onNotice(undefined)
  }

  /** Re-reads the document into the scene, after a preview or a commit. */
  function syncNow() {
    const state = live.current
    const { parts } = readPlacedParts(latest.current.doc)
    state.store?.sync(parts.filter(canDraw))
    state.links = linkSpecs(latest.current.doc, parts.filter(canDraw))
    drawLinks()
  }

  /** Places a Part, and makes the Connections it forms with the Parts around it. */
  function placeTool(tool: PartRef, pose: { position: Vec3; rotation: Quat }) {
    const doc = latest.current.doc
    const color = DEFAULT_COLORS[partShape(tool).catalog.material]
    const id = crypto.randomUUID()
    const added: PlacedPart = {
      ...tool,
      id,
      position: pose.position,
      rotation: pose.rotation,
      color,
    }
    const drafts = connectionsForNew(readPlacedParts(doc).parts, added)
    placePart(
      doc,
      { ...tool, position: pose.position, rotation: pose.rotation, color },
      id,
      drafts
    )
  }

  /** Draws the Connections as lines between their two ends, following any preview. */
  function drawLinks() {
    const state = live.current
    const store = state.store
    if (!store) return
    const points: number[] = []
    for (const link of state.links) {
      const a = endOf(store, link.fastener, link.fastenerSnap)
      const b = endOf(store, link.host, link.hostSnap)
      if (a && b) points.push(a.x, a.y, a.z, b.x, b.y, b.z)
    }
    store.setLinks(points)
  }

  function placeGizmo() {
    const state = live.current
    const store = state.store
    const gizmo = state.gizmo
    const selection = latest.current.selection
    if (!store || !gizmo || latest.current.tool || selection.size === 0) {
      gizmo?.hide()
      return
    }
    const pivot =
      state.hinge && latest.current.mode === "rotate" && latest.current.pivot
        ? state.hinge.point.clone()
        : centroidOf(selection)
    const cam = activeCamera()
    const frame = new Quaternion()
    if (latest.current.local && selection.size === 1) {
      const [id] = [...selection]
      const pose = store.poseOf(id)
      if (pose) frame.set(...pose.rotation)
    }
    const scale =
      cam instanceof OrthographicCamera
        ? state.frustumHeight / 1000
        : pivot.distanceTo(cam.position) / GIZMO_SCALE_DISTANCE
    gizmo.place(pivot, frame, scale)
  }

  /** The centre of the selection's Parts, at their current poses. */
  function centroidOf(selection: ReadonlySet<string>): Vector3 {
    const store = live.current.store
    const sum = new Vector3()
    let n = 0
    for (const id of selection) {
      const pose = store?.poseOf(id)
      if (!pose) continue
      sum.add(new Vector3(...pose.position))
      n++
    }
    return n > 0 ? sum.divideScalar(n) : sum
  }

  // ---- Box selection ---------------------------------------------------------

  function showBox(
    start: { x: number; y: number },
    end: { x: number; y: number }
  ) {
    const box = props.box.current
    const canvas = gl.domElement
    if (!box) return
    const rect = canvas.getBoundingClientRect()
    box.hidden = false
    box.style.left = `${Math.min(start.x, end.x) - rect.left}px`
    box.style.top = `${Math.min(start.y, end.y) - rect.top}px`
    box.style.width = `${Math.abs(end.x - start.x)}px`
    box.style.height = `${Math.abs(end.y - start.y)}px`
  }

  function hideBox() {
    if (props.box.current) props.box.current.hidden = true
  }

  /** Selects the Parts whose centres fall inside the box, on screen. */
  function selectInBox(
    drag: Extract<Drag, { kind: "box" }>,
    end: { x: number; y: number }
  ) {
    const store = live.current.store
    if (!store) return
    const canvas = gl.domElement
    const rect = canvas.getBoundingClientRect()
    const toNdc = (x: number, y: number) =>
      new Vector2(
        ((x - rect.left) / rect.width) * 2 - 1,
        -((y - rect.top) / rect.height) * 2 + 1
      )
    const a = toNdc(
      Math.min(drag.start.x, end.x),
      Math.min(drag.start.y, end.y)
    )
    const b = toNdc(
      Math.max(drag.start.x, end.x),
      Math.max(drag.start.y, end.y)
    )
    const cam = activeCamera()
    const inside = new Set<string>()
    const at = new Vector3()
    for (const [id, position] of store.positions()) {
      at.set(...position).project(cam)
      if (at.z < -1 || at.z > 1) continue
      if (at.x >= a.x && at.x <= b.x && at.y >= a.y && at.y <= b.y)
        inside.add(id)
    }
    const next =
      drag.additive && (end.x !== drag.start.x || end.y !== drag.start.y)
        ? new Set([...latest.current.selection, ...inside])
        : new Set(inside)
    latest.current.onSelection(next)
  }

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

/** The ends of each Connection, read from the Parts' Snap Points. */
function linkSpecs(doc: Y.Doc, parts: readonly PlacedPart[]): LinkSpec[] {
  const present = new Set(parts.map((p) => p.id))
  return readConnections(doc)
    .filter((c) => present.has(c.fastener) && present.has(c.host))
    .map((c) => ({
      fastener: c.fastener,
      fastenerSnap: c.fastenerSnap,
      host: c.host,
      hostSnap: c.hostSnap,
    }))
}

/** One end of a link: the named Snap Point at the Part's current pose, or its centre. */
function endOf(
  store: SceneStore,
  id: string,
  snapId: string | undefined
): Vector3 | undefined {
  const pose = store.poseOf(id)
  if (!pose) return undefined
  if (snapId === undefined) return new Vector3(...pose.position)
  const shape = store.shapeFor(id)
  const snap = shape?.snapPoints.find((s) => s.id === snapId)
  if (!snap) return new Vector3(...pose.position)
  return toWorldSnap(snap, pose).position
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
