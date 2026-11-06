// Slots for instances: each Part in one instanced mesh holds a slot number. Removing a
// Part moves the last Part into the gap, so the slots stay packed from 0 to count - 1.

export class SlotTable {
  private readonly ids: string[] = []
  private readonly slots = new Map<string, number>()

  get count(): number {
    return this.ids.length
  }

  has(id: string): boolean {
    return this.slots.has(id)
  }

  slotOf(id: string): number | undefined {
    return this.slots.get(id)
  }

  idAt(slot: number): string | undefined {
    return this.ids[slot]
  }

  /** Adds an id at the end. Adding an id that is already here returns its slot. */
  add(id: string): number {
    const existing = this.slots.get(id)
    if (existing !== undefined) return existing
    const slot = this.ids.length
    this.ids.push(id)
    this.slots.set(id, slot)
    return slot
  }

  /** Removes an id. Returns the freed slot and, if another id moved into it, that id. */
  remove(id: string): { slot: number; moved?: { id: string; slot: number } } | undefined {
    const slot = this.slots.get(id)
    if (slot === undefined) return undefined
    const last = this.ids.length - 1
    this.slots.delete(id)
    if (slot === last) {
      this.ids.pop()
      return { slot }
    }
    const movedId = this.ids[last]
    this.ids.pop()
    this.ids[slot] = movedId
    this.slots.set(movedId, slot)
    return { slot, moved: { id: movedId, slot } }
  }
}
