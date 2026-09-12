import {
  Button,
  Card,
  NativeContainer,
  Stack as UIStack,
  Text,
  designTokens,
} from "@dotnaos/ui/native";
import { Image } from "expo-image";
import * as Linking from "expo-linking";
import { Stack as RouterStack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, View } from "react-native";

import { CourseArtwork } from "@/components/course-artwork";
import { StudyListItem } from "@/components/study-list-item";
import {
  api,
  message,
  studyUrl,
  type Course,
  type CourseModule,
  type CourseResource,
  type CourseSection,
} from "@/lib/api";
import {
  cleanCourseText,
  duplicateResourceName,
  formatFileSize,
  visibleModule,
  visibleResources,
} from "@/lib/course-library";
import { rootCourseSections, subsectionFor } from "@/lib/course-sections";
import { useStudyColors } from "@/lib/theme";

function sameServerPath(value?: string | null): string | undefined {
  return value?.startsWith("/") ? value : undefined;
}

function shortCourseTitle(course?: Course): string {
  if (!course) return "Kurs";
  return course.shortName.trim().replace(/^\(([^)]+)\)/, "$1") || "Kurs";
}

function labelTitle(module: CourseModule): string {
  const name = cleanCourseText(module.name);
  if (/^lernziele/i.test(name)) return "Lernziele";
  return name || "Hinweis";
}

function moduleTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    assign: "Aufgabe",
    book: "Buch",
    forum: "Forum",
    page: "Seite",
    quiz: "Quiz",
    resource: "Datei",
    subsection: "Unterabschnitt",
    url: "Link",
  };
  return labels[type] ?? "Aktivität";
}

function symbolFor(module: CourseModule, resource?: CourseResource): string {
  if (resource?.previewKind === "pdf" || resource?.mimeType === "application/pdf") return "doc.richtext";
  if (resource?.previewKind === "image" || resource?.mimeType?.startsWith("image/")) return "photo";
  if (module.type === "assign") return "checklist";
  if (module.type === "forum") return "bubble.left.and.bubble.right";
  if (module.type === "url") return "link";
  if (module.type === "quiz") return "questionmark.circle";
  return "doc";
}

function IconTile({ symbol }: { symbol: string }) {
  const colors = useStudyColors();
  return (
    <NativeContainer
      surface="sunken"
      radius={3}
      style={{ width: 42, height: 42, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted }}
    >
      <Image source={`sf:${symbol}`} style={{ width: 20, height: 20 }} tintColor={colors.textMuted} />
    </NativeContainer>
  );
}

function Chevron() {
  const colors = useStudyColors();
  return <Image source="sf:chevron.right" style={{ width: 11, height: 17 }} tintColor={colors.textMuted} />;
}

function LabelBlock({ module }: { module: CourseModule }) {
  const colors = useStudyColors();
  const title = labelTitle(module);
  const description = cleanCourseText(module.description);
  const duplicateDescription = description.toLocaleLowerCase("de") === title.toLocaleLowerCase("de");

  return (
    <UIStack gap={1} style={{ paddingHorizontal: designTokens.spacing[1], paddingVertical: designTokens.spacing[2] }}>
      <Text selectable size="l" text={title} style={{ color: colors.text, fontWeight: "700", lineHeight: 22 }} />
      {description && !duplicateDescription ? (
        <Text selectable text={description} style={{ color: colors.textMuted, lineHeight: 20 }} />
      ) : null}
    </UIStack>
  );
}

export default function CourseScreen() {
  const colors = useStudyColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ courseId: string; sectionId?: string }>();
  const sectionId = params.sectionId === undefined ? undefined : Number(params.sectionId);
  const courseId = Number(params.courseId);
  const [course, setCourse] = useState<Course>();
  const [sections, setSections] = useState<CourseSection[]>();
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isSafeInteger(courseId) || courseId <= 0 ||
        (sectionId !== undefined && (!Number.isSafeInteger(sectionId) || sectionId <= 0))) {
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
  }, [courseId, sectionId]);

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
      (sectionId === undefined
        ? rootCourseSections(sections ?? [])
        : (sections ?? []).filter((section) => section.id === sectionId))
        .map((section) => ({ ...section, data: section.modules.filter(visibleModule) }))
        .filter((section) => sectionId !== undefined || section.data.length > 0 || section.summary.trim()),
    [sections, sectionId],
  );

  const openPath = useCallback(async (path: string) => {
    await WebBrowser.openBrowserAsync(studyUrl(path));
  }, []);

  const openModule = useCallback(async (module: CourseModule) => {
    const resource = visibleResources(module)[0];
    const internal = sameServerPath(resource?.previewUrl ?? resource?.downloadUrl);
    if (internal) {
      await openPath(internal);
      return;
    }
    if (module.url && /^https?:\/\//i.test(module.url)) await Linking.openURL(module.url);
  }, [openPath]);

  if (!sections && !error) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <RouterStack.Screen options={{ title: shortCourseTitle(course) }} />
        <ActivityIndicator color={colors.textMuted} />
      </View>
    );
  }

  return (
    <>
      <RouterStack.Screen options={{ title: shortCourseTitle(course) }} />
      <SectionList
        sections={visibleSections}
        keyExtractor={(module) => String(module.id)}
        contentInsetAdjustmentBehavior="automatic"
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textMuted} />}
        style={{ flex: 1, backgroundColor: colors.background }}
        contentContainerStyle={{ paddingHorizontal: designTokens.spacing[4], paddingBottom: designTokens.spacing[5] }}
        ListHeaderComponent={
          <UIStack gap={3} style={{ paddingTop: designTokens.spacing[2], paddingBottom: designTokens.spacing[3] }}>
            {course && sectionId === undefined ? (
              <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
                <UIStack direction="horizontal" align="center" gap={3}>
                  <CourseArtwork course={course} size={68} />
                  <UIStack gap={1} style={{ flex: 1 }}>
                    <Text selectable text={course.name} style={{ color: colors.text, fontSize: 18, fontWeight: "700", lineHeight: 24 }} />
                    {course.shortName ? <Text selectable size="s" text={course.shortName} style={{ color: colors.textMuted }} /> : null}
                  </UIStack>
                </UIStack>
              </Card>
            ) : null}
            {error ? (
              <Card style={{ backgroundColor: colors.surface, borderColor: colors.border }}>
                <UIStack gap={3}>
                  <Text selectable text={error} style={{ color: colors.text, lineHeight: 20 }} />
                  <Button label="Erneut versuchen" variant="secondary" onPress={() => void load()} />
                </UIStack>
              </Card>
            ) : null}
          </UIStack>
        }
        ListEmptyComponent={
          sections && !error ? (
            <Text
              selectable
              text={sectionId === undefined
                ? "Dieser Kurs enthält noch keine sichtbaren Inhalte."
                : "Dieser Abschnitt ist derzeit nicht verfügbar."}
              style={{ color: colors.textMuted, paddingVertical: designTokens.spacing[5], textAlign: "center" }}
            />
          ) : null
        }
        renderSectionHeader={({ section }) => {
          const summary = cleanCourseText(section.summary);
          return (
            <UIStack gap={1} style={{ paddingTop: designTokens.spacing[5], paddingBottom: designTokens.spacing[2] }}>
              <Text selectable text={section.name || "Abschnitt"} style={{ color: colors.text, fontSize: 19, fontWeight: "700", lineHeight: 25 }} />
              {summary ? <Text selectable text={summary} style={{ color: colors.textMuted, lineHeight: 20 }} /> : null}
            </UIStack>
          );
        }}
        renderSectionFooter={({ section }) => section.data.length === 0 ? (
          <Text selectable text="Dieser Abschnitt enthält noch keine sichtbaren Inhalte."
            style={{ color: colors.textMuted, paddingBottom: designTokens.spacing[3] }} />
        ) : null}
        renderItem={({ item: module }) => {
          if (module.type === "subsection") {
            const target = subsectionFor(module, sections ?? []);
            return (
              <StudyListItem
               title={module.name || "Unterabschnitt"}
                titleNumberOfLines={0}
                subtitle={target ? "Unterabschnitt öffnen" : "Abschnitt derzeit nicht verfügbar"}
                leading={<IconTile symbol="folder" />}
                trailing={target ? <Chevron /> : undefined}
                onPress={target ? () => router.push({
                  pathname: "/course/[courseId]/section/[sectionId]",
                  params: { courseId: String(courseId), sectionId: String(target.id) },
                }) : undefined}
                style={{ marginBottom: designTokens.spacing[2] }}
              />
            );
          }
          if (module.type === "label") {
            return <LabelBlock module={module} />;
          }

          const resources = visibleResources(module);
          const canOpenModule = Boolean(module.url && /^https?:\/\//i.test(module.url));

          if (resources.length === 1) {
            const resource = resources[0];
            const path = sameServerPath(resource.previewUrl ?? resource.downloadUrl);
            const size = formatFileSize(resource.size);
            const subtitle = [
              duplicateResourceName(module.name, resource.name) ? undefined : resource.name,
              size,
            ].filter(Boolean).join(" · ") || moduleTypeLabel(module.type);
            const canOpen = Boolean(path || canOpenModule);

            return (
              <StudyListItem
                titleNumberOfLines={0}
                title={module.name || resource.name}
                subtitle={subtitle}
                leading={<IconTile symbol={symbolFor(module, resource)} />}
                trailing={canOpen ? <Chevron /> : undefined}
                disabled={!canOpen}
                onPress={() => path ? void openPath(path) : void openModule(module)}
                style={{ marginBottom: designTokens.spacing[2] }}
              />
            );
          }

          if (resources.length > 1) {
            return (
              <Card style={{ backgroundColor: colors.surface, borderColor: colors.border, marginBottom: designTokens.spacing[2] }}>
                <UIStack gap={3}>
                  <Text selectable size="l" text={module.name || moduleTypeLabel(module.type)} style={{ color: colors.text, fontWeight: "700", lineHeight: 22 }} />
                  {resources.map((resource) => {
                    const path = sameServerPath(resource.previewUrl ?? resource.downloadUrl);
                    const size = formatFileSize(resource.size);
                    return (
                      <StudyListItem
                        titleNumberOfLines={0}
                        key={resource.id ?? resource.name}
                        title={resource.name}
                        subtitle={size}
                        leading={<IconTile symbol={symbolFor(module, resource)} />}
                        trailing={path ? <Chevron /> : undefined}
                        disabled={!path}
                        onPress={() => path && void openPath(path)}
                      />
                    );
                  })}
                </UIStack>
              </Card>
            );
          }

          const description = cleanCourseText(module.description);
          return (
            <StudyListItem
              titleNumberOfLines={0}
              title={module.name || moduleTypeLabel(module.type)}
              subtitle={description || moduleTypeLabel(module.type)}
              leading={<IconTile symbol={symbolFor(module)} />}
              trailing={canOpenModule ? <Chevron /> : undefined}
              disabled={!canOpenModule}
              onPress={() => void openModule(module)}
              style={{ marginBottom: designTokens.spacing[2] }}
            />
          );
        }}
      />
    </>
  );
}
