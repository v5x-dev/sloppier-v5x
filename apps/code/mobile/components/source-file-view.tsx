import { useEffect, useMemo, useRef, useState } from "react"
import {
  FlatList,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
} from "react-native"
import {
  highlightSource,
  sourceColors,
  type SourceToken,
} from "@/lib/source-highlighting"
import {
  columnAt,
  contentWidth as measureContentWidth,
  gutterFontSize,
  gutterPaddingRight,
  gutterWidth as measureGutterWidth,
  sourceFontSize,
  sourceLineHeight,
  sourcePaddingVertical,
  tokenFont,
  type SourceScroll,
} from "@/lib/source-layout"

export function SourceFileView({
  contents,
  path,
  backgroundColor,
  onEdit,
}: {
  contents: string
  path: string
  backgroundColor: string
  // Called with the caret offset under a tap and the current scroll position.
  onEdit?: (offset: number, scroll: SourceScroll) => void
}) {
  const normalized = useMemo(() => contents.replace(/\r\n?/g, "\n"), [contents])
  const lines = useMemo(() => normalized.split("\n"), [normalized])
  const lineStarts = useMemo(() => {
    const starts: number[] = []
    let offset = 0
    for (const line of lines) {
      starts.push(offset)
      offset += line.length + 1
    }
    return starts
  }, [lines])
  const [highlight, setHighlight] = useState<{
    contents: string
    path: string
    tokens: SourceToken[][]
  } | null>(null)
  const [highlightError, setHighlightError] = useState(false)
  useEffect(() => {
    let active = true
    setHighlightError(false)
    void highlightSource(normalized, path)
      .then((tokens) => {
        if (active) setHighlight({ contents: normalized, path, tokens })
      })
      .catch(() => {
        if (active) setHighlightError(true)
      })
    return () => {
      active = false
    }
  }, [normalized, path])
  const tokens =
    highlight?.contents === normalized && highlight.path === path
      ? highlight.tokens
      : null
  const scroll = useRef<SourceScroll>({ x: 0, y: 0 })
  const { width } = useWindowDimensions()
  const gutterWidth = measureGutterWidth(lines.length)
  const contentWidth = useMemo(
    () => measureContentWidth(lines, width),
    [lines, width]
  )
  return (
    <View style={{ flex: 1, backgroundColor }}>
      {highlightError ? (
        <Text style={{ color: sourceColors.gutter, padding: 8, fontSize: 12 }}>
          Syntax highlighting unavailable. Showing plain text.
        </Text>
      ) : null}
      <ScrollView
        horizontal
        style={{ flex: 1 }}
        contentContainerStyle={{ width: contentWidth }}
        scrollEventThrottle={16}
        onScroll={(event) => {
          scroll.current.x = event.nativeEvent.contentOffset.x
        }}
      >
        <FlatList
          style={{ width: contentWidth }}
          contentContainerStyle={{ paddingVertical: sourcePaddingVertical }}
          data={lines}
          extraData={tokens}
          keyExtractor={(_, index) => String(index)}
          initialNumToRender={40}
          maxToRenderPerBatch={40}
          scrollEventThrottle={16}
          onScroll={(event) => {
            scroll.current.y = event.nativeEvent.contentOffset.y
          }}
          getItemLayout={(_, index) => ({
            length: sourceLineHeight,
            offset: sourceLineHeight * index,
            index,
          })}
          renderItem={({ item, index }) => {
            // `x` is measured from the start of the line's text.
            const edit = onEdit
              ? (x: number) =>
                  onEdit(lineStarts[index] + columnAt(item, x), {
                    ...scroll.current,
                  })
              : undefined
            return (
              <Pressable
                onPress={
                  edit &&
                  ((event) =>
                    edit(
                      Math.max(0, event.nativeEvent.locationX - gutterWidth)
                    ))
                }
                disabled={!edit}
                style={{ height: sourceLineHeight, flexDirection: "row" }}
              >
                <Text
                  style={{
                    width: gutterWidth,
                    paddingRight: gutterPaddingRight,
                    textAlign: "right",
                    fontFamily: "JetBrainsMono",
                    fontSize: gutterFontSize,
                    lineHeight: sourceLineHeight,
                    color: sourceColors.gutter,
                  }}
                >
                  {index + 1}
                </Text>
                <Text
                  selectable
                  onPress={
                    edit && ((event) => edit(event.nativeEvent.locationX))
                  }
                  selectionColor={sourceColors.selection}
                  style={{
                    fontFamily: "JetBrainsMono",
                    fontSize: sourceFontSize,
                    lineHeight: sourceLineHeight,
                    color: sourceColors.foreground,
                  }}
                >
                  {tokens?.[index]?.length
                    ? tokens[index].map((token, tokenIndex) => (
                        <Text
                          key={tokenIndex}
                          style={{
                            color: token.color ?? sourceColors.foreground,
                            fontFamily: tokenFont(token.fontStyle),
                          }}
                        >
                          {token.content}
                        </Text>
                      ))
                    : item || " "}
                </Text>
              </Pressable>
            )
          }}
        />
      </ScrollView>
    </View>
  )
}
