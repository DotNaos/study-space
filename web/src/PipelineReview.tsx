import { StructurePicker } from "./StructurePicker";
import { unitHidden, unitKind } from "./learning-structure";
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
            unitId: "",
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
                    unitId: "",
                    relatedSourceId:
                      role === "solution" ? use.relatedSourceId : null,
                  })
                }
              />
              <StructurePicker label={`Lerneinheit ${index+1}`} emptyLabel="Keine Lerneinheit" selected={use.unitId ? [use.unitId] : []}
                units={state.units.filter(unit => unit.id === use.unitId || !unitHidden(unit,state.units) &&
                  (use.role === "teaching" ? unitKind(unit)==="script" : use.role === "task" || use.role === "solution" ? unitKind(unit)==="tasks" : true))}
                onChange={ids => update(index,{unitId:ids[0]??""})} />
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

export { PipelineStructure } from "./PipelineStructure";
