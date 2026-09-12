import { Container, Icon, Spinner, Text } from "@dotnaos/ui-base";

export function Notice({
  children,
  success = false,
}: {
  children: React.ReactNode;
  success?: boolean;
}) {
  return (
    <Container
      role={success ? "status" : "alert"}
      surface="panel"
      tone={success ? "success" : "danger"}
      padding={3}
      className="flex items-start gap-3 text-sm leading-6"
    >
      <Icon
        name={success ? "check-circle" : "alert-circle"}
        size="m"
        color={success ? "success" : "danger"}
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">{children}</div>
    </Container>
  );
}

export function Loading({ label = "Wird geladen …" }: { label?: string }) {
  return (
    <Container.Stack
      role="status"
      direction="horizontal"
      align="center"
      gap={2}
      part="unstyled"
    >
      <Spinner size="s" />
      <Text text={label} size="m" color="muted" />
    </Container.Stack>
  );
}

export const linkClass =
  "inline-flex items-center gap-2 rounded-md text-sm font-medium text-accent underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus-ring";
