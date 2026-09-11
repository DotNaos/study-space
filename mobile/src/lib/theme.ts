import { useColorScheme } from "react-native";

export function useStudyColors() {
  const dark = useColorScheme() === "dark";
  return {
    background: dark ? "#000000" : "#F7F7F5",
    surface: dark ? "#171717" : "#FFFFFF",
    surfaceSecondary: dark ? "#222222" : "#EEEEEB",
    text: dark ? "#F5F5F5" : "#151515",
    muted: dark ? "#A6A6A6" : "#666666",
    border: dark ? "#2D2D2D" : "#E2E2DE",
    accent: dark ? "#FFFFFF" : "#151515",
    accentText: dark ? "#151515" : "#FFFFFF",
    destructive: "#D92D20",
  };
}
