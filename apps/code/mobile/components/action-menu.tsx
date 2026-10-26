import { useState, type ReactElement } from "react"
import { Check } from "phosphor-react-native"
import { Modal, Platform, Pressable, Text, View } from "react-native"
import { MenuView, type MenuAction } from "@expo/ui/community/menu"

type Props = {
  title: string
  actions: MenuAction[]
  onSelect: (id: string) => void
  children: ReactElement
  dark: boolean
}

export function ActionMenu({
  title,
  actions,
  onSelect,
  children,
  dark,
}: Props) {
  const [open, setOpen] = useState(false)
  if (Platform.OS !== "web")
    return (
      <MenuView
        title={title}
        actions={actions}
        onPressAction={({ nativeEvent }) => onSelect(nativeEvent.event)}
        shouldOpenOnLongPress={false}
      >
        {children}
      </MenuView>
    )
  const foreground = dark ? "#FBFAF9" : "#0C0A09"
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
      >
        {children}
      </Pressable>
      <Modal
        transparent
        visible={open}
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)}>
          <View
            accessibilityRole="menu"
            style={{
              position: "absolute",
              right: 16,
              top: 64,
              width: 260,
              padding: 8,
              borderRadius: 16,
              backgroundColor: dark ? "#1D1816" : "#FFFFFF",
              borderWidth: 1,
              borderColor: dark ? "#FFFFFF26" : "#E8E4E3",
            }}
          >
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
          </View>
        </Pressable>
      </Modal>
    </>
  )
}
