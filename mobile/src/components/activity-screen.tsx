import { Icon, ListItem, Screen, SectionHeader, Stack as UIStack, Text, useNativeTheme } from "@dotnaos/ui/native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { api, type CourseSection, type CourseResource } from "@/lib/api";
import { deadline, gradingLabel, positiveId, resourceParams, submissionLabel } from "@/lib/activity";
import { formatFileSize, visibleResources } from "@/lib/course-library";
import { useActivity } from "@/lib/use-activity";
import { ContentState } from "./content-state";

function Detail({ label, value }: { label: string; value: string }) {
  return <UIStack gap={1} style={{ paddingVertical: 6 }}><Text text={label} color="muted" size="s" /><Text text={value} selectable /></UIStack>;
}

export default function ActivityScreen() {
  const params = useLocalSearchParams<{ courseId: string; moduleId: string }>();
  const courseId = positiveId(params.courseId);
  const moduleId = positiveId(params.moduleId);
  const state = useActivity(courseId, moduleId);
  const { colors } = useNativeTheme();
  const router = useRouter();
  const [sections, setSections] = useState<CourseSection[]>([]);
  const [relatedError, setRelatedError] = useState("");
  useEffect(() => {
    if (!courseId) return;
    const controller = new AbortController();
    setSections([]); setRelatedError("");
    void api<CourseSection[]>(`/api/providers/moodle/courses/${courseId}/contents`, controller.signal)
      .then(value => { if (!controller.signal.aborted) setSections(value); })
      .catch(() => { if (!controller.signal.aborted) setRelatedError("Die weiteren Materialien dieses Abschnitts konnten nicht geladen werden."); });
    return () => controller.abort();
  }, [courseId, state.revision]);
  const activity = state.activity;
  const assignment = activity?.assignment;
  const requirements = activity?.submissionRequirements;
  const related = sections.find(section => section.id === activity?.sectionId)?.modules
    .filter(module => module.id !== moduleId)
    .flatMap(module => visibleResources(module).map(resource => ({ moduleId: module.id, resource }))) ?? [];
  const resourceRow = (resource: CourseResource, owner: number) => {
    const target = courseId ? resourceParams(courseId, owner, resource) : undefined;
    return <ListItem key={`${owner}:${resource.id ?? resource.name}`} title={resource.name} titleNumberOfLines={0}
      subtitle={formatFileSize(resource.size)} leading={<Icon.File filename={resource.name} mimeType={resource.mimeType} size={24} />}
      trailing={target ? <Icon name="chevron-right" color="muted" size={18} /> : undefined}
      onPress={target ? () => router.push({ pathname: "/course/[courseId]/module/[moduleId]/resource/[resourceId]", params: target }) : undefined} />;
  };
  return <Screen>
    <Stack.Screen options={{ title: activity?.type === "assign" ? "Aufgabe" : "Inhalt", headerBackButtonDisplayMode: "minimal" }} />
    {!activity ? <ContentState loading={state.loading} error={state.error} retry={state.reload} /> :
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 36 }}
        refreshControl={<RefreshControl refreshing={state.loading} onRefresh={state.reload} tintColor={colors.textMuted} />}>
        <SectionHeader title={activity.title} />
        {activity.description ? <Text selectable text={activity.description} /> : activity.type === "assign" ?
          <Text selectable color="muted" text="Moodle liefert für diese Abgabe keinen Beschreibungstext. Materialien aus demselben Abschnitt stehen weiter unten." /> : null}
        {activity.instructions ? <><SectionHeader title="Aufgabenstellung" /><Text selectable text={activity.instructions} /></> : null}
        {activity.content ? <Text selectable text={activity.content} /> : null}
        {activity.type !== "assign" && !activity.description && !activity.content && !activity.instructions && !activity.resources.length && !activity.warnings.length
          ? <Text selectable color="muted" text="Moodle liefert für diese Aktivität derzeit keinen Inhalt." /> : null}
        {assignment ? <>
          <SectionHeader title="Abgabe" />
          <Detail label="Abgabefrist" value={deadline(assignment.dueAt)} />
          {assignment.opensAt ? <Detail label="Geöffnet ab" value={deadline(assignment.opensAt)} /> : null}
          {assignment.cutoffAt ? <Detail label="Letzte Abgabemöglichkeit" value={deadline(assignment.cutoffAt)} /> : null}
          <Detail label="Abgabestatus" value={submissionLabel(assignment.submissionStatus)} />
          <Detail label="Bewertung" value={gradingLabel(assignment.gradingStatus)} />
          {assignment.submittedAt ? <Detail label="Zuletzt geändert" value={deadline(assignment.submittedAt)} /> : null}
          {requirements?.filesEnabled ? <>
            <SectionHeader title="Dateivorgaben" />
            {requirements.maximumFiles !== null ? <Detail label="Dateianzahl" value={`Maximal ${requirements.maximumFiles}`} /> : null}
            {requirements.maximumFileBytes ? <Detail label="Größe pro Datei" value={formatFileSize(requirements.maximumFileBytes) ?? "Nicht angegeben"} /> : null}
            {requirements.acceptedFileTypes ? <Detail label="Zugelassene Dateitypen" value={requirements.acceptedFileTypes} /> : null}
          </> : null}
          <Text selectable color="muted" text="Nur Anzeige: Dateien hochladen und Abgaben bearbeiten ist hier noch nicht verfügbar." style={{ paddingTop: 12 }} />
        </> : null}
        {activity.resources.length ? <><SectionHeader title={activity.type === "assign" ? "Anhänge der Aufgabe" : "Dateien"} />
          {activity.resources.map(resource => resourceRow(resource, activity.moduleId))}</> : null}
        {activity.type === "assign" && related.length ? <><SectionHeader title="Materialien im selben Abschnitt" />
          {related.map(item => resourceRow(item.resource, item.moduleId))}</> : null}
        {activity.partial || activity.warnings.length ? <><SectionHeader title="Hinweise" />
          {activity.warnings.map(warning => <Text key={warning} selectable color="muted" text={warning} style={{ paddingBottom: 8 }} />)}</> : null}
        {relatedError && activity.type === "assign" ? <Text selectable color="muted" text={relatedError} /> : null}
      </ScrollView>}
  </Screen>;
}
