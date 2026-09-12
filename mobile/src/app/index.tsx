import { Button, Card, Stack, Text, designTokens } from "@dotnaos/ui/native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, TextInput, View } from "react-native";

import { CourseArtwork } from "@/components/course-artwork";
import { StudyListItem } from "@/components/study-list-item";
import { api, message, type Course } from "@/lib/api";
import { courseSubtitle, groupCourses } from "@/lib/course-library";
import { useStudyColors } from "@/lib/theme";

function Chevron() {
  const colors = useStudyColors();
  return <Image source="sf:chevron.right" style={{ width: 12, height: 18 }} tintColor={colors.textMuted} />;
}

export default function CoursesScreen() {
  const router = useRouter();
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
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(course) => String(course.id)}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      stickySectionHeadersEnabled={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ paddingHorizontal: designTokens.spacing[4], paddingBottom: designTokens.spacing[5] }}
      ListHeaderComponent={
        <Stack gap={3} style={{ paddingTop: designTokens.spacing[2], paddingBottom: designTokens.spacing[3] }}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Kurse durchsuchen"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            accessibilityLabel="Kurse durchsuchen"
            style={{
              minHeight: 44,
              borderRadius: designTokens.radii[3],
              borderCurve: "continuous",
              borderColor: colors.border,
              borderWidth: 1,
              backgroundColor: colors.surfaceMuted,
              color: colors.text,
              fontSize: designTokens.typography.textL,
              paddingHorizontal: designTokens.spacing[3],
              paddingVertical: designTokens.spacing[2],
            }}
          />
          {error ? (
            <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
              <Stack gap={3}>
                <Text selectable text={error} style={{ color: colors.text, lineHeight: 20 }} />
                <Button label="Erneut versuchen" variant="primary" onPress={() => void load()} />
              </Stack>
            </Card>
          ) : null}
        </Stack>
      }
      ListEmptyComponent={
        courses && !error ? (
          <Text
            selectable
            text={query ? "Keine passenden Kurse gefunden." : "Keine Kurse verfügbar."}
            style={{ color: colors.textMuted, paddingVertical: designTokens.spacing[5], textAlign: "center" }}
          />
        ) : null
      }
      renderSectionHeader={({ section }) => (
        <Text
          selectable
          size="s"
          text={section.semester.label}
          style={{
            color: colors.textMuted,
            fontWeight: "700",
            letterSpacing: 0.8,
            textTransform: "uppercase",
            paddingTop: designTokens.spacing[4],
            paddingBottom: designTokens.spacing[2],
          }}
        />
      )}
      renderItem={({ item: course }) => (
        <StudyListItem
          title={course.name}
          subtitle={courseSubtitle(course)}
          leading={<CourseArtwork course={course} size={58} />}
          trailing={<Chevron />}
          onPress={() => router.push({ pathname: "/course/[courseId]", params: { courseId: String(course.id) } })}
          style={{ marginBottom: designTokens.spacing[2] }}
        />
      )}
    />
  );
}
