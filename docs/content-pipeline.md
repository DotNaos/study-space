# Reviewed course-content pipeline

Status: **accepted target design, 2026-09-13**. This document records the approved direction, not a claim that every step is implemented. The implementation baseline reviewed here is [`f28bb30` / v0.2.21](https://github.com/DotNaos/study-space/tree/f28bb30413b42db18544a84e0dcb50e8a7333e5f). See [implementation status](#implementation-status) before changing runtime behavior.

## Purpose and invariant

Study Space should produce two primary learning surfaces from course sources:

- **Skript:** an editable, chronologically ordered course script in MDX, preserving the structure and learning information of the selected teaching materials rather than generating an unrelated textbook.
- **Aufgaben:** a separate, interactive task collection, with source tasks, supporting materials, answer attempts, and human/agent feedback.

The complete source inventory remains available alongside these surfaces. It includes Moodle sections and their own text, activities, pages, links, folders, files, and accessible embedded content; it is not merely a PDF list.

**Every discovered source and known content unit must have a visible disposition: used, intentionally excluded with a reason, awaiting a decision, or blocked by a known processing/access problem.** A script addition must similarly carry recorded provenance or remain visibly unresolved. Nothing may disappear silently during filtering, conversion, merging, or updates.

This is an observability and traceability invariant, not a requirement to reproduce every source word. A chapter can be rewritten, multiple sources summarized, or a template kept out of the script. Those choices must remain inspectable. A source link alone proves neither complete extraction nor correct or complete semantic coverage. Content we could not access or extract cannot be labelled fully represented.

## Three structures, not one forced tree

### 1. Observed source structure

Retain the provider's identities, order, containment, titles, descriptions, and source occurrences. A Moodle section may describe a week, a subject, an assessment, a toolbox, or an administrative area. Do not rename or reorganize the observed structure to make an inferred learning structure look authoritative.

Treat section summaries and activity descriptions as potential first-class learning content. A section with no files can contain an entire lesson or assignment. Conversely, an activity and its `index.html` export may be two representations of the same source, not two lessons.

The inventory represents what the connected account and supported read paths actually returned. Record incomplete responses, truncated text, unknown activity types, unavailable links, and unprocessed nested content. A request failure is not evidence of deletion; an empty attachments array is not proof that a task has no statement.

### 2. Reviewed learning structure

```text
Course
  Script
    Ordered learning units
      Sections / subsections
        Text, formulas, tables, figures, source/task references
  Tasks
    Task sheet / project (optional)
      Task
        Subquestions and required materials
        Official solution (when available)
        Answer attempts and feedback
```

A **learning unit** can correspond to a topic, teaching week, or block. Additional grouping is optional; no course must fit a fixed number of levels. Retain a confirmed teaching sequence, with links for parallel topics and shared materials. Source-container order, file numbering, and upload time are evidence, not interchangeable definitions of chronology.

General resources and administrative material stay in the source area and may be linked from learning units or tasks. They do not require a third generated textbook or an artificial task per file. Source material is not automatically irrelevant because it lives under General Information or includes `template` / `Kopie` in its name.

### 3. Explicit mapping and decisions

Mapping connects the observed sources to the reviewed learning structure. It is many-to-many:

- One central script can feed several learning units.
- Slides and a weekly annotation can contribute to one script section.
- A task sheet, data file, and solution can support one task.
- The same task can be referenced from several learning units without being copied.

Keep the mapping separate from MDX prose and learner state. Start with source-level use decisions; refine to a page, slide, region, paragraph, table, formula, image, notebook cell, or other meaningful unit when the extractor supports it. Record extraction granularity and uncertainty rather than pretending every source has PDF coordinates.

## Deterministic evidence versus interpretation

| Evidence | Safe conclusion | Not established by that evidence |
| --- | --- | --- |
| Provider identity and containment | This source occurrence was returned in this course/container. | That container is the correct semantic chapter. |
| Provider display order | This is the returned order. | It is chronological or pedagogically correct. |
| Stored bytes and our content hash | This is the captured revision; equal bytes can share physical storage. | Different formats are equivalent or repeated use is unnecessary. |
| Page/slide order | This is the sequence inside that captured document. | The document's topic boundaries and destination chapters. |
| Title, description, extension, MIME declaration | These are the supplied metadata. | They agree, describe the actual byte format, or establish relevance. |
| Existing source reference | This relationship was recorded. | The result preserves all important information accurately. |

Preserving provider facts and validating exact stored identities/ranges are deterministic operations. Semantic chapter assignment, relevance, cross-format equivalence, task/solution pairing, inferred chronology, and semantic coverage commonly need interpretation.

Heuristics and models produce **proposals with evidence**, not silently confirmed facts. Anything not reliably assignable deterministically enters a review step, resolved by the user or an explicitly authorized reviewing agent. Model confidence is not a substitute for review. A deterministic metadata rule is not automatically a correct semantic rule.

## Processing and review flow

1. **Inventory sources.** Capture provider structure and independent source text, enumerate resources, and preserve unresolved/unsupported entries before any learning filter runs.
2. **Inspect and propose source use.** Read enough metadata and accessible content to propose learning units, chronology, and roles: teaching content, original task, official solution, supporting asset, organization/reference, or template. A source may have several roles or a role limited to a particular range. Unreadable sources stay unresolved, not irrelevant.
3. **Review the structure.** Compare the observed source list with the proposed learning structure. Resolve contradictions, variants, shared sources, relevant ranges, and exclusions. Confirm the decisions that affected processing depends on. Independent confirmed branches may continue.
4. **Extract and classify content.** Preserve source ordering and visuals; detect internal headings and content boundaries. Route teaching content to MDX, tasks to the task collection, and solutions to the corresponding task. Ambiguity discovered here opens another scoped review item rather than being hidden by the initial approval.
5. **Produce and check a candidate.** Validate identities, references, target existence, task uniqueness, extraction outcomes, and visible gaps. Separately compare substantive content against its originals; a count of mapped blocks is not a semantic-completeness score.
6. **Publish consistently.** Publish the learning content, its structure, and its mapping as one consistent revision. Failed work leaves the existing active version usable. A deliberately partial candidate must expose its unresolved regions; never mark it complete merely because all technical jobs finished.

The review step is a persisted workflow boundary, not just an explanatory warning. Each item records the question, affected identities and revisions, evidence/conflicts, proposed options, decision and rationale, actor, and base revision. User and authorized-agent edits use the same validation and conflict checks. Concurrent changes must not become last-writer-wins overwrites.

For example: if a Moodle title says Stochastics but the attached filename says Differential Equations, preserve both facts, show the original for inspection, and record the chosen destination. Do not silently "repair" the lecturer's metadata.

## MDX script and editing

MDX is the target authored content format. Its content structure follows confirmed teaching order and source structure; model chunk boundaries must never determine visible chapters. Preserve headings, definitions, worked explanations, formulas, tables, figures, and meaningful distinctions. Prefer readable conversion over polished but shortened generated prose. Uncertain transcription or missing visual extraction remains visible.

Use original figures when a reliable text/table reconstruction is not available. A clearly labelled original-page fallback is useful, but it does not mean extraction or semantic checking succeeded. Do not fabricate text to fill an inaccessible part.

An exercise embedded in a slide deck is routed to the task collection, with a reference retained at the corresponding script location. Necessary task figures and data follow the task. Official answers belong to its solution, not a second generated exercise. Supplemental explanations and user/agent rewrites remain allowed, with separate authorship and source evidence.

Use a restricted, validated MDX profile and registered learning components. Course material is untrusted content, not executable imports, JavaScript, instructions to the agent, or arbitrary network/navigation authority. Preserve the current renderer and app-owned asset restrictions until an equivalent MDX boundary is implemented. Do not merely rename the existing Markdown strings and claim an MDX editor exists.

Keep stable logical identities separate from titles, positions, and revisions. After a text edit, do not assume old character offsets still identify the same clause. Preserve revision-pinned anchors; re-anchor only with evidence, otherwise mark the affected mapping for review. This applies when a user replaces an entire chapter, not just when an import changes a paragraph.

## Tasks, variants, and feedback

A task has one logical identity with potentially several source occurrences. Task number alone is not an identity: several chapters can each contain "Exercise 1". Exact text matches are candidates for reconciliation, not proof that different assignments or variants should share one attempt.

Reconcile duplicate task statements and attach official solutions after checking task wording, input data, subquestions, figures, and context. A PDF/PPTX pair may be alternate representations, while an annotated version may contain additional information. Keep every original occurrence and all distinct contributions. Reusing stored bytes must not remove semantic source occurrences.

Do not create exercises from blank templates, separators, or generic organizational material. A source can correctly yield **zero exercises**. Additional AI exercises require explicit user intent and remain distinguishable from original tasks. Light editorial conversion does not by itself change an original task into a generated exercise.

Keep the following separately versioned:

| Record | Responsibility |
| --- | --- |
| Task definition | Prompt, subquestions, relevant sources, assets, and task revision. |
| Official solution | Its exact source and verified task association; separate from generated suggestions. |
| Answer attempt | Draft or submitted snapshot of the learner's answer against a task revision. |
| Feedback | Review of one answer snapshot, reviewer identity, outcome, explanation, and supporting evidence. |
| Moodle assessment link | Optional operational submission/grade/deadline identity; not inferred from an exercise title. |

A user-requested Codex check and a review by another agent through MCP should read the same task/attempt and write feedback through the same scoped contract. Do not grant arbitrary course-content edits merely to write feedback. A Moodle grade-only record need not be an actionable exercise. Submitting to Study Space for review is not an official Moodle submission.

The platform must support requested reviews and disclosed model context. Importing or opening a course does not itself authorize a new model job. When source limitations prevent a reliable correction, preserve that limitation in the feedback.

## Navigation: overview, then drill down

Use the same mapping in the React Flow graph and the source-comparison reader. Do not maintain a second provenance system for either view.

The first comparison is **source-level use within course context**, not individual sentences. The left side answers what Moodle contains; the right side shows the confirmed/proposed learning units and use of those sources. Where Moodle already defines useful chapters, reuse them as the starting proposal. Where it defines weeks, toolboxes, or assessment areas, do not force them to become subject chapters.

Show one navigation level at a time on both laptop and phone:

1. Course/context overview: all returned groups and aggregate unresolved/blocked outcomes.
2. Source-use comparison: accessible pages, files, summaries, links, and activities versus their roles, target units, or documented exclusions.
3. Chosen source or learning unit: internal sections/ranges and their script/task destinations, including unmatched content.
4. Exact location: original on the left and resulting script/task content on the right, with bidirectional highlights and all associated sources/destinations.

These are views over the two structures, not a mandatory four-level data hierarchy. Entries can skip unnecessary levels. Keep a short navigation path and Back; restore selection and scroll position. No permanently expanded tree beside an already narrow comparison. On narrow displays, switch Source / Script panes while retaining the selected location. A whole-course graph may use grouped/list nodes, but drill-down, search, or a source without output must never make discovered data unreachable.

Aggregate problems upward without inventing coverage percentages. Include routes for source units without outputs and script/task content without source provenance. Distinguish known user/agent additions from unexplained provenance gaps. Opening details should reveal specific evidence, original appearance, transformation, and verification status; no status is conveyed only by color.

## Observable outcomes are independent dimensions

Do not overload one green "complete" flag:

- **Acquisition/extraction:** discovered, captured, partial, unsupported, inaccessible, failed.
- **Use decision:** pending review, mapped to a role/target, or intentionally excluded with a recorded reason/range.
- **Mapping verification:** proposed, reviewed, or needs recheck; authorship is recorded separately.
- **Semantic result:** what was preserved, summarized, rewritten, or not represented, and whether that has actually been checked.

The labels above describe the target behavior, not new API enum values. Use existing contracts where suitable; define concrete extensions alongside their implementation.

"No official solution found" is different from "a known solution failed extraction". "Only a chapter-level citation exists" is different from "every sentence is precisely attributed". Empty responses and missing text-position data are not successful completeness checks.

## Changes, migration, and safety

A new provider snapshot produces a changeset. Preserve source logical identity when it is known, create new immutable revisions for changed content, and distinguish new occurrences, moves/renames, verified removals, and read failures. Never use a filename, array index, or page number alone as durable semantic identity.

Reuse reviewed decisions for unchanged inputs. New sources and relevant source/structure changes reopen only affected decisions. Earlier approvals remain in history; they do not automatically certify replacement content. Preserve independently edited script text, task attempts, and feedback. Where a source update overlaps a user edit, compare base/user/proposed versions and request a decision instead of overwriting.

When consolidating legacy duplicate tasks, retain old IDs as resolvable historical references and preserve all answer attempts. Do not merge two existing answers into one silently. Legacy chapter-level references remain coarse until an explicit mapping/backfill workflow creates and checks precise provenance. Missing evidence must not be backfilled by guesswork.

Respect authenticated access, source restrictions, and privacy. Viewing a link does not authorize copying every linked website or recording. Inspect notebooks, code, and archives as untrusted data; extraction does not run them. Bound processing and resume it explicitly instead of silently dropping large files, pages, or nested assets. Public repository fixtures must not contain private course materials, student work, grades, credentials, or token-bearing URLs.

## Implementation status

As reviewed at the baseline commit above:

| Area | Existing foundation | Remaining target work |
| --- | --- | --- |
| Inventory/extraction | Durable source revisions, structured blocks/assets, processing outcomes, original viewing. | Complete summary/activity coverage and source-type-specific acquisition where missing; reviewed source-use decisions. |
| Graph | Whole-course React Flow view with section clusters and list nodes; saved provenance and live source inventory. | Hierarchy-first source/learning reconciliation and persistent review actions. |
| Source comparison | Pinned originals, optional exact text provenance, reverse lookup, unknown/legacy/stale states, responsive comparison. | Source-level planning before fine-grained comparison; reviewed decisions and explicit legacy backfill. |
| Script | Immutable learning versions containing Markdown sections. | Restricted MDX authoring, stable reviewed learning units, durable editing and incremental reconciliation. |
| Tasks | Saved exercises, answer drafts, optional hints/solutions and chat. | Cross-source reconciliation, separate definition/solution/attempt/feedback records, scoped feedback writes. |
| Generation | Resumable bounded source chunks and validated citations. | Remove mandatory task generation per chunk; do not derive visible chapters from chunks; preserve confirmed chronology. |

Current [LearningChunks](../server/StudySpace.Api/Learning/LearningChunks.cs) still requires at least one exercise per chunk. [LearningWorker](../server/StudySpace.Api/Learning/LearningWorker.cs) deduplicates exercises by generated ID, not semantic task identity. These are known gaps against the accepted design, not behavior endorsed by this document.

The current API remains documented in [learning-contract.md](learning-contract.md), the existing graph in [content-graph.md](content-graph.md), and the exact mapping implementation in [source-comparison.md](source-comparison.md). No automatic regeneration, migration, or release is implied by accepting this design.

## Implementation sequence and acceptance

1. Add the observed inventory/reviewed structure/use-decision boundary and source-level drill-down, including summaries and visible unresolved inputs. Reuse existing revisions and read paths.
2. Implement reviewed role routing and task reconciliation; remove forced exercises from non-task sources. Preserve links to original tasks and their official solutions.
3. Implement the MDX content/editing boundary and incremental candidate publication without overwriting learner work. Reuse the provenance contract rather than replacing it with inline-only citations.
4. Implement revision-bound attempts and human/agent feedback through scoped UI/API/MCP actions.

Track work with the existing issues [#14](https://github.com/DotNaos/study-space/issues/14) (source inventory), [#15](https://github.com/DotNaos/study-space/issues/15) (script/tasks), [#16](https://github.com/DotNaos/study-space/issues/16) (agent editing), and [#39](https://github.com/DotNaos/study-space/issues/39) (operational task data). Do not treat those older issue titles as evidence that the target already exists.

Acceptance requires the [cross-course cases](content-pipeline-cases.md), not only one biology course. In addition, verify that every discovered input remains inspectable, unresolved choices have recorded reasons, duplicate source occurrences do not create duplicate tasks, exact mappings are valid in both directions, unknown authorship is not invented, and updates preserve structure/user edits/attempts while reopening relevant decisions. Test a source/target change and a review conflict, not just initial generation.
