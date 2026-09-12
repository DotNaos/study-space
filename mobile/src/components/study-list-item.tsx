import { NativeContainer, Stack, Text, designTokens } from "@dotnaos/ui/native";
import type { ReactNode } from "react";
import { Pressable, type StyleProp, type ViewStyle } from "react-native";

import { useStudyColors } from "@/lib/theme";

export function StudyListItem({
  disabled = false,
  leading,
  onPress,
  style,
  subtitle,
  title,
  trailing,
}: {
  disabled?: boolean;
  leading?: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  subtitle?: string;
  title: string;
  trailing?: ReactNode;
}) {
  const colors = useStudyColors();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.72 : 1 }, style]}
    >
      <NativeContainer
        surface="raised"
        radius={4}
        padding={3}
        style={{
          minHeight: 68,
          backgroundColor: colors.surface,
          borderColor: colors.border,
        }}
      >
        <Stack align="center" direction="horizontal" gap={3}>
          {leading}
          <Stack gap={1} style={{ flex: 1 }}>
            <Text
              numberOfLines={2}
              size="l"
              text={title}
              style={{ color: colors.text, fontWeight: "600", lineHeight: 21 }}
            />
            {subtitle ? (
              <Text
                numberOfLines={2}
                size="s"
                text={subtitle}
                style={{ color: colors.textMuted, lineHeight: 17 }}
              />
            ) : null}
          </Stack>
          {trailing}
        </Stack>
      </NativeContainer>
    </Pressable>
  );
}
