// The imperative side of the viewport. Placed Parts are drawn as instanced meshes, one per
// (Part, length). A change to the document updates the matrices of the instances that
// changed, and nothing else, so no React component re-renders per frame.

import type { Camera, Scene, Vector2 } from "three"
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Plane,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector3,
} from "three"
import type { Material as PartMaterial, SnapPoint, Vec3 } from "@/catalog/types"
import { partShape, type PartShape } from "@/design/library"
import { SlotTable } from "@/design/slots"
import type { PartRef, PlacedPart, Quat } from "@/design/model"
import {
  SnapIndex,
  toWorldSnap,
  type Pose,
  type WorldSnap,
} from "@/design/snap"
import { SNAP_RADIUS_MM } from "@/design/placement"
import { boxFor, type ModelLoader } from "./models"
import type { SceneColors } from "./colors"
import { withEdgeLines } from "./edge-lines"

type Pose3 = { position: Vec3; rotation: Quat; color: string }

type PartGroup = {
  key: string
  shape: PartShape
  slots: SlotTable
  material: MeshStandardMaterial
  geometry?: BufferGeometry
  mesh?: InstancedMesh
  requested: boolean
}

type Highlight = { line: LineSegments; id?: string }

const MIN_CAPACITY = 32
const ONE = new Vector3(1, 1, 1)

export const DEFAULT_COLORS: Record<PartMaterial, string> = {
  aluminum: "#c4cad3",
  steel: "#7f8691",
  nylon: "#e3dac3",
  electronics: "#2d3138",
}

/**
 * The colour a new Part is placed in. A fixed model carries its own colours in its GLB, so
 * it is placed untinted; a Cut Part has one colour and takes its material's.
 */
export function defaultColorFor(catalog: {
  kind: string
  material: PartMaterial
}): string {
  return catalog.kind === "model" ? "#ffffff" : DEFAULT_COLORS[catalog.material]
}

const SURFACE: Record<PartMaterial, { metalness: number; roughness: number }> =
  {
    aluminum: { metalness: 0.85, roughness: 0.32 },
    steel: { metalness: 0.75, roughness: 0.46 },
    nylon: { metalness: 0.0, roughness: 0.62 },
    electronics: { metalness: 0.15, roughness: 0.7 },
  }

export class SceneStore {
  private readonly groups = new Map<string, PartGroup>()
  private readonly poses = new Map<string, Pose3 & { key: string }>()
  private readonly root = new Group()
  private readonly raycaster = new Raycaster()
  private readonly ground = new Plane(new Vector3(0, 1, 0), 0)
  private readonly matrix = new Matrix4()
  private readonly color = new Color()
  private readonly rotation = new Quaternion()
  private readonly position = new Vector3()
  private readonly ghost: Mesh
  private readonly ghostDepth: Mesh
  private readonly highlights: Record<"hover" | "select", Highlight>
  private readonly snapMarker: Mesh
  private snapIndex = new SnapIndex(SNAP_RADIUS_MM)
  private readonly scene: Scene
  private readonly snapColor: Color

  constructor(
    scene: Scene,
    colors: SceneColors,
    private readonly loader: ModelLoader,
    private readonly invalidate: () => void
  ) {
    this.scene = scene
    this.snapColor = colors.snap
    this.root.name = "parts"
    scene.add(this.root)

    this.ghost = new Mesh(
      undefined,
      new MeshStandardMaterial({
        color: "#ffffff",
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    )
    this.ghost.visible = false
    this.ghost.renderOrder = 2
    scene.add(this.ghost)
    // Writes only depth, from the same surface, before the transparent pass. The ghost then
    // draws its outer surface only; faces inside the Part fail the depth test behind it.
    this.ghostDepth = new Mesh(
      undefined,
      new MeshBasicMaterial({ colorWrite: false, depthWrite: true })
    )
    this.ghostDepth.visible = false
    this.ghostDepth.renderOrder = 1
    scene.add(this.ghostDepth)

    const edges = new EdgesGeometry(new BoxGeometry(1, 1, 1))
    const outline = (color: Color) => {
      const line = new LineSegments(
        edges,
        new LineBasicMaterial({ color, depthTest: false, transparent: true })
      )
      line.visible = false
      line.renderOrder = 3
      scene.add(line)
      return line
    }
    this.highlights = {
      hover: { line: outline(colors.highlight) },
      select: { line: outline(colors.accent) },
    }

    this.snapMarker = new Mesh(
      new RingGeometry(5, 6.5, 48),
      new MeshBasicMaterial({
        color: colors.snap,
        depthTest: false,
        transparent: true,
        side: DoubleSide,
      })
    )
    this.snapMarker.visible = false
    this.snapMarker.renderOrder = 4
    scene.add(this.snapMarker)
  }

  /** Brings the scene in line with the Parts in the document. */
  sync(parts: readonly PlacedPart[]): void {
    const live = new Set<string>()
    for (const part of parts) {
      live.add(part.id)
      const pose = {
        position: part.position,
        rotation: part.rotation,
        color: part.color,
      }
      const cur = this.poses.get(part.id)
      if (!cur) this.add(part, pose)
      else if (!samePose(cur, pose)) this.update(part.id, pose)
    }
    for (const id of [...this.poses.keys()]) if (!live.has(id)) this.remove(id)
    this.rebuildSnapIndex(parts)
    // An outlined Part may have moved or been deleted by someone else.
    this.drawHighlight("hover")
    this.drawHighlight("select")
    this.invalidate()
  }

  get index(): SnapIndex {
    return this.snapIndex
  }

  /** The shape a Part reference draws with. */
  shapeOf(ref: PartRef): PartShape {
    return partShape(ref)
  }

  /** The ray from the camera through the pointer. */
  rayAt(ndc: Vector2, camera: Camera): { origin: Vector3; direction: Vector3 } {
    this.raycaster.setFromCamera(ndc, camera)
    return {
      origin: this.raycaster.ray.origin.clone(),
      direction: this.raycaster.ray.direction.clone(),
    }
  }

  /** Points on the ground plane under the pointer, in world millimetres. */
  groundAt(ndc: Vector2, camera: Camera): { x: number; z: number } | undefined {
    this.raycaster.setFromCamera(ndc, camera)
    const hit = this.raycaster.ray.intersectPlane(this.ground, this.position)
    return hit ? { x: hit.x, z: hit.z } : undefined
  }

  /** The Part under the pointer, if any. */
  pick(ndc: Vector2, camera: Camera): string | undefined {
    this.raycaster.setFromCamera(ndc, camera)
    const meshes = [...this.groups.values()].flatMap((g) =>
      g.mesh && g.slots.count > 0 ? [g.mesh] : []
    )
    const hits = this.raycaster.intersectObjects(meshes, false)
    if (hits.length === 0) return undefined
    const hit = hits[0]
    const slot = hit.instanceId
    if (slot === undefined) return undefined
    for (const group of this.groups.values()) {
      if (group.mesh === hit.object) return group.slots.idAt(slot)
    }
    return undefined
  }

  /** Shows the Part being placed, or hides it. */
  setGhost(
    ref: PartRef | undefined,
    pose: Pose | undefined,
    color: string | undefined,
    snapped = false
  ): void {
    if (!ref || !pose || color === undefined) {
      this.ghost.visible = false
      this.ghostDepth.visible = false
      return
    }
    const group = this.ensureGroup(this.shapeOf(ref))
    if (!group.geometry) {
      this.ghost.visible = false
      this.ghostDepth.visible = false
      return
    }
    this.ghost.geometry = group.geometry
    this.ghostDepth.geometry = group.geometry
    const material = this.ghost.material as MeshStandardMaterial
    if (material.vertexColors !== hasVertexColors(group.geometry)) {
      material.vertexColors = hasVertexColors(group.geometry)
      material.needsUpdate = true
    }
    material.emissive.copy(this.snapColor)
    material.emissiveIntensity = snapped ? 0.55 : 0
    this.ghost.position.set(...pose.position)
    this.ghost.quaternion.set(...pose.rotation)
    this.ghost.visible = true
    this.ghostDepth.position.copy(this.ghost.position)
    this.ghostDepth.quaternion.copy(this.ghost.quaternion)
    this.ghostDepth.visible = true
  }

  /** Marks the Snap Point a placement has snapped to, with its opening facing out. */
  setSnapMarker(target: WorldSnap | undefined, diameterMm = 4): void {
    if (!target) {
      this.snapMarker.visible = false
      return
    }
    this.snapMarker.visible = true
    this.snapMarker.position.copy(target.position)
    this.snapMarker.quaternion.setFromUnitVectors(
      new Vector3(0, 0, 1),
      target.axis
    )
    this.snapMarker.scale.setScalar(Math.max(1, diameterMm / 4))
  }

  /** Outlines a Part as hovered or selected, or clears the outline. */
  highlight(kind: "hover" | "select", id: string | undefined): void {
    if (this.highlights[kind].id === id) return
    this.highlights[kind].id = id
    this.drawHighlight(kind)
    this.invalidate()
  }

  private drawHighlight(kind: "hover" | "select"): void {
    const { id, line } = this.highlights[kind]
    const pose = id ? this.poses.get(id) : undefined
    const shape = pose ? this.groups.get(pose.key)?.shape : undefined
    if (!pose || !shape) {
      line.visible = false
      return
    }
    line.visible = true
    line.position.set(...pose.position)
    line.quaternion.set(...pose.rotation)
    line.scale.set(...shape.sizeMm)
  }

  /** Instanced meshes in use and the triangles they draw, for the benchmark. */
  stats(): { meshes: number; instances: number; triangles: number } {
    let meshes = 0
    let instances = 0
    let triangles = 0
    for (const group of this.groups.values()) {
      if (!group.mesh || group.slots.count === 0) continue
      const position = group.geometry?.getAttribute("position").count ?? 0
      const indices = group.geometry?.getIndex()?.count ?? position
      meshes += 1
      instances += group.slots.count
      triangles += (indices / 3) * group.slots.count
    }
    return { meshes, instances, triangles }
  }

  dispose(): void {
    for (const group of this.groups.values()) {
      group.mesh?.dispose()
      group.mesh?.removeFromParent()
    }
    this.groups.clear()
    this.poses.clear()
    this.loader.dispose()
    this.scene.remove(
      this.root,
      this.ghost,
      this.ghostDepth,
      this.snapMarker,
      this.highlights.hover.line,
      this.highlights.select.line
    )
  }

  // ---- Instances -----------------------------------------------------------

  private add(part: PlacedPart, pose: Pose3): void {
    const shape = partShape(part)
    const group = this.ensureGroup(shape)
    group.slots.add(part.id)
    this.poses.set(part.id, { ...pose, key: group.key })
    this.ensureCapacity(group)
    this.writeInstance(group, part.id)
    this.syncCount(group)
  }

  private update(id: string, pose: Pose3): void {
    const cur = this.poses.get(id)
    if (!cur) return
    Object.assign(cur, pose)
    const group = this.groups.get(cur.key)
    if (!group) return
    this.writeInstance(group, id)
  }

  private remove(id: string): void {
    const entry = this.poses.get(id)
    if (!entry) return
    const group = this.groups.get(entry.key)
    this.poses.delete(id)
    if (!group) return
    const result = group.slots.remove(id)
    if (result?.moved) this.writeInstance(group, result.moved.id)
    this.syncCount(group)
  }

  private ensureGroup(shape: PartShape): PartGroup {
    const key = shape.key
    const existing = this.groups.get(key)
    if (existing) return existing
    const group: PartGroup = {
      key,
      shape,
      slots: new SlotTable(),
      material: this.materialFor(shape),
      requested: false,
    }
    this.groups.set(key, group)
    this.loadGeometry(group)
    return group
  }

  private loadGeometry(group: PartGroup): void {
    if (group.requested) return
    group.requested = true
    if (group.shape.cut) {
      group.geometry = cutGeometry(
        group.shape.cut.geometry.positions,
        group.shape.cut.geometry.normals
      )
      this.attach(group)
      return
    }
    const part = group.shape.catalog
    if (part.kind !== "model") return
    this.loader.geometry(part).then(
      (geometry) => {
        if (this.groups.get(group.key) !== group) return
        group.geometry = geometry
        if (hasVertexColors(geometry)) {
          group.material.vertexColors = true
          group.material.needsUpdate = true
        }
        this.attach(group)
        this.invalidate()
      },
      () => {
        if (this.groups.get(group.key) !== group) return
        group.geometry = boxFor(part)
        this.attach(group)
        this.invalidate()
      }
    )
  }

  private attach(group: PartGroup): void {
    if (!group.geometry || group.mesh) return
    const capacity = Math.max(MIN_CAPACITY, nextPowerOfTwo(group.slots.count))
    group.mesh = this.createMesh(group, capacity)
    for (let slot = 0; slot < group.slots.count; slot++) {
      const id = group.slots.idAt(slot)
      if (id) this.writeInstance(group, id)
    }
    this.syncCount(group)
  }

  private createMesh(group: PartGroup, capacity: number): InstancedMesh {
    const mesh = new InstancedMesh(group.geometry, group.material, capacity)
    mesh.frustumCulled = true
    mesh.count = 0
    mesh.instanceMatrix.setUsage(DynamicDrawUsage) // Matrices change as Parts move.
    this.root.add(mesh)
    return mesh
  }

  private ensureCapacity(group: PartGroup): void {
    if (!group.geometry) return
    const count = group.slots.count
    const current = group.mesh?.instanceMatrix.count ?? 0
    if (group.mesh && count <= current) return
    const capacity = Math.max(MIN_CAPACITY, nextPowerOfTwo(count))
    if (group.mesh) {
      group.mesh.removeFromParent()
      group.mesh.dispose()
    }
    group.mesh = this.createMesh(group, capacity)
    for (let slot = 0; slot < count; slot++) {
      const id = group.slots.idAt(slot)
      if (id) this.writeInstance(group, id)
    }
  }

  private writeInstance(group: PartGroup, id: string): void {
    const mesh = group.mesh
    const pose = this.poses.get(id)
    const slot = group.slots.slotOf(id)
    if (
      !mesh ||
      !pose ||
      slot === undefined ||
      slot >= mesh.instanceMatrix.count
    )
      return
    this.position.set(...pose.position)
    this.rotation.set(...pose.rotation)
    this.matrix.compose(this.position, this.rotation, ONE)
    mesh.setMatrixAt(slot, this.matrix)
    mesh.setColorAt(slot, this.color.set(pose.color))
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.boundingSphere = null
  }

  private syncCount(group: PartGroup): void {
    if (!group.mesh) return
    group.mesh.count = group.slots.count
    group.mesh.visible = group.slots.count > 0
    group.mesh.boundingSphere = null
  }

  private materialFor(shape: PartShape): MeshStandardMaterial {
    const surface = SURFACE[shape.catalog.material]
    return withEdgeLines(
      new MeshStandardMaterial({
        color: "#ffffff",
        metalness: surface.metalness,
        roughness: surface.roughness,
      })
    )
  }

  private rebuildSnapIndex(parts: readonly PlacedPart[]): void {
    const index = new SnapIndex(SNAP_RADIUS_MM)
    for (const part of parts) {
      const shape = partShape(part)
      for (const snap of shape.snapPoints)
        index.add(
          worldEntry(part.id, snap, {
            position: part.position,
            rotation: part.rotation,
          })
        )
    }
    this.snapIndex = index
  }
}

function worldEntry(owner: string, snap: SnapPoint, pose: Pose): WorldSnap {
  return { owner, snapId: snap.id, ...toWorldSnap(snap, pose) }
}

function samePose(
  a: Pose3,
  b: { position: Vec3; rotation: Quat; color: string }
): boolean {
  return (
    a.color === b.color &&
    a.position.every((v, i) => v === b.position[i]) &&
    a.rotation.every((v, i) => v === b.rotation[i])
  )
}

function cutGeometry(
  positions: Float32Array,
  normals: Float32Array
): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute("position", new BufferAttribute(positions, 3))
  geometry.setAttribute("normal", new BufferAttribute(normals, 3))
  return geometry
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

function hasVertexColors(geometry: BufferGeometry): boolean {
  return "color" in geometry.attributes
}
