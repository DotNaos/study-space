import { Button, Stack, Text, useNativeTheme } from "@dotnaos/ui/native";
import { ActivityIndicator } from "react-native";

export function ContentState({ loading, error, retry }: { loading: boolean; error?: string; retry: () => void }) {
  const { colors } = useNativeTheme();
  return <Stack gap={3} style={{ padding: 20 }}>
    {loading ? <ActivityIndicator color={colors.textMuted} accessibilityLabel="Inhalt wird geladen" /> : <>
      <Text selectable text={error || "Dieser Inhalt ist nicht verfügbar."} />
      <Button label="Erneut versuchen" variant="secondary" onPress={retry} />
    </>}
  </Stack>;
}
