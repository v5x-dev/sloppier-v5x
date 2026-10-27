import { retryOnReconnect } from "@/lib/retry"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ActivityIndicator,
  Image,
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native"
import {
  CaretDown,
  CaretRight,
  FolderSimple,
  FolderOpen,
} from "phosphor-react-native"
import { useRouter } from "expo-router"
import { useAction } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Id } from "@workspace/backend/dataModel"
import { pierreFileIcon } from "@/lib/pierre-file-icons"
import { buildFileTree, flattenFileTree } from "@/lib/file-tree"

type Props = {
  programId: Id<"programs">
  ready: boolean
  foreground: string
  mutedForeground: string
  muted: string
}

export function ProgramFileTree({
  programId,
  ready,
  foreground,
  mutedForeground,
  muted,
}: Props) {
  const router = useRouter()
  const listFiles = useAction(api.codeStorage.listFiles)
  const [paths, setPaths] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [selected, setSelected] = useState<string | null>(null)
  const generation = useRef(0)
  const load = useCallback(async () => {
    if (!ready) return
    const request = ++generation.current
    setRefreshing(true)
    setError(null)
    try {
      const all: string[] = []
      let cursor: string | undefined
      const seenCursors = new Set<string>()
      do {
        const page = await retryOnReconnect(() =>
          listFiles({ programId, cursor })
        )
        if (request !== generation.current) return
        all.push(...page.paths)
        cursor = page.hasMore ? page.nextCursor : undefined
        if (page.hasMore && (!cursor || seenCursors.has(cursor)))
          throw new Error("Could not load the remaining files. Try again.")
        if (cursor) seenCursors.add(cursor)
      } while (cursor)
      setPaths([...new Set(all)])
    } catch (cause) {
      if (request === generation.current)
        setError(
          cause instanceof Error ? cause.message : "Could not load files."
        )
    } finally {
      if (request === generation.current) setRefreshing(false)
    }
  }, [listFiles, programId, ready])
  useEffect(() => {
    void load()
    return () => {
      generation.current++
    }
  }, [load])
  const tree = useMemo(() => buildFileTree(paths ?? []), [paths])
  const rows = useMemo(() => flattenFileTree(tree, expanded), [tree, expanded])
  const labelStyle = {
    fontFamily: "Merriweather",
    fontSize: 13,
    color: mutedForeground,
  }
  return (
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingTop: 8, paddingBottom: 24 }}
      data={rows}
      keyExtractor={({ node }) => node.path}
      extraData={{ expanded, selected }}
      refreshControl={
        <RefreshControl
          refreshing={paths !== null && refreshing}
          onRefresh={() => {
            void load()
          }}
          tintColor={mutedForeground}
        />
      }
      ListHeaderComponent={
        error ? (
          <View style={{ padding: 16, gap: 12 }}>
            <Text accessibilityRole="alert" style={labelStyle}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void load()
              }}
              style={{ paddingVertical: 10 }}
            >
              <Text style={{ ...labelStyle, color: foreground }}>Retry</Text>
            </Pressable>
          </View>
        ) : undefined
      }
      ListEmptyComponent={
        paths === null && !error ? (
          <ActivityIndicator
            accessibilityLabel={
              ready ? "Loading files" : "Preparing repository"
            }
            color={mutedForeground}
            style={{ padding: 24 }}
          />
        ) : !error ? (
          <Text style={{ ...labelStyle, padding: 16 }}>
            No files in this program.
          </Text>
        ) : undefined
      }
      renderItem={({ item: { node, depth } }) => {
        const open = expanded.has(node.path)
        const Chevron = open ? CaretDown : CaretRight
        const FolderIcon = open ? FolderOpen : FolderSimple
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={node.path}
            accessibilityState={
              node.directory
                ? { expanded: open }
                : { selected: selected === node.path }
            }
            onPress={() => {
              if (!node.directory) {
                setSelected(node.path)
                router.push({
                  pathname: "/programs/[program-id]/file",
                  params: { "program-id": programId, path: node.path },
                })
                return
              }
              setExpanded((current) => {
                const next = new Set(current)
                if (next.has(node.path)) next.delete(node.path)
                else next.add(node.path)
                return next
              })
            }}
            style={({ pressed }) => ({
              marginHorizontal: 8,
              minHeight: 42,
              paddingVertical: 9,
              paddingLeft: 8 + depth * 18,
              paddingRight: 8,
              borderRadius: 12,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor:
                pressed || selected === node.path ? muted : "transparent",
            })}
          >
            {node.directory ? (
              <Chevron size={12} color={mutedForeground} />
            ) : (
              <View style={{ width: 12 }} />
            )}
            {node.directory ? (
              <FolderIcon size={17} color={mutedForeground} />
            ) : (
              <Image
                source={pierreFileIcon(node.path)}
                resizeMode="contain"
                style={{ width: 17, height: 17 }}
              />
            )}
            <Text
              numberOfLines={1}
              style={{
                flex: 1,
                minWidth: 0,
                fontFamily: "Merriweather",
                fontSize: 14,
                color: foreground,
              }}
            >
              {node.name}
            </Text>
          </Pressable>
        )
      }}
    />
  )
}
