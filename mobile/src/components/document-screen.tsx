import { Icon, Screen, Stack as UIStack, Text, useNativeTheme } from "@dotnaos/ui/native";
import { Viewer } from "@dotnaos/ui/native/document";
import { Stack, useLocalSearchParams } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ContentState } from "./content-state";
import { positiveId, readerPath } from "@/lib/activity";
import { studyUrl } from "@/lib/api";
import { useActivity } from "@/lib/use-activity";

export default function DocumentScreen() {
  const params = useLocalSearchParams<{ courseId: string; moduleId: string; resourceId: string }>();
  const courseId = positiveId(params.courseId);
  const moduleId = positiveId(params.moduleId);
  const validResource = /^[a-f0-9]{64}$/.test(params.resourceId ?? "");
  const state = useActivity(validResource ? courseId : undefined, moduleId);
  const { mode } = useNativeTheme();
  const insets = useSafeAreaInsets();
  const resource = state.activity?.resources.find(item => item.id === params.resourceId);
  const path = resource && courseId && moduleId ? readerPath(courseId, moduleId, resource, mode) : undefined;
  return <Screen>
    <Stack.Screen options={{ title: resource?.name ?? "Dokument", headerBackButtonDisplayMode: "minimal" }} />
    {!resource ? <ContentState loading={state.loading} error={state.error || (!state.loading ? "Diese Datei ist nicht mehr verfügbar." : undefined)} retry={state.reload} /> :
      path ? <View style={{ flex: 1, paddingBottom: insets.bottom }}><Viewer uri={studyUrl(path)} title={resource.name} /></View> :
        <UIStack gap={3} style={{ padding: 20 }}>
          <Icon.File filename={resource.name} mimeType={resource.mimeType} size={32} />
          <Text selectable size="l" text={resource.name} />
          <Text selectable color="muted" text="Für dieses Dateiformat gibt es noch keine integrierte Vorschau. Es wird keine externe Anwendung geöffnet." />
        </UIStack>}
  </Screen>;
}
