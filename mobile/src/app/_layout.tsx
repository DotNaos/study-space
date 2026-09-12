import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/stack";
import { NativeThemeProvider, useNativeTheme } from "@dotnaos/ui/native";


export default function RootLayout() {
  return <NativeThemeProvider><Navigation /></NativeThemeProvider>;
}

function Navigation() {
  const { colors, mode } = useNativeTheme();
  const base = mode === "dark" ? DarkTheme : DefaultTheme;
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
          headerTitleStyle: { color: colors.text },
        }}
      >
        <Stack.Screen name="index" options={{ title: "Kurse", headerLargeTitleEnabled: false }} />
        <Stack.Screen
          name="course/[courseId]"
          options={{ title: "Kurs", headerBackButtonDisplayMode: "minimal" }}
        />
        <Stack.Screen
          name="course/[courseId]/section/[sectionId]"
          options={{ title: "Abschnitt", headerBackButtonDisplayMode: "minimal" }}
        />
      </Stack>
    </ThemeProvider>
  );
}
