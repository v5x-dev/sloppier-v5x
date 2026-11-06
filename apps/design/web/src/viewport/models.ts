// Loads fixed Part models from the models base, once per catalog entry. A model that
// fails to load does not throw into the scene: its callers get a box of the Part's size
// instead, and `failed` lists what to tell the user.

import { BoxGeometry, type BufferGeometry, Mesh } from "three"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js"
import { modelUrl } from "@/catalog/catalog"
import type { ModelPart } from "@/catalog/types"

export type ModelStatus = { loading: number; failed: string[] }

export class ModelLoader {
  private readonly geometries = new Map<string, Promise<BufferGeometry>>()
  private readonly failed = new Set<string>()
  private loading = 0
  private readonly loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)

  constructor(
    /** The models base, or undefined when it is not configured: every model then shows as a box. */
    private readonly base: string | undefined,
    private readonly onStatus: (status: ModelStatus) => void
  ) {}

  /** The mesh for a fixed Part. Resolves to a box when the model cannot be read. */
  geometry(part: ModelPart): Promise<BufferGeometry> {
    const cached = this.geometries.get(part.id)
    if (cached) return cached
    this.loading += 1
    this.report()
    const loaded = this.fetch(part).catch(() => {
      this.failed.add(part.id)
      return boxFor(part)
    })
    const done = loaded.finally(() => {
      this.loading -= 1
      this.report()
    })
    this.geometries.set(part.id, done)
    return done
  }

  private async fetch(part: ModelPart): Promise<BufferGeometry> {
    if (this.base === undefined) throw new Error("no models base configured")
    const gltf = await this.loader.loadAsync(modelUrl(part, this.base))
    let found: BufferGeometry | undefined
    gltf.scene.traverse((node) => {
      if (!found && node instanceof Mesh) found = node.geometry
    })
    if (!found) throw new Error(`${part.id} has no mesh`)
    return found
  }

  private report() {
    this.onStatus({ loading: this.loading, failed: [...this.failed].sort() })
  }

  dispose() {
    this.geometries.clear()
  }
}

export function boxFor(part: ModelPart): BufferGeometry {
  return new BoxGeometry(part.sizeMm.x, part.sizeMm.y, part.sizeMm.z)
}
