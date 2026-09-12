import {
  Button,
  Icon,
  ListItem,
  SectionHeader,
  Stack as UIStack,
  Text,
  designTokens,
  useNativeTheme,
  type IconName,
} from "@dotnaos/ui/native";
import * as Linking from "expo-linking";
import { Stack as RouterStack, useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, RefreshControl, SectionList, View } from "react-native";

import { CourseArtwork } from "@/components/course-artwork";
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

function sameServerPath(value?: string | null): string | undefined {
  return value?.startsWith("/api/") && !value.includes("\\") ? value : undefined;
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

function moduleIcon(type: string): IconName {
  if (type === "assign" || type === "quiz") return "clipboard-list";
  if (type === "forum") return "message";
  if (type === "url") return "link";
  if (type === "book") return "book-open";
  return "file-text";
}

function LabelBlock({ module }: { module: CourseModule }) {
  const title = labelTitle(module);
  const description = cleanCourseText(module.description);
  return <UIStack gap={1} style={{ paddingVertical: designTokens.spacing[2] }}>
    <Text selectable accessibilityRole="header" size="l" text={title} style={{ fontWeight: "600" }} />
    {description && description.toLocaleLowerCase("de") !== title.toLocaleLowerCase("de") ? <Text selectable color="muted" text={description} /> : null}
  </UIStack>;
}

export default function CourseScreen() {
  const { colors } = useNativeTheme();
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
              <UIStack gap={2}>
                <UIStack direction="horizontal" align="center" gap={3}>
                  <CourseArtwork course={course} size={42} />
                  <UIStack gap={1} style={{ flex: 1 }}>
                    <Text selectable text={course.name} style={{ color: colors.text, fontSize: 18, fontWeight: "600", lineHeight: 24 }} />
                    {course.shortName ? <Text selectable size="s" text={course.shortName} style={{ color: colors.textMuted }} /> : null}
                  </UIStack>
                </UIStack>
              </UIStack>
            ) : null}
            {error ? (
              <UIStack gap={2}>
                <UIStack gap={3}>
                  <Text selectable text={error} style={{ color: colors.text, lineHeight: 20 }} />
                  <Button label="Erneut versuchen" variant="secondary" onPress={() => void load()} />
                </UIStack>
              </UIStack>
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
        renderSectionHeader={({ section }) => <SectionHeader title={section.name || "Abschnitt"} subtitle={cleanCourseText(section.summary) || undefined} />}
        renderSectionFooter={({ section }) => section.data.length === 0 ? (
          <Text selectable text="Dieser Abschnitt enthält noch keine sichtbaren Inhalte."
            style={{ color: colors.textMuted, paddingBottom: designTokens.spacing[3] }} />
        ) : null}
        renderItem={({ item: module }) => {
          if (module.type === "subsection") {
            const target = subsectionFor(module, sections ?? []);
            return (
              <ListItem
               title={module.name || "Unterabschnitt"}
                titleNumberOfLines={0}
                subtitle={target ? undefined : "Abschnitt derzeit nicht verfügbar"}
                leading={<Icon name="folder" color="muted" size={26} />}
                trailing={target ? <Icon name="chevron-right" color="muted" size={18} /> : undefined}
                onPress={target ? () => router.push({
                  pathname: "/course/[courseId]/section/[sectionId]",
                  params: { courseId: String(courseId), sectionId: String(target.id) },
                }) : undefined}

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
              <ListItem
                titleNumberOfLines={0}
                title={module.name || resource.name}
                subtitle={subtitle}
                leading={<Icon.File filename={resource.name} mimeType={resource.mimeType} />}
                trailing={canOpen ? <Icon name="chevron-right" color="muted" size={18} /> : undefined}
                disabled={!canOpen}
                onPress={() => path ? void openPath(path) : void openModule(module)}

              />
            );
          }

          if (resources.length > 1) {
            return (
              <UIStack gap={1}>
                <UIStack gap={3}>
                  <Text selectable size="l" text={module.name || moduleTypeLabel(module.type)} style={{ color: colors.text, fontWeight: "600", lineHeight: 22 }} />
                  {resources.map((resource) => {
                    const path = sameServerPath(resource.previewUrl ?? resource.downloadUrl);
                    const size = formatFileSize(resource.size);
                    return (
                      <ListItem
                        titleNumberOfLines={0}
                        key={resource.id ?? resource.name}
                        title={resource.name}
                        subtitle={size}
                        leading={<Icon.File filename={resource.name} mimeType={resource.mimeType} />}
                        trailing={path ? <Icon name="chevron-right" color="muted" size={18} /> : undefined}
                        disabled={!path}
                        onPress={() => path && void openPath(path)}
                      />
                    );
                  })}
                </UIStack>
              </UIStack>
            );
          }

          const description = cleanCourseText(module.description);
          return (
            <ListItem
              titleNumberOfLines={0}
              title={module.name || moduleTypeLabel(module.type)}
              subtitle={description || moduleTypeLabel(module.type)}
              leading={<Icon name={moduleIcon(module.type)} color="muted" size={26} />}
              trailing={canOpenModule ? <Icon name="chevron-right" color="muted" size={18} /> : undefined}
              disabled={!canOpenModule}
              onPress={() => void openModule(module)}

            />
          );
        }}
      />
    </>
  );
}
