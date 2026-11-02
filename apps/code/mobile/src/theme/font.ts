import { Merriweather_400Regular } from "@expo-google-fonts/merriweather"
import { useFonts } from "expo-font"

export const fontFamily = "Merriweather_400Regular"

export function useAppFont() {
  const [loaded, error] = useFonts({ Merriweather_400Regular })
  return loaded || !!error
}
