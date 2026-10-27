export type FileTreeNode = {
  path: string
  name: string
  directory: boolean
  children: FileTreeNode[]
}
export type FileTreeRow = { node: FileTreeNode; depth: number }

export function buildFileTree(paths: readonly string[]): FileTreeNode[] {
  const roots: FileTreeNode[] = []
  const nodes = new Map<string, FileTreeNode>()
  for (const path of paths) {
    if (path.startsWith(".v5x/")) continue
    const parts = path.split("/").filter(Boolean)
    let siblings = roots
    parts.forEach((name, index) => {
      const key = parts.slice(0, index + 1).join("/")
      let node = nodes.get(key)
      if (!node) {
        node = {
          path: key,
          name,
          directory: index < parts.length - 1,
          children: [],
        }
        nodes.set(key, node)
        siblings.push(node)
      }
      if (index < parts.length - 1) node.directory = true
      siblings = node.children
    })
  }
  const sort = (items: FileTreeNode[]) => {
    items.sort(
      (a, b) =>
        Number(b.directory) - Number(a.directory) ||
        a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    )
    items.forEach((node) => sort(node.children))
  }
  sort(roots)
  return roots
}

export function flattenFileTree(
  nodes: FileTreeNode[],
  expanded: ReadonlySet<string>
): FileTreeRow[] {
  const rows: FileTreeRow[] = []
  const visit = (items: FileTreeNode[], depth: number) => {
    for (const node of items) {
      rows.push({ node, depth })
      if (node.directory && expanded.has(node.path))
        visit(node.children, depth + 1)
    }
  }
  visit(nodes, 0)
  return rows
}
