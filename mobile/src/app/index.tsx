import { Button, Icon, ListItem, Screen, SearchField, SectionHeader, Stack, Text, designTokens, useNativeTheme } from "@dotnaos/ui/native";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList } from "react-native";

import { CourseArtwork } from "@/components/course-artwork";
import { api, message, type Course } from "@/lib/api";
import { courseSubtitle, groupCourses } from "@/lib/course-library";

export default function CoursesScreen() {
  const router = useRouter();
  const { colors } = useNativeTheme();
  const [courses, setCourses] = useState<Course[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setError("");
    try { setCourses(await api<Course[]>("/api/providers/moodle/courses")); }
    catch (loadError) { setError(message(loadError)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);
  const sections = useMemo(() => groupCourses(courses ?? [], query), [courses, query]);

  return (
    <Screen footer={<SearchField value={query} onValueChange={setQuery} placeholder="Kurse durchsuchen" accessibilityLabel="Kurse durchsuchen" clearLabel="Suche löschen" />}>
      <SectionList
        sections={sections}
        keyExtractor={(course) => String(course.id)}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: designTokens.spacing[4], paddingBottom: designTokens.spacing[4] }}
        ListHeaderComponent={error ? <Stack gap={2} style={{ paddingVertical: designTokens.spacing[3] }}>
          <Text selectable color="danger" text={error} />
          <Button label="Erneut versuchen" variant="secondary" onPress={() => void load()} />
        </Stack> : !courses ? <ActivityIndicator color={colors.textMuted} style={{ padding: designTokens.spacing[4] }} /> : null}
        ListEmptyComponent={courses && !error ? <Text selectable color="muted" text={query ? "Keine passenden Kurse gefunden." : "Keine Kurse verfügbar."} style={{ paddingVertical: designTokens.spacing[4] }} /> : null}
        renderSectionHeader={({ section }) => <SectionHeader title={section.semester.label} />}
        renderItem={({ item: course }) => <ListItem
          title={course.name}
          subtitle={courseSubtitle(course)}
          leading={<CourseArtwork course={course} size={42} />}
          trailing={<Icon name="chevron-right" color="muted" size={18} />}
          onPress={() => router.push({ pathname: "/course/[courseId]", params: { courseId: String(course.id) } })}
        />}
      />
    </Screen>
  );
}
