import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { Merriweather_400Regular } from "@expo-google-fonts/merriweather";
import { ConvexProviderWithAuth } from "convex/react";
import { useState } from "react";
import { View } from "react-native";
import { GlassButton } from "./components/GlassButton";
import { Text } from "./components/Text";
import { convex } from "./lib/convex";
import { AuthProvider, useAuth, useConvexAuth } from "./lib/auth";
import "./global.css";

export default function App() {
  const [fontsLoaded] = useFonts({ Merriweather_400Regular });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useConvexAuth}>
        <Home />
      </ConvexProviderWithAuth>
    </AuthProvider>
  );
}

function Home() {
  const { status, user, signIn, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (status === "loading") return <View className="flex-1 bg-background" />;

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background px-8">
      {status === "signedIn" && user ? (
        <>
          <Text className="text-foreground">
            Signed in as {user.first_name ?? user.email}
          </Text>
          <GlassButton label="Sign out" onPress={() => void signOut()} />
        </>
      ) : (
        <>
          <Text className="text-foreground">
            Open up App.tsx to start working on your app!
          </Text>
          <GlassButton
            label="Sign in"
            onPress={() => {
              setError(null);
              void signIn().then(setError);
            }}
          />
        </>
      )}
      {error ? <Text className="text-destructive">{error}</Text> : null}
      <StatusBar style="auto" />
    </View>
  );
}
