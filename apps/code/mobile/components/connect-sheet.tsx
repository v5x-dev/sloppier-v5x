import { useEffect } from "react"
import {
  BottomSheet,
  Column,
  Host,
  List,
  ListItem,
  TextInput,
  useNativeState,
} from "@expo/ui"
import { ThemedList } from "@/components/themed-list"
import {
  PrimaryButton,
  rowModifiers,
  SheetText,
  SheetTitle,
  useSheetColors,
} from "@/components/sheet-ui"
import {
  connect,
  disconnect,
  pair,
  startScan,
  stopScan,
  useBrain,
} from "@/lib/brain"

// Connect to a V5 Brain over Bluetooth. Scanning runs while the sheet is
// open and no Brain is connected; the connection outlives the sheet.
export function ConnectSheet({
  isPresented,
  onDismiss,
}: {
  isPresented: boolean
  onDismiss: () => void
}) {
  const colors = useSheetColors()
  const brain = useBrain()
  const pin = useNativeState("")
  useEffect(() => {
    if (!isPresented) {
      stopScan()
      return
    }
    void startScan()
    return () => stopScan()
  }, [isPresented])
  return (
    <Host>
      <BottomSheet
        isPresented={isPresented}
        onDismiss={onDismiss}
        snapPoints={["half", "full"]}
        containerColor={colors.background}
      >
        <Column spacing={10} style={{ padding: 20 }}>
          <SheetTitle title="Connect" colors={colors} />
          {brain.phase === "connected" ? (
            <>
              <SheetText colors={colors}>
                {`Connected to ${brain.name ?? "V5 Brain"} over Bluetooth.`}
              </SheetText>
              <PrimaryButton
                label="Disconnect"
                colors={colors}
                onPress={() => void disconnect()}
              />
            </>
          ) : brain.phase === "pairing" ? (
            <>
              <SheetText colors={colors}>
                {brain.message ?? "Enter the PIN shown on your Brain."}
              </SheetText>
              <TextInput
                value={pin}
                placeholder="4-digit PIN"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                autoFocus
              />
              <PrimaryButton
                label="Pair"
                colors={colors}
                onPress={() => {
                  void pair(pin.get().trim())
                  pin.set("")
                }}
              />
            </>
          ) : (
            <SheetText colors={colors} muted>
              {brain.message ??
                (brain.phase === "connecting"
                  ? "Connecting…"
                  : "Turn on your V5 Brain to find it over Bluetooth.")}
            </SheetText>
          )}
          {brain.error ? (
            <SheetText colors={colors} error>
              {brain.error}
            </SheetText>
          ) : null}
        </Column>
        {brain.phase === "scanning" || brain.phase === "idle" ? (
          <ThemedList backgroundColor={colors.background}>
            <List.ForEach
              data={brain.devices}
              keyExtractor={(device) => device.id}
            >
              {({ item }) => (
                <ListItem
                  onPress={() => void connect(item.id)}
                  modifiers={rowModifiers(colors)}
                >
                  <SheetText colors={colors}>{item.name}</SheetText>
                </ListItem>
              )}
            </List.ForEach>
          </ThemedList>
        ) : null}
      </BottomSheet>
    </Host>
  )
}
