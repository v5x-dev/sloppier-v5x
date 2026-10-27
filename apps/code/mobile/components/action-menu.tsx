import { useRef, useState, type ReactElement, type ComponentRef } from "react"
import { Check } from "phosphor-react-native"
import {
  Modal,
  Pressable,
  Text,
  View,
  ScrollView,
  useWindowDimensions,
} from "react-native"
import { type MenuAction } from "@expo/ui/community/menu"

type Props = {
  title: string
  actions: MenuAction[]
  onSelect: (id: string) => void
  children: ReactElement
  dark: boolean
  longPress?: boolean
  onPress?: () => void
  triggerHeight?: number
}

export function ActionMenu({
  title,
  actions,
  onSelect,
  children,
  dark,
  longPress = false,
  onPress,
  triggerHeight,
}: Props) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<ComponentRef<typeof View>>(null)
  const { width, height } = useWindowDimensions()
  const [anchor, setAnchor] = useState({ x: 16, y: 64 })
  const menuWidth = Math.min(280, width - 32)
  const showMenu = () => {
    trigger.current?.measureInWindow((x, y, triggerWidth, triggerHeight) => {
      setAnchor({
        x: Math.max(
          16,
          Math.min(x + triggerWidth - menuWidth, width - menuWidth - 16)
        ),
        y: Math.min(y + triggerHeight + 8, height - 160),
      })
      setOpen(true)
    })
  }
  const foreground = dark ? "#FBFAF9" : "#0C0A09"
  return (
    <>
      <View
        ref={trigger}
        collapsable={false}
        style={
          longPress
            ? { width: "100%", height: triggerHeight, alignSelf: "stretch" }
            : undefined
        }
      >
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={
            longPress ? { width: "100%", height: triggerHeight } : undefined
          }
        >
          {children}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
          onPress={longPress ? onPress : showMenu}
          onLongPress={longPress ? showMenu : undefined}
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
      </View>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={{ flex: 1 }}>
          <Pressable
            style={{ position: "absolute", inset: 0 }}
            onPress={() => setOpen(false)}
          />
          <View
            accessibilityRole="menu"
            style={{
              position: "absolute",
              left: anchor.x,
              top: anchor.y,
              width: menuWidth,
              maxHeight: height - anchor.y - 24,
              padding: 8,
              borderRadius: 16,
              backgroundColor: dark ? "#1D1816" : "#FFFFFF",
              borderWidth: 1,
              borderColor: dark ? "#FFFFFF26" : "#E8E4E3",
            }}
          >
            <ScrollView>
              <Text
                style={{
                  color: foreground,
                  fontFamily: "Merriweather",
                  fontSize: 12,
                  padding: 12,
                }}
              >
                {title}
              </Text>
              {actions
                .flatMap((action) => action.subactions ?? [action])
                .map((action) => (
                  <Pressable
                    key={action.id}
                    accessibilityRole="menuitem"
                    accessibilityState={{
                      selected: action.state === "on",
                      disabled: Boolean(action.attributes?.disabled),
                    }}
                    disabled={action.attributes?.disabled}
                    onPress={() => {
                      setOpen(false)
                      onSelect(action.id ?? action.title)
                    }}
                    style={{
                      padding: 12,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    {action.state === "on" ? (
                      <Check size={16} color={foreground} />
                    ) : null}
                    <Text
                      style={{
                        fontFamily: "Merriweather",
                        color: action.attributes?.destructive
                          ? "#E7000B"
                          : foreground,
                      }}
                    >
                      {action.title}
                    </Text>
                  </Pressable>
                ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  )
}
