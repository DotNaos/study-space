import { useState } from "react";
import { Image } from "expo-image";
import { Text, View } from "react-native";

import type { Course } from "@/lib/api";
import { courseImagePath } from "@/lib/course-library";
import { studyUrl } from "@/lib/api";
import { useStudyColors } from "@/lib/theme";

export function CourseArtwork({ course, size = 56 }: { course: Course; size?: number }) {
  const colors = useStudyColors();
  const path = courseImagePath(course);
  const source = path ? studyUrl(path) : undefined;
  const [failed, setFailed] = useState(false);

  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        borderCurve: "continuous",
        overflow: "hidden",
        backgroundColor: colors.surfaceSecondary,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text selectable style={{ color: colors.muted, fontSize: size * 0.34, fontWeight: "600" }}>
        {course.name.trim().slice(0, 1).toLocaleUpperCase("de") || "K"}
      </Text>
      {source && !failed ? (
        <Image
          source={{ uri: source }}
          contentFit="cover"
          style={{ position: "absolute", inset: 0 }}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}
