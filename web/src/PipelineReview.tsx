import { useState } from "react";
import {
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  Textarea,
} from "@dotnaos/ui-base";
import type {
  PipelineSourceView,
  PipelineState,
  SourceUse,
} from "./pipeline-api";
import { roleLabels, statusLabels } from "./pipeline-api";

export function PipelineReview({
  state,
  item,
  busy,
  onSave,
}: {
  state: PipelineState;
  item: PipelineSourceView;
  busy: boolean;
  onSave: (body: {
    disposition: string;
    uses: SourceUse[];
    reason: string;
  }) => Promise<void>;
}) {
  const [exclude, setExclude] = useState(
    item.decision?.disposition === "exclude",
  );
  const [uses, setUses] = useState<SourceUse[]>(
    item.decision?.uses.length
      ? item.decision.uses
      : [
          {
            unitId: state.units[0]?.id ?? "",
            role:
              item.source.suggestedRole === "unresolved"
                ? "reference"
                : item.source.suggestedRole,
          },
        ],
  );
  const [reason, setReason] = useState(item.decision?.reason ?? "");
  function update(index: number, patch: Partial<SourceUse>) {
    setUses(uses.map((use, i) => (i === index ? { ...use, ...patch } : use)));
  }
  return (
    <div className="pipeline-review">
      <h3>Verwendung</h3>
      <p className="pipeline-muted">
        {statusLabels[item.status]}
        {!item.decision ? " · Vorschlag, noch nicht freigegeben" : ""}
      </p>
      <Checkbox
        label="Nicht in Skript oder Aufgaben übernehmen"
        checked={exclude}
        onCheckedChange={setExclude}
      />
      {!exclude && (
        <>
          {uses.map((use, index) => (
            <div className="pipeline-use" key={index}>
              <Select
                accessibilityLabel={`Verwendung ${index + 1}`}
                size="sm"
                value={use.role}
                options={Object.entries(roleLabels)
                  .filter(([id]) => id !== "unresolved")
                  .map(([value, label]) => ({ value, label }))}
                onValueChange={(role) =>
                  update(index, {
                    role,
                    relatedSourceId:
                      role === "solution" ? use.relatedSourceId : null,
                  })
                }
              />
              <Select
                accessibilityLabel={`Lerneinheit ${index + 1}`}
                size="sm"
                value={use.unitId}
                options={[
                  {
                    value: "",
                    label: "Keine Lerneinheit / allgemeine Ressource",
                  },
                  ...state.units.map((unit) => ({
                    value: unit.id,
                    label: unit.title,
                  })),
                ]}
                onValueChange={(unitId) => update(index, { unitId })}
              />
              {use.role === "solution" && (
                <Select
                  accessibilityLabel="Zugehörige Aufgabenquelle"
                  size="sm"
                  value={use.relatedSourceId ?? ""}
                  options={[
                    { value: "", label: "Aufgabenquelle wählen" },
                    ...state.sources
                      .filter(
                        (candidate) =>
                          candidate.source.id !== item.source.id &&
                          candidate.source.present,
                      )
                      .map((candidate) => ({
                        value: candidate.source.id,
                        label: candidate.source.name,
                      })),
                  ]}
                  onValueChange={(relatedSourceId) =>
                    update(index, { relatedSourceId })
                  }
                />
              )}
              <details>
                <summary>Auf Seiten / Folien begrenzen</summary>
                <div className="pipeline-range-fields">
                  <Form.Field label="Von">
                    <Input
                      type="number"
                      value={String(use.firstPage ?? "")}
                      onValueChange={(value) =>
                        update(index, {
                          firstPage: value ? Number(value) : null,
                        })
                      }
                    />
                  </Form.Field>
                  <Form.Field label="Bis">
                    <Input
                      type="number"
                      value={String(use.lastPage ?? "")}
                      onValueChange={(value) =>
                        update(index, {
                          lastPage: value ? Number(value) : null,
                        })
                      }
                    />
                  </Form.Field>
                </div>
              </details>
              {uses.length > 1 && (
                <Button
                  size="sm"
                  variant="ghost"
                  label="Zuordnung entfernen"
                  onPress={() => setUses(uses.filter((_, i) => i !== index))}
                />
              )}
            </div>
          ))}
          <Button
            size="sm"
            variant="ghost"
            icon="plus"
            label="Weitere Verwendung"
            onPress={() =>
              setUses([...uses, { unitId: "", role: "reference" }])
            }
          />
          {!state.units.length && (
            <p className="pipeline-muted">
              Lege zuerst die Lerneinheiten fest. Referenzen und Ausschlüsse
              sind bereits möglich.
            </p>
          )}
        </>
      )}
      <Form.Field label="Begründung">
        <Textarea
          rows={3}
          fullWidth
          value={reason}
          onValueChange={setReason}
          placeholder="Warum gehört diese Quelle hierher?"
        />
      </Form.Field>
      <Button
        label={busy ? "Wird gespeichert …" : "Einordnung bestätigen"}
        disabled={
          busy || !reason.trim() || !item.source.present || !!state.problem
        }
        onPress={() =>
          void onSave({
            disposition: exclude ? "exclude" : "use",
            uses: exclude ? [] : uses,
            reason,
          })
        }
      />
      {item.decision && (
        <p className="pipeline-muted">
          Letzte Entscheidung: {item.decision.actor} ·{" "}
          {new Date(item.decision.decidedAt).toLocaleString("de-CH")}.
          Bestätigte Verwendung ist keine Prüfung der inhaltlichen
          Vollständigkeit.
        </p>
      )}
    </div>
  );
}

export function PipelineStructure({
  state,
  busy,
  onSave,
}: {
  state: PipelineState;
  busy: boolean;
  onSave: (units: PipelineState["units"], reason: string) => Promise<void>;
}) {
  const [units, setUnits] = useState(
    state.units.length ? state.units : state.suggestedUnits,
  );
  const [reason, setReason] = useState("");
  function move(index: number, direction: number) {
    const target = index + direction;
    if (target < 0 || target >= units.length) return;
    const next = [...units];
    [next[index], next[target]] = [next[target], next[index]];
    setUnits(next.map((unit, order) => ({ ...unit, order })));
  }
  return (
    <div className="pipeline-structure">
      <h2>Lernstruktur festlegen</h2>
      <p className="pipeline-muted">
        Moodle-Gruppen sind nur der Ausgangsvorschlag. Benenne, gruppiere und
        sortiere nach dem tatsächlichen Unterricht; die Quellenablage bleibt
        unverändert.
      </p>
      <ol className="pipeline-unit-editor">
        {units.map((unit, index) => (
          <li key={unit.id}>
            <Input
              accessibilityLabel={`Titel der Lerneinheit ${index + 1}`}
              value={unit.title}
              onValueChange={(title) =>
                setUnits(
                  units.map((item, i) =>
                    i === index ? { ...item, title } : item,
                  ),
                )
              }
            />
            <Select
              accessibilityLabel={`Übergeordnete Lerneinheit ${index + 1}`}
              size="sm"
              value={unit.parentId ?? ""}
              options={[
                { value: "", label: "Oberste Ebene" },
                ...units
                  .filter((item) => item.id !== unit.id)
                  .map((item) => ({ value: item.id, label: item.title })),
              ]}
              onValueChange={(value) =>
                setUnits(
                  units.map((item, i) =>
                    i === index ? { ...item, parentId: value || null } : item,
                  ),
                )
              }
            />
            <div className="pipeline-inline-actions">
              <Button
                size="sm"
                variant="icon"
                icon="arrow-up"
                accessibilityLabel={`${unit.title} nach oben`}
                disabled={index === 0}
                onPress={() => move(index, -1)}
              />
              <Button
                size="sm"
                variant="icon"
                icon="arrow-down"
                accessibilityLabel={`${unit.title} nach unten`}
                disabled={index === units.length - 1}
                onPress={() => move(index, 1)}
              />
              <Button
                size="sm"
                variant="icon"
                icon="trash"
                accessibilityLabel={`${unit.title} entfernen`}
                onPress={() => setUnits(units.filter((_, i) => i !== index))}
              />
            </div>
          </li>
        ))}
      </ol>
      <Button
        size="sm"
        variant="ghost"
        icon="plus"
        label="Lerneinheit hinzufügen"
        onPress={() =>
          setUnits([
            ...units,
            {
              id: crypto.randomUUID().replaceAll("-", ""),
              title: "Neue Lerneinheit",
              parentId: null,
              order: units.length,
            },
          ])
        }
      />
      <Form.Field label="Begründung der Gliederung">
        <Textarea rows={2} value={reason} fullWidth onValueChange={setReason} />
      </Form.Field>
      <Button
        label="Struktur bestätigen"
        disabled={busy || !reason.trim()}
        onPress={() =>
          void onSave(
            units.map((unit, order) => ({ ...unit, order })),
            reason,
          )
        }
      />
    </div>
  );
}
