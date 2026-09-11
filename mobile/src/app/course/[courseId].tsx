import * as Linking from "expo-linking";
import { Stack, useLocalSearchParams } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from "react-native";

import {
  api,
  message,
  studyUrl,
  type Course,
  type CourseModule,
  type CourseSection,
} from "@/lib/api";
import { formatFileSize, visibleModule, visibleResources } from "@/lib/course-library";
import { useStudyColors } from "@/lib/theme";

function sameServerPath(value?: string | null): string | undefined {
  return value?.startsWith("/") ? value : undefined;
}

export default function CourseScreen() {
  const colors = useStudyColors();
  const params = useLocalSearchParams<{ courseId: string }>();
  const courseId = Number(params.courseId);
  const [course, setCourse] = useState<Course>();
  const [sections, setSections] = useState<CourseSection[]>();
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(courseId)) {
      setError("Ungültiger Kurs.");
      return;
    }
    setError("");
    try {
      const [allCourses, contents] = await Promise.all([
        api<Course[]>("/api/providers/moodle/courses"),
        api<CourseSection[]>(`/api/providers/moodle/courses/${courseId}/contents`),
      ]);
      setCourse(allCourses.find((item) => item.id === courseId));
      setSections(contents);
    } catch (loadError) {
      setError(message(loadError));
    }
  }, [courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const visibleSections = useMemo(
    () =>
      (sections ?? [])
        .map((section) => ({ ...section, data: section.modules.filter(visibleModule) }))
        .filter((section) => section.data.length > 0),
    [sections],
  );

  const openModule = useCallback(async (module: CourseModule) => {
    const resource = visibleResources(module)[0];
    const internal = sameServerPath(resource?.previewUrl ?? resource?.downloadUrl);
    if (internal) {
      await WebBrowser.openBrowserAsync(studyUrl(internal));
      return;
    }
    if (module.url && /^https?:\/\//i.test(module.url)) await Linking.openURL(module.url);
  }, []);

  if (!sections && !error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <Stack.Screen options={{ title: course?.name ?? "Kurs" }} />
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: course?.name ?? `Kurs ${courseId}` }} />
      <SectionList
        sections={visibleSections}
        keyExtractor={(module) => String(module.id)}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 36 }}
        ListHeaderComponent={
          error ? (
            <View style={{ gap: 10, paddingVertical: 18 }}>
              <Text selectable style={{ color: colors.text, fontSize: 15, lineHeight: 21 }}>
                {error}
              </Text>
              <Pressable onPress={() => void load()} hitSlop={8}>
                <Text selectable style={{ color: colors.text, fontWeight: "600" }}>
                  Erneut versuchen
                </Text>
              </Pressable>
            </View>
          ) : null
        }
        ListEmptyComponent={
          sections && !error ? (
            <Text selectable style={{ color: colors.muted, paddingVertical: 28, textAlign: "center" }}>
              Dieser Kurs enthält noch keine sichtbaren Inhalte.
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
              paddingTop: 22,
              paddingBottom: 8,
            }}
          >
            {section.name || "Abschnitt"}
          </Text>
        )}
        renderItem={({ item: module }) => {
          const resources = visibleResources(module);
          const canOpen = resources.some((resource) => sameServerPath(resource.previewUrl ?? resource.downloadUrl)) ||
            Boolean(module.url && /^https?:\/\//i.test(module.url));

          return (
            <View
              style={{
                gap: 10,
                padding: 14,
                borderRadius: 16,
                borderCurve: "continuous",
                backgroundColor: colors.surface,
                marginBottom: 8,
              }}
            >
              <Text selectable style={{ color: colors.text, fontSize: 16, fontWeight: "600", lineHeight: 21 }}>
                {module.name || module.type}
              </Text>
              {resources.map((resource) => {
                const size = formatFileSize(resource.size);
                const path = sameServerPath(resource.previewUrl ?? resource.downloadUrl);
                return (
                  <Pressable
                    key={resource.id ?? resource.name}
                    disabled={!path}
                    onPress={() => path && void WebBrowser.openBrowserAsync(studyUrl(path))}
                    style={({ pressed }) => ({
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 10,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderCurve: "continuous",
                      backgroundColor: colors.surfaceSecondary,
                      opacity: pressed ? 0.65 : path ? 1 : 0.55,
                    })}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text selectable numberOfLines={2} style={{ color: colors.text, fontSize: 14, fontWeight: "500" }}>
                        {resource.name}
                      </Text>
                      {size ? (
                        <Text selectable style={{ color: colors.muted, fontSize: 12 }}>
                          {size}
                        </Text>
                      ) : null}
                    </View>
                    {path ? <Text selectable style={{ color: colors.muted, fontSize: 20 }}>›</Text> : null}
                  </Pressable>
                );
              })}
              {resources.length === 0 && canOpen ? (
                <Pressable
                  onPress={() => void openModule(module)}
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    backgroundColor: colors.accent,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text selectable style={{ color: colors.accentText, fontSize: 13, fontWeight: "600" }}>
                    Öffnen
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        }}
      />
    </>
  );
}
