import { useCallback, useRef, useState } from "react"
import { Text, View } from "react-native"
import {
  BottomSheet,
  Column,
  Host,
  RNHostView,
  TextInput,
  useNativeState,
} from "@expo/ui"
import { useMutation } from "convex/react"
import { api } from "@workspace/backend/api"
import type { Doc } from "@workspace/backend/dataModel"
import { GlassButton } from "@/components/glass-button"

type Props = {
  program: Doc<"programs">
  onClose: () => void
  colors: {
    foreground: string
    mutedForeground: string
    muted: string
    primary: string
    primaryForeground: string
    border: string
    popover: string
  }
}
export function RenameProgramSheet({ program, onClose, colors }: Props) {
  const rename = useMutation(api.programs.rename)
  const name = useNativeState(program.name)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)
  const updateName = useCallback(
    (value: string) => {
      "worklet"
      name.value = value
    },
    [name]
  )
  const save = async () => {
    if (busy.current) return
    const nextName = name.value.trim()
    if (!nextName || nextName.length > 80) {
      setError("Enter a name between 1 and 80 characters.")
      return
    }
    busy.current = true
    setPending(true)
    setError(null)
    try {
      await rename({ programId: program._id, name: nextName })
      onClose()
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not rename the program."
      )
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <Host matchContents>
      <BottomSheet
        isPresented
        onDismiss={onClose}
        containerColor={colors.popover}
      >
        <Column spacing={16} style={{ width: "100%", padding: 24 }}>
          <RNHostView matchContents={{ vertical: true }}>
            <Text
              style={{
                fontFamily: "MerriweatherSemiBold",
                fontSize: 22,
                color: colors.foreground,
              }}
            >
              Rename program
            </Text>
          </RNHostView>
          <TextInput
            value={name}
            onChangeText={updateName}
            onSubmitEditing={() => {
              void save()
            }}
            editable={!pending}
            autoFocus
            autoCorrect={false}
            selectTextOnFocus
            maxLength={80}
            returnKeyType="done"
            placeholder="Program name"
            placeholderTextColor={colors.mutedForeground}
            style={{
              width: "100%",
              height: 52,
              paddingHorizontal: 16,
              backgroundColor: colors.muted,
              borderRadius: 12,
            }}
            textStyle={{
              fontFamily: "Merriweather",
              fontSize: 15,
              color: colors.foreground,
            }}
          />
          <RNHostView matchContents={{ vertical: true }}>
            <View style={{ width: "100%", gap: 12 }}>
              {error ? (
                <Text
                  accessibilityRole="alert"
                  style={{
                    fontFamily: "Merriweather",
                    fontSize: 12,
                    color: "#E7000B",
                  }}
                >
                  {error}
                </Text>
              ) : null}
              <GlassButton
                label="Save program name"
                disabled={pending}
                onPress={() => {
                  void save()
                }}
                tint={colors.primary}
                border={colors.border}
                height={48}
              >
                <Text
                  style={{
                    textAlign: "center",
                    fontFamily: "Merriweather",
                    color: colors.primaryForeground,
                  }}
                >
                  {pending ? "Saving…" : "Save"}
                </Text>
              </GlassButton>
              <GlassButton
                label="Cancel renaming"
                disabled={pending}
                onPress={onClose}
                tint={colors.muted}
                border={colors.border}
                height={48}
              >
                <Text
                  style={{
                    textAlign: "center",
                    fontFamily: "Merriweather",
                    color: colors.foreground,
                  }}
                >
                  Cancel
                </Text>
              </GlassButton>
            </View>
          </RNHostView>
        </Column>
      </BottomSheet>
    </Host>
  )
}
