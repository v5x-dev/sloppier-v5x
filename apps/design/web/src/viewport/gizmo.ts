// The on-screen handles for moving and turning the selection: arrows along each axis,
// squares on each plane, and rings to turn about an axis. The handles keep the same size on
// screen at any zoom, because their scale follows the distance from the camera. Each one
// has a wide, invisible proxy, so it is easy to grab.

import type { Camera, Scene, Vector2 } from "three"
import {
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  TorusGeometry,
  Vector3,
} from "three"

export type GizmoMode = "move" | "rotate"

/** What a pointer grabbed. Axis indices are into the gizmo's frame. */
export type Handle =
  | { kind: "axis"; axis: number }
  | { kind: "plane"; normal: number }
  | { kind: "ring"; axis: number }
  | { kind: "hinge" }

const AXIS_COLORS = ["#e5624f", "#67b56f", "#5b8fe0"]
const AXES: Vector3[] = [
  new Vector3(1, 0, 0),
  new Vector3(0, 1, 0),
  new Vector3(0, 0, 1),
]
const HINGE_COLOR = "#f2c14e"
/** Handle sizes, in units that the gizmo's scale turns into a constant size on screen. */
const ARROW_LENGTH = 60
const RING_RADIUS = 46
const PLANE_OFFSET = 20
const PLANE_SIZE = 14

export class Gizmo {
  private readonly root = new Group()
  private readonly moveGroup = new Group()
  private readonly ringGroup = new Group()
  private readonly hingeGroup = new Group()
  private readonly grabs: Mesh[] = []
  private readonly handleOf = new Map<Mesh, Handle>()
  private readonly visuals = new Map<Handle, MeshBasicMaterial[]>()
  private readonly raycaster = new Raycaster()
  private readonly frame = new Quaternion()
  private active: Handle | undefined
  private hinge: Vector3 | undefined

  constructor(scene: Scene) {
    scene.add(this.root)
    this.root.visible = false
    this.root.add(this.moveGroup, this.ringGroup, this.hingeGroup)
    for (let axis = 0; axis < 3; axis++) {
      this.moveGroup.add(this.arrow(axis))
      this.ringGroup.add(
        this.ring({ kind: "ring", axis }, AXIS_COLORS[axis], axis)
      )
      this.moveGroup.add(this.plane(axis))
    }
    this.hingeGroup.add(this.ring({ kind: "hinge" }, HINGE_COLOR))
  }

  /** Shows the handles for a mode. A hinge replaces the three rings with one ring on the hinge. */
  setMode(mode: GizmoMode, hinge?: Vector3): void {
    this.hinge = mode === "rotate" ? hinge?.clone().normalize() : undefined
    this.moveGroup.visible = mode === "move"
    this.ringGroup.visible = mode === "rotate" && !this.hinge
    this.hingeGroup.visible = this.hinge !== undefined
    if (this.hinge)
      this.hingeGroup.quaternion.setFromUnitVectors(
        new Vector3(0, 0, 1),
        this.hinge
      )
  }

  /** Places the gizmo at a pivot, with its axes in `frame`, at a scale that keeps it readable. */
  place(pivot: Vector3, frame: Quaternion, scale: number): void {
    this.root.position.copy(pivot)
    this.frame.copy(frame)
    this.root.quaternion.copy(frame)
    this.root.scale.setScalar(scale)
    this.root.visible = true
  }

  hide(): void {
    this.root.visible = false
  }

  get visible(): boolean {
    return this.root.visible
  }

  /** The handle under the pointer, if any. */
  pick(ndc: Vector2, camera: Camera): Handle | undefined {
    if (!this.root.visible) return undefined
    this.raycaster.setFromCamera(ndc, camera)
    const shown = this.grabs.filter(isShown)
    const hits = this.raycaster.intersectObjects(shown, false)
    if (hits.length === 0) return undefined
    return this.handleOf.get(hits[0].object as Mesh)
  }

  /** Marks the handle being dragged, so it is drawn brighter. */
  highlight(handle: Handle | undefined): void {
    if (this.active === handle) return
    this.active = handle
    for (const [key, materials] of this.visuals) {
      const lit = handle !== undefined && sameHandle(key, handle)
      for (const material of materials)
        material.opacity = lit ? 1 : REST_OPACITY
    }
  }

  /** The unit direction a handle works along, in world space. A plane gives its normal. */
  directionOf(handle: Handle): Vector3 {
    if (handle.kind === "hinge")
      return this.hinge?.clone() ?? new Vector3(0, 1, 0)
    const axis = handle.kind === "plane" ? handle.normal : handle.axis
    return AXES[axis].clone().applyQuaternion(this.frame).normalize()
  }

  /** The two world axes that span a plane handle's square. */
  planeAxes(normal: number): [Vector3, Vector3] {
    const others = [0, 1, 2].filter((a) => a !== normal)
    return [
      AXES[others[0]].clone().applyQuaternion(this.frame),
      AXES[others[1]].clone().applyQuaternion(this.frame),
    ]
  }

  dispose(): void {
    this.root.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose()
        ;(object.material as MeshBasicMaterial).dispose()
      }
    })
    this.root.removeFromParent()
  }

  private arrow(axis: number): Group {
    const group = new Group()
    const material = this.material({ kind: "axis", axis }, AXIS_COLORS[axis])
    const shaft = new Mesh(
      new CylinderGeometry(1.4, 1.4, ARROW_LENGTH - 10, 12),
      material
    )
    shaft.position.y = (ARROW_LENGTH - 10) / 2
    const head = new Mesh(new ConeGeometry(4.2, 10, 16), material)
    head.position.y = ARROW_LENGTH - 5
    const grab = this.grab(new CylinderGeometry(6, 6, ARROW_LENGTH, 8), {
      kind: "axis",
      axis,
    })
    grab.position.y = ARROW_LENGTH / 2
    group.add(shaft, head, grab)
    group.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), AXES[axis])
    return group
  }

  private plane(normal: number): Group {
    const [u, v] = [0, 1, 2].filter((a) => a !== normal)
    const at = AXES[u].clone().add(AXES[v]).multiplyScalar(PLANE_OFFSET)
    const handle: Handle = { kind: "plane", normal }
    const square = new Mesh(
      new PlaneGeometry(PLANE_SIZE, PLANE_SIZE),
      this.material(handle, AXIS_COLORS[normal], 0.45)
    )
    square.position.copy(at)
    square.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), AXES[normal])
    const grab = this.grab(
      new PlaneGeometry(PLANE_SIZE * 1.6, PLANE_SIZE * 1.6),
      handle
    )
    grab.position.copy(at)
    grab.quaternion.copy(square.quaternion)
    const group = new Group()
    group.add(square, grab)
    return group
  }

  private ring(handle: Handle, color: string, axis?: number): Group {
    const group = new Group()
    const ring = new Mesh(
      new TorusGeometry(RING_RADIUS, 1.4, 8, 96),
      this.material(handle, color)
    )
    const grab = this.grab(new TorusGeometry(RING_RADIUS, 6, 8, 48), handle)
    group.add(ring, grab)
    if (axis !== undefined)
      group.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), AXES[axis])
    return group
  }

  private material(
    handle: Handle,
    color: string,
    rest = REST_OPACITY
  ): MeshBasicMaterial {
    const material = new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: rest,
      depthTest: false,
      side: DoubleSide,
    })
    const list = this.visuals.get(handle) ?? []
    list.push(material)
    this.visuals.set(handle, list)
    return material
  }

  private grab(
    geometry: CylinderGeometry | PlaneGeometry | TorusGeometry,
    handle: Handle
  ): Mesh {
    const mesh = new Mesh(
      geometry,
      new MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
      })
    )
    mesh.renderOrder = 6
    this.grabs.push(mesh)
    this.handleOf.set(mesh, handle)
    return mesh
  }
}

const REST_OPACITY = 0.9

/** Whether an object and all its parents, up to the gizmo, are shown. */
function isShown(object: Mesh): boolean {
  for (let node: { visible: boolean; parent: unknown } | null = object; node;) {
    if (!node.visible) return false
    node = node.parent as { visible: boolean; parent: unknown } | null
  }
  return true
}

function sameHandle(a: Handle, b: Handle): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "hinge") return true
  if (a.kind === "plane") return a.normal === (b as { normal: number }).normal
  return a.axis === (b as { axis: number }).axis
}
