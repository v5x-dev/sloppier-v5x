import { Image, Pressable, ScrollView, View } from "react-native"
import { useSafeAreaInsets } from "react-native-safe-area-context"
import { Text } from "../components/text"

const benefits = [
  {
    title: "Edit together",
    description:
      "Work on Program source with your workspace as changes happen.",
  },
  {
    title: "Build for V5",
    description: "Compile each Program's committed source for your Brain.",
  },
  {
    title: "Upload to your Brain",
    description: "Send a V5 binary to a slot and start the Program.",
  },
]

export default function Index() {
  const insets = useSafeAreaInsets()

  return (
    <View
      className="flex-1 bg-background px-6"
      style={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }}
    >
      <Image
        accessibilityLabel="code (by v5x)"
        source={require("../../assets/favicon.png")}
        className="size-8"
      />

      <ScrollView
        className="flex-1"
        contentContainerClassName="grow justify-center gap-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-3">
          <Text className="text-4xl leading-tight text-foreground">
            Program your V5 Brain with your team
          </Text>
          <Text className="text-lg leading-7 text-muted-foreground">
            Sign in to open your workspaces, edit Programs together, and upload
            them to your Brain.
          </Text>
        </View>

        <View className="gap-5 border-t border-border pt-6">
          {benefits.map(({ title, description }) => (
            <View key={title} className="gap-1">
              <Text className="text-base text-foreground">{title}</Text>
              <Text className="text-sm leading-5 text-muted-foreground">
                {description}
              </Text>
            </View>
          ))}
        </View>
      </ScrollView>

      <View className="gap-3">
        <Pressable
          accessibilityRole="button"
          className="h-14 items-center justify-center rounded-xl bg-primary active:bg-primary/90"
        >
          <Text className="text-base text-primary-foreground">Sign in</Text>
        </Pressable>
      </View>
    </View>
  )
}
