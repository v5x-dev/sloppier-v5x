import "../../global.css"

import { Stack } from "expo-router"

import { useAppFont } from "../theme/font"

export default function RootLayout() {
  const fontReady = useAppFont()

  if (!fontReady) return null

  return <Stack screenOptions={{ headerShown: false }} />
}
