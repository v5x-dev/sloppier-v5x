import "./global.css"
import { Merriweather_400Regular } from "@expo-google-fonts/merriweather"
import { Button, Host, Text } from "@expo/ui"
import { useFonts } from "expo-font"
import { buttonStyle } from "@expo/ui/swift-ui/modifiers"

export default function App() {
  const [fontsLoaded] = useFonts({ Merriweather: Merriweather_400Regular })

  if (!fontsLoaded) return null

  return (
    <Host matchContents>
      <Button
        modifiers={[buttonStyle("glass")]}
        onPress={() => alert("Pressed!")}
      >
        <Text style={{ fontFamily: "Merriweather" }}>Press me</Text>
      </Button>
    </Host>
  )
}
