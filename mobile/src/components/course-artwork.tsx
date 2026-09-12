import { Icon, NativeContainer } from "@dotnaos/ui/native";
import { Image } from "expo-image";
import { useState } from "react";
import { studyUrl, type Course } from "@/lib/api";
import { courseImagePath } from "@/lib/course-library";

export function CourseArtwork({ course, size = 42 }: { course: Course; size?: number }) {
  const path = courseImagePath(course);
  const source = path ? studyUrl(path) : undefined;
  const [failedSource, setFailedSource] = useState<string>();
  return <NativeContainer surface="sunken" radius={2} style={{ width: size, height: size, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
    <Icon name="image-off" color="muted" size={20} />
    {source && failedSource !== source ? <Image source={{ uri: source }} cachePolicy="memory-disk" recyclingKey={source} contentFit="cover" style={{ position: "absolute", inset: 0 }} onError={() => setFailedSource(source)} /> : null}
  </NativeContainer>;
}
