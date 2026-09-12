import { NativeContainer, Text } from "@dotnaos/ui/native";
import { Image } from "expo-image";
import { useState } from "react";

import type { Course } from "@/lib/api";
import { studyUrl } from "@/lib/api";
import { courseImagePath } from "@/lib/course-library";
import { useStudyColors } from "@/lib/theme";

export function CourseArtwork({ course, size = 56 }: { course: Course; size?: number }) {
  const colors = useStudyColors();
  const path = courseImagePath(course);
  const source = path ? studyUrl(path) : undefined;
  const [failed, setFailed] = useState(false);

  return (
    <NativeContainer
      surface="sunken"
      radius={3}
      style={{
        width: size,
        height: size,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surfaceMuted,
      }}
    >
      <Text
        selectable
        text={course.name.trim().slice(0, 1).toLocaleUpperCase("de") || "K"}
        style={{ color: colors.textMuted, fontSize: size * 0.34, fontWeight: "600" }}
      />
      {source && !failed ? (
        <Image
          source={{ uri: source }}
          contentFit="cover"
          style={{ position: "absolute", inset: 0 }}
          onError={() => setFailed(true)}
        />
      ) : null}
      <NativeContainer
        pointerEvents="none"
        style={{ position: "absolute", inset: 0, borderRadius: 12, borderCurve: "continuous", borderWidth: 1, borderColor: colors.border }}
      />
    </NativeContainer>
  );
}
