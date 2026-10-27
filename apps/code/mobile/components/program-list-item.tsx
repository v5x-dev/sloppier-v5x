import {
  Image,
  Platform,
  Pressable,
  Text,
  View,
  type ImageSourcePropType,
} from "react-native"
import { useState } from "react"
import { MenuView, type MenuAction } from "@expo/ui/community/menu"
import { ActionMenu } from "./action-menu"

type Props = {
  name: string
  created: string
  templateName: string
  icon: ImageSourcePropType
  foreground: string
  mutedForeground: string
  pressedColor: string
  border: string
  onPress: () => void
  onAction: (action: string) => void
  actionsDisabled: boolean
  dark: boolean
}

// A plain RN press target inside a native context menu, as in T3 Code.
// The trigger contains no nested SwiftUI hosts or glass buttons.
export function ProgramListItem(props: Props) {
  const [width, setWidth] = useState(0)
  const actions: MenuAction[] = [
    {
      id: "rename",
      title: "Rename",
      image: Platform.OS === "ios" ? "pencil" : undefined,
      attributes: { disabled: props.actionsDisabled },
    },
    {
      id: "archive",
      title: "Archive",
      image: Platform.OS === "ios" ? "archivebox" : undefined,
      attributes: { disabled: props.actionsDisabled },
    },
  ]
  const row = (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      accessibilityLabel={`${props.name}, ${props.templateName}, ${props.created}`}
      accessibilityHint="Opens program. Hold for program actions."
      accessibilityActions={[
        { name: "rename", label: "Rename program" },
        { name: "archive", label: "Archive program" },
      ]}
      onAccessibilityAction={({ nativeEvent }) => {
        if (!props.actionsDisabled) props.onAction(nativeEvent.actionName)
      }}
      style={({ pressed }) => ({
        width: width || "100%",
        paddingHorizontal: 20,
        paddingVertical: 12,
        backgroundColor: pressed ? props.pressedColor : "transparent",
      })}
    >
      <View
        pointerEvents="none"
        style={{ flexDirection: "row", gap: 10, alignItems: "center" }}
      >
        <Image
          source={props.icon}
          resizeMode="contain"
          style={{ width: 18, height: 18, marginTop: 0 }}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <Text
            numberOfLines={2}
            style={{
              fontFamily: "MerriweatherSemiBold",
              fontSize: 15,
              lineHeight: 22,
              color: props.foreground,
            }}
          >
            {props.name}
          </Text>
        </View>
        <View style={{ width: 100, flexShrink: 0 }}>
          <Text
            numberOfLines={2}
            style={{
              fontFamily: "Merriweather",
              fontSize: 11,
              textAlign: "right",
              color: props.mutedForeground,
            }}
          >
            {props.created}
          </Text>
        </View>
      </View>
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          backgroundColor: props.border,
        }}
      />
    </Pressable>
  )
  if (Platform.OS === "web") {
    return (
      <ActionMenu
        title={props.name}
        actions={actions}
        onSelect={props.onAction}
        onPress={props.onPress}
        longPress
        dark={props.dark}
      >
        {row}
      </ActionMenu>
    )
  }
  return (
    <View
      style={{ width: "100%" }}
      onLayout={({ nativeEvent }) => setWidth(nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <MenuView
          actions={actions}
          shouldOpenOnLongPress
          onPressAction={({ nativeEvent }) => props.onAction(nativeEvent.event)}
          style={{ width }}
        >
          {row}
        </MenuView>
      ) : null}
    </View>
  )
}
