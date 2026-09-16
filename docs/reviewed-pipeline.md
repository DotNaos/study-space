# Reviewed source preparation and learning workflow

This contract describes the implemented workflow that follows the [accepted target](content-pipeline.md). It extends, rather than replaces, the existing [learning API](learning-contract.md), [source comparison](source-comparison.md) and [course graph](content-graph.md). Remaining limitations are listed below; this is not a claim of automatic, lossless course conversion.

## User flow

Open a course and choose **Aufbereitung**. The first screen compares observed Moodle groups with the reviewed learning structure. Select a group, nested group, source, or learning unit to replace the current level; empty groups and inline lessons remain reachable. The back action restores the preceding level and its scroll position. On narrow screens, **Quelle / Lernstruktur** switches the visible pane instead of squeezing two columns together.

**Struktur bearbeiten** starts with suggestions derived from provider groups. Titles, hierarchy and order are editable before confirmation. No suggestion becomes an accepted semantic chapter on a read. A source can have several uses and learning units, bounded page/slide ranges, or an explicit exclusion. A reason is required. Solutions require a related task source. Original viewing and links to existing script/task results remain available while making the decision. Existing results are labelled as the active version's references, not as products of the newly reviewed plan.

**Nur offene Einordnungen** filters the current level; parent counts include descendant issues. The full inventory is retained. The decision history records actors, reasons, revisions and preceding decisions. CAS conflicts preserve the unsaved form for inspection rather than silently applying an outdated choice.

## Observed evidence and freshness

The pipeline uses the live `IMaterialSourceProvider.Inventory`, not only the prepared-material snapshot. Source identities, provider grouping, descriptions, section summaries, file children and unretrieved references remain separate from learning units. Unsupported iframe/object/embed content is recorded before sanitizing inline markup; it is never executed or fetched automatically.

Source use is pinned to an observation fingerprint. A ready imported item additionally carries `capturedSourceHash` computed from the source metadata actually captured for that item. If the live metadata no longer matches, acquisition becomes `needs-reimport`: the older original remains readable but cannot be silently passed to a new job as the current source. Legacy captures without comparable evidence are conservative. This hash proves a captured observation, not remote byte equality when the provider supplies no change signal.

A solution decision records the versions of its related task sources. A changed or no-longer-returned task source reopens that decision as well. Relevant source changes do not reset unrelated units or decisions. Sources absent from a successful observation are retained as `not-returned`; failed reads retain the last captured inventory and an explicit problem. Neither case deletes old sources or learning content.

## Pipeline API

All paths are under `/api/pipeline/courses/{courseId}` and share the application's existing origin/write protection.

| Method and path | Purpose |
| --- | --- |
| `GET /` | Read live observed groups/sources, saved units, suggestions, decisions, history and unresolved outcomes. Does not save, import or generate. |
| `POST /sync` | Capture the current observation, requiring `expectedRevision`. No file import or model call. |
| `PUT /structure` | Save `units: [{id,title,parentId,order}]`, `reason`, `actor` and `expectedRevision`. Reject cycles, ambiguous ordering and removal of referenced units. |
| `POST /decisions` | Save `sourceId`, `sourceVersion`, `disposition`, `uses`, `reason`, `actor` and `expectedRevision`. Changed source/plan returns 409. |

A use is `{unitId,role,firstPage?,lastPage?,relatedSourceId?}`. Roles are `teaching`, `task`, `solution`, `support`, `reference`. Teaching/task/solution uses require a reviewed unit. A solution requires a valid related source. Page ranges require the current prepared source and actual page boundaries. `use` requires at least one use; `exclude` requires no uses and a reason. Unknown roles, duplicate uses and invalid references are rejected.

Use status (`pending`, `reviewed`, `partial`, `stale`, `excluded`, `not-returned`) is independent of acquisition status. Selecting only ranges conservatively leaves the rest of the source unresolved. A confirmed use is not a semantic-completeness certificate. The current actor field is recorded attribution in the existing single-user installation, not a new multi-user identity/authentication system.

## Reviewed generation

`POST /api/learning/courses/{courseId}/generate` additionally accepts `planRevision` and `extraExercises` (default false). The application requires a reviewed plan and captures its exact unit order, use decisions and source revisions. Pending/stale/unreadable inputs require an explicitly partial run; only current confirmed readable inputs are processed. Independent approved sources may therefore proceed without pretending the course is complete.

The existing resumable chunk worker is reused. Reviewed unit order determines the script order, not an AI reorder of chunk titles. Zero sections or zero exercises are valid. Task-only sources cannot create duplicate teaching chapters, and solution sources cannot create new exercises; these constraints are checked on model output as well as stated in the prompt. Additional exercises require explicit selection.

Reviewed output is a candidate, even for a course with no previous active version. It includes `units`, `useDecisions`, `planRevision`, pending solutions and unreferenced source blocks. Publishing uses explicit activation with `expectedActiveVersionId` and `checkRevision: true`. Failed generation or concurrent activation leaves existing active content and drafts intact. Unreferenced blocks and unpaired solutions are visible review outcomes, not silently declared omissions or confirmed matches.

## Restricted learning MDX

Sections marked `format: "mdx"` accept ordinary Markdown/math and two registered, self-closing components on separate blank-line-delimited lines:

```mdx
<TaskRef id="VALID_TASK_ID" />

<Figure materialId="VALID_MATERIAL_ID" revision="VALID_SOURCE_REVISION" assetId="page-0001" alt="Source figure description" />
```

The values above are placeholders; real IDs must resolve within the selected learning version. Attributes are literal double-quoted strings. Arbitrary imports, exports, expressions, HTML, remote media and executable JSX are rejected. Code fences and math remain data. There is no general JavaScript/MDX evaluator. The renderer preserves the existing safe Markdown/KaTeX boundary and validates owned figure assets. Legacy Markdown never implicitly activates components.

The script's **Abschnitt bearbeiten** control provides source editing and preview. `PUT /api/learning/courses/{courseId}/sections/{id}` accepts `{baseVersionId,expectedActiveVersionId,title,content,reason,actor}` and returns an immutable candidate. Section identity remains stable, old text mappings become stale, and prior versions remain available. Competing edits of the same base section return 409. Export uses `GET /api/learning/courses/{courseId}/versions/{versionId}/sections/{id}/mdx`. Content and mapping are separate, so editing does not fabricate new attribution.

## Task reconciliation and attempts

**Aufgaben und Lösungen abgleichen** lets a reviewer inspect statements/originals and choose a canonical task, actual duplicate task IDs and reviewed solution entries. `POST /api/learning/courses/{courseId}/versions/{id}/tasks/reconcile` creates a candidate with `{expectedActiveVersionId,canonicalTaskId,mergeTaskIds,solutionIds,reason,actor}`. It retains aliases for merged IDs, older versions, original drafts and answer attempts. A similar title alone never merges tasks. A solution for a different reviewed task source is rejected. Official-source solutions and AI suggestions are labelled separately.

The independent learner-state API is under `/api/learning/courses/{courseId}`:

| Method and path | Purpose |
| --- | --- |
| `GET /attempts` | Read attempts and feedback in this course. |
| `POST /attempts` | Save `{versionId,exerciseId,attemptId?,expectedRevision,answer}`. A draft is CAS-protected; submitted attempts cannot be edited. |
| `POST /attempts/{id}/submit` | Freeze one nonempty draft at `expectedRevision`. This is a Study Space submission, not a Moodle submission. |
| `POST /attempts/{id}/feedback` | Append `{attemptRevision,answerHash,reviewer,outcome,comment,sources}` to the exact submitted answer. |
| `POST /attempts/{id}/review` | Explicit consented Codex review with `{attemptRevision,consentToCodex:true}`. |

Feedback outcomes are `correct`, `partly-correct`, `needs-work`, `uncertain`. Stored solutions are evidence, not automatically correct answers. Missing visual input, unavailable or shortened context is reported and forces an uncertain automated outcome. Existing legacy drafts can be explicitly copied into a new attempt; alias drafts and previous-version attempts stay accessible. A new source version never silently edits a submitted answer or applies old feedback to a new answer.

## Agent access

`study_pipeline` and `study_attempts` are read-only MCP tools. The latter defaults to submitted attempts and exposes the exact answer hash/revision when a specific attempt is requested. Structure and source review use the same API validations as the UI.

Write tools remain separately disabled by default:

- `STUDY_MCP_ALLOW_PIPELINE_WRITES=true` exposes `study_pipeline_structure` and `study_pipeline_decide`.
- `STUDY_MCP_ALLOW_FEEDBACK_WRITES=true` exposes `study_feedback` for appending feedback to an exact submitted attempt.
- `STUDY_MCP_ALLOW_CONTENT_WRITES=true` exposes `study_content_edit`; `study_content` remains read-only and is always available for loading the current source-bound MDX revision before an edit.

The MCP RPC transport accepts JSON requests from connector/agent backends and rejects requests carrying a browser Origin header. Browser interaction uses the protected application API, not direct MCP RPC. This prevents browser-origin requests from reaching an opt-in write tool; it does not replace deployment/network access control.

These variables belong to the MCP service's deployment environment. Enabling them does not grant arbitrary host, source, answer or Moodle writes. Disabled tools are absent from discovery and rejected on invocation. Tool clients must refresh discovery after an authorized capability change. Merely viewing a source or asking a question never confirms a mapping or submits an answer.

## Verification and remaining work

Synthetic service/API/UI tests cover nested and empty groups, inline-only lessons, a central script under General Information, many-to-many uses, review conflicts, stale source captures and dependent solution decisions, source failures, deliberate partial generation, zero-task results, MDX safety, candidate editing/export, task aliases, immutable attempts, feedback, and disabled MCP writes. Browser QA uses real application endpoints against isolated synthetic storage/model, never real learner submissions or a live model job. Real-course browsing is verified separately with read-only requests.

The broader target is not finished by this release. There is no unattended semantic chapter discovery, course-wide equivalence proof, general archive/remote-site crawling, automatic migration of historical text mappings, or automatic three-way merge of user edits into regenerated content. Generated Figure selection and exact task-reference placement within a generated subsection still need richer conversion support; the registered components can already be authored safely. Generic task-statement editing and richer task asset/range decisions remain follow-ups. The existing graph is retained; the new hierarchy/review surface is **Aufbereitung**. Native-app authoring is not claimed; the web workflow is responsive.

Existing courses are not automatically reimported, regenerated, approved, deduplicated or activated during upgrade. Their old scripts and answers remain usable. A reviewer first creates the plan and resolves source use, then explicitly prepares sources and creates a candidate when appropriate. Keep [#14](https://github.com/DotNaos/study-space/issues/14), [#15](https://github.com/DotNaos/study-space/issues/15), [#16](https://github.com/DotNaos/study-space/issues/16) and [#39](https://github.com/DotNaos/study-space/issues/39) open for the remaining accepted scope.
