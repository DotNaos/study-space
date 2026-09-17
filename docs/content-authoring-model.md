# Content authoring model

Status: **accepted target design, 2026-09-16**. Tracking issue: [#111](https://github.com/DotNaos/study-space/issues/111).

## Implementation status

PR [#112](https://github.com/DotNaos/study-space/pull/112) implements the first migration through the generic placement projection:

- primary course navigation is **Inhalt** + **Quellen**; legacy Lernen/Graph remain internal/advanced routes rather than primary tabs;
- `Inhalt` has read/edit states, with a rendered heading TOC in read mode and the authored structure in edit mode;
- the edit structure keeps files separate from structure nodes, but shows assigned files as compact selectable rows so block editing, diff, and the composer stay directly reachable; it also shows contextual source counts and staged visibility editing;
- mobile read mode opens the TOC from a compact control instead of rendering a second column;
- `Quellen` exposes one source inventory with current/default placement, move, hide, reset, refresh, and secondary graph access;
- pipeline projection exposes provider-agnostic `defaultPlacementId`, `currentPlacementId`, and `hidden`; old stored source decisions remain readable and no duplicate placement store is introduced;
- legacy plans without explicit source decisions materialize/generate from the imported default placement, while explicit move/hide decisions continue to override it.

User-uploaded source creation and the future source-segment layer remain follow-ups.

Study Space should expose one primary course-content experience instead of separate `Lernen`, `Aufbereitung`, and `Graph` destinations that represent overlapping projections of the same course.

## Course navigation

The target primary course navigation is:

- **Übersicht**
- **Inhalt**
- **Quellen**

`Inhalt` owns both reading and authoring. `Quellen` replaces the course-local `Materialien` wording and owns the source inventory and placement controls. The existing graph remains available as an advanced provenance/diagnostic capability, but it is not a primary course tab.

## Four separate layers

Do not collapse source inventory, authored structure, editable content, and rendered navigation into one tree.

```text
Source
  -> one current placement in Structure, or hidden
Structure
  -> owns the high-level authored course hierarchy
Content
  -> raw/materialized -> edited revisions -> rendered output
Rendered output
  -> derives the Table of Contents from actual headings
```

### Source

A source is a provider-agnostic input: imported PDF, user-uploaded PDF, image, page, text resource, or another supported input type. Provider identity is metadata, not authoring terminology.

Conceptual shape:

```text
Source
- id
- name
- kind
- defaultPlacementId
- currentPlacementId
- hidden
```

Every visible source has exactly one current structure placement. Otherwise it is explicitly hidden. A temporary unassigned state may exist while resolving a new or changed import, but it is not a finished state.

Imported sources start with the placement supplied by their observed/imported hierarchy. A manually added source gets the location where it is initially attached as its default placement. Moving a source changes only the current placement. Reset restores:

```text
currentPlacementId = defaultPlacementId
hidden = false
```

The UI must not call this a Moodle placement. Moodle is one possible source provider.

A later source-segment layer may sit between Source and Structure so independent ranges from one document can map separately. The initial implementation deliberately keeps source placement one-to-one and boring.

### Structure

Structure is the user-owned high-level authoring hierarchy. It does not contain PDFs or other source files as tree nodes.

Conceptual shape:

```text
StructureNode
- id
- parentId
- order
- title
- role: content | task
- hidden
```

Tasks are highlighted/classified nodes in the same hierarchy rather than a mandatory separate tree. Existing task-specific storage may remain internally while the model is migrated, but the authoring projection should present one hierarchy.

A structure node may show a source count or open contextual source controls, but sources remain separate objects.

### Content

Content is the materialized and edited learning text associated with the authored structure. Raw extraction and preserved originals remain immutable evidence. Edited revisions and provenance remain inspectable.

The content inspector uses compact editor-style tabs:

- `Inhalt`
- `PDF ↔ Jetzt`
- `Bearbeitet ↔ Raw`
- `Raw`

Assigned files may appear as compact selectable rows beneath their structure node in edit mode. They are content/source links, not structure nodes. Selecting one opens its `Inhalt`, `PDF ↔ Jetzt`, `Bearbeitet ↔ Raw`, `Raw`, and composer workspace.

### Table of Contents

The table of contents is a read-time projection from the rendered content, not the authoring structure itself. It may therefore be more detailed than Structure.

Example:

```text
Structure
Block 1
└ Grundlagen

Rendered TOC
Block 1
└ Grundlagen
   ├ DNA
   ├ RNA
   ├ Transkription
   └ Translation
```

Headings inside one authored document belong in the TOC without becoming structure nodes.

## Inhalt: view mode

View mode is the default course experience.

Desktop layout:

```text
+------------------------------------------+  +-------------------------+
| rendered course content                  |  | Inhaltsverzeichnis      |
|                                          |  |                         |
| Block 1                                  |  | Block 1                 |
| Grundlagen                               |  |   Grundlagen            |
|   DNA                                    |  |     DNA                 |
|   RNA                                    |  |     RNA                 |
| ...                                      |  |   Aufgabe 1            |
+------------------------------------------+  +-------------------------+
```

The main pane renders the finished script/tasks without authoring chrome. The right sidebar is a sticky TOC derived from rendered headings, follows the current scroll position, and navigates by click. On mobile the TOC becomes a compact drawer/sheet/menu rather than a squeezed second column.

Selection semantics remain simple:

- whole script -> render everything in order;
- root/block -> render that subtree;
- one structure node -> render only that unit;
- one task -> render only that task.

## Inhalt: edit mode

`Bearbeiten` changes the same page into the authoring perspective. The right-side TOC is replaced in the same sidebar position by **Struktur**.

```text
+------------------------------------------+  +-------------------------+
| current content/editor/review            |  | Struktur                |
|                                          |  |                         |
| Inhalt | PDF↔Jetzt | Bearb.↔Raw | Raw   |  | Block 1                |
|                                          |  |   Grundlagen            |
| editor / preview / diff                  |  |   ◆ Aufgabe 1           |
+------------------------------------------+  +-------------------------+
```

The structure sidebar owns:

- selection of the authored unit being edited;
- reorder;
- hierarchy/parent changes;
- rename;
- add/remove;
- content/task classification;
- visibility editing;
- deletion of user-created nodes once they have no child nodes or assigned sources. Provider-backed nodes remain recoverable through hide/reset semantics.

Assigned source/PDF files are shown beneath their structure node as compact selectable content rows. They do not participate in hierarchy/reorder operations as structure nodes.

## Visibility mode

Ordinary structure editing should not permanently show visibility checkboxes.

A small **Sichtbarkeit** action switches the structure sidebar into a staged visibility mode:

- each row becomes clickable to toggle inclusion;
- checkboxes occupy one fixed right-aligned column, independent of hierarchy indentation;
- changes remain local until submitted;
- a sticky footer shows `Abbrechen` and `N Änderungen übernehmen`;
- parent-hidden effectively hides the subtree but does not overwrite each child's own visibility value, so restoring the parent restores prior child state.

Outside this mode, visibility checkboxes disappear.

## Quellen

The course-local source inventory is called **Quellen**.

Example:

```text
Datei                     Zuordnung                         Status
DPP4_Block1_1.pdf         Block 1 / Grundlagen
Aufgabe_1.pdf             Block 1 / Aufgabe 1
Eigene_Notizen.pdf        Block 2 / Evolution
Alt.pdf                   Ausgeblendet
```

A moved source may show its default placement subtly and offer a reset action:

```text
Aktuell:   Block 1 / Sequenzanalyse
Standard:  Block 1 / Grundlagen               ↶
```

Provider-imported files and user-uploaded files use the same source model and placement UI.

## Migration constraints

The current implementation already has reviewed structure, source decisions, immutable extraction, authored revisions, provenance, PDF review and diff views. Reuse these capabilities while changing the projections and terminology.

- Existing stable data and provenance must remain readable.
- Prefer adapters/projections over duplicate structure/source state.
- Provider-specific fields may remain internal while migrations are in progress, but new domain/UI terminology is provider-agnostic.
- Keep graph internals until an advanced/provenance entry point replaces the top-level tab.
- Do not silently infer semantic coverage from source placement.

## Implementation sequence

1. **Shell and navigation**: one `Inhalt` destination with view/edit state; rename course-local `Materialien` to `Quellen`; remove Graph from primary tabs while preserving the tool.
2. **Sidebar responsibilities**: view-mode TOC, edit-mode structure-only sidebar, source counts/context actions, staged visibility mode.
3. **Source placement**: generic default/current placement plus hidden state; move/reset UI; user-uploaded sources through the same path.
4. **Clean-up**: retire duplicate learning/preparation navigation and obsolete mapping surfaces after parity; move Graph behind advanced/provenance actions; leave room for a future Source Segment layer.
