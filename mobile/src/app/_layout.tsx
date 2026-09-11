import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router";
import { Stack } from "expo-router/stack";
import { useColorScheme } from "react-native";

export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ title: "Kurse", headerLargeTitle: true }} />
        <Stack.Screen name="course/[courseId]" options={{ title: "Kurs" }} />
      </Stack>
    </ThemeProvider>
  );
}
