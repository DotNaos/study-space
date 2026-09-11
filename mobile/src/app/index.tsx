import { Link } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  TextInput,
  View,
} from "react-native";

import { CourseArtwork } from "@/components/course-artwork";
import { api, message, type Course } from "@/lib/api";
import { courseSubtitle, groupCourses } from "@/lib/course-library";
import { useStudyColors } from "@/lib/theme";

export default function CoursesScreen() {
  const colors = useStudyColors();
  const [courses, setCourses] = useState<Course[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      setCourses(await api<Course[]>("/api/providers/moodle/courses"));
    } catch (loadError) {
      setError(message(loadError));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const sections = useMemo(() => groupCourses(courses ?? [], query), [courses, query]);

  if (!courses && !error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(course) => String(course.id)}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
      ListHeaderComponent={
        <View style={{ paddingVertical: 12, gap: 12 }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Kurse durchsuchen"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={{
              minHeight: 42,
              borderRadius: 12,
              borderCurve: "continuous",
              backgroundColor: colors.surfaceSecondary,
              color: colors.text,
              paddingHorizontal: 14,
              fontSize: 16,
            }}
          />
          {error ? (
            <View style={{ gap: 10, padding: 14, borderRadius: 14, borderCurve: "continuous", backgroundColor: colors.surface }}>
              <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>
                {error}
              </Text>
              <Pressable onPress={() => void load()} hitSlop={8}>
                <Text selectable style={{ color: colors.text, fontWeight: "600" }}>
                  Erneut versuchen
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        courses && !error ? (
          <Text selectable style={{ color: colors.muted, paddingVertical: 28, textAlign: "center" }}>
            {query ? "Keine passenden Kurse gefunden." : "Keine Kurse verfügbar."}
          </Text>
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <Text
          selectable
          style={{
            color: colors.muted,
            fontSize: 13,
            fontWeight: "600",
            textTransform: "uppercase",
            letterSpacing: 0.5,
            paddingTop: 18,
            paddingBottom: 8,
          }}
        >
          {section.semester.label}
        </Text>
      )}
      renderItem={({ item: course }) => {
        const subtitle = courseSubtitle(course);
        return (
          <Link
            href={{ pathname: "/course/[courseId]", params: { courseId: String(course.id) } }}
            asChild
          >
            <Pressable
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: 13,
                paddingVertical: 11,
                paddingHorizontal: 12,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: colors.surface,
                opacity: pressed ? 0.65 : 1,
                marginBottom: 8,
              })}
            >
              <CourseArtwork course={course} />
              <View style={{ flex: 1, gap: 3 }}>
                <Text selectable numberOfLines={2} style={{ color: colors.text, fontSize: 16, fontWeight: "600", lineHeight: 21 }}>
                  {course.name}
                </Text>
                {subtitle ? (
                  <Text selectable numberOfLines={1} style={{ color: colors.muted, fontSize: 13 }}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              <Text selectable style={{ color: colors.muted, fontSize: 24 }}>
                ›
              </Text>
            </Pressable>
          </Link>
        );
      }}
    />
  );
}
