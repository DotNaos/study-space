import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/stack";
import { useColorScheme } from "react-native";

import { useStudyColors } from "@/lib/theme";

export default function RootLayout() {
  const colors = useStudyColors();
  const base = useColorScheme() === "dark" ? DarkTheme : DefaultTheme;
  const navigationTheme = {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.accent,
      background: colors.background,
      card: colors.background,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
  };

  return (
    <ThemeProvider value={navigationTheme}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: colors.background },
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
        }}
      >
        <Stack.Screen name="index" options={{ title: "Kurse", headerLargeTitle: true }} />
        <Stack.Screen
          name="course/[courseId]"
          options={{ title: "Kurs", headerBackButtonDisplayMode: "minimal" }}
        />
      </Stack>
    </ThemeProvider>
  );
}
