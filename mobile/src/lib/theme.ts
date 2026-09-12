import { designTokenThemes } from "@dotnaos/ui/native";
import { useColorScheme } from "react-native";

export function useStudyColors() {
  const mode = useColorScheme() === "dark" ? "dark" : "light";
  return designTokenThemes[mode].colors;
}
