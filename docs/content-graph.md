# Course-wide provenance graph (#63)

The Graph tab shows the **entire course**, not a selected source's neighbourhood. The raw graph keeps every Moodle entry, saved source revision, chapter and exercise. Its presentation groups related entries into larger React Flow nodes with scrollable lists. Search and selection move the camera and reveal a row; they never remove other entries. There is no item pagination, automatic first-PDF selection, or coverage percentage.

## Data and meaning

The graph combines independent read-only inputs:

- Moodle course contents: every returned section (including empty sections), activity (including labels, forums and unknown types), and resource. New uploads are visible before import or generation.
- The last prepared material snapshot: every recorded material outcome and its exact revision, including unsupported, pending and failed sources.
- The active learning version: every saved chapter/exercise and its pinned source references, including historical sources and content without provenance.

Provider resource IDs and prepared material IDs remain distinct. A matching filename does not establish identical content or an up-to-date source revision. The raw **provenance** edges retain exact material/revision/block/page references. **Containment** edges describe only Moodle hierarchy or activity membership. No chapter-to-exercise relation or semantic completeness score is inferred.

## Grouped presentation

Each Moodle section gets a compound cluster. Its left section node is vertically centered on its descendants. Inside the cluster, fixed columns hold Moodle entries, saved sources, and stacked chapter/task lists. Resources are nested below their activity in the Moodle list. All list rows remain rendered and are scrollable; lists do not grow the canvas indefinitely. Every raw item occurs exactly once, including unlinked resources and empty sections.

Learning content is placed with its source section using distinct source-material identities, not a majority of repeated extracted-block citations. Ties appear under **Abschnittsübergreifend**. Unknown provenance remains under **Ohne Abschnitt**; saved-only sections remain identifiable when live inventory is unavailable. This placement is only a display decision and does not rewrite the curated learning structure or original references. Cross-section references remain intact.

Connections are bundled between the list nodes: dashed containment and solid provenance. Relations within a list are expressed by nesting and the inspector rather than self-loop edges. Clicking a row highlights its own exact related items and relevant bundles; the inspector provides the individual connections and source locations. A bundle does not assert that every item in one list derives from every item in the other.

The layout has a fixed maximum width per cluster and at most two cluster columns. New chapters/tasks add list rows, not more output columns. The initial camera fits the whole course. Search, pan and zoom make individual groups readable; selection scrolls its row into view without scrolling the document. Source/chapter/exercise actions and stable raw-item deep links are preserved. Native list scrolling, keyboard activation and mobile use the same complete graph.

Controls use DotNaos UI and existing theme tokens. The graph is lazily loaded; no layout dependency, minimap or dashboard tiles are added. Grouping is a pure frontend projection, not a data migration.

## Failures and limits

Moodle loading/error/disconnected state is explicit. Available saved entries remain usable when the live inventory cannot be read, but the UI does not label that fallback a complete current course. Conversely, Moodle entries remain visible when learning/preparation requests fail. Refresh fetches read endpoints only; it does not import, generate, modify Moodle or change saved learning content.

"Entire course" means the sections/activities/resources returned to the connected account. The course-contents API is not a guarantee that all forum posts, protected interactive content or embedded assets can be read. Such activities remain visible. This slice still has no MDX editor, expected-chapter plan or omission-decision log; it cannot invent the reason for a never-created chapter.

## Verification

`cd web && bun run build && bun test` checks the frontend, raw provenance model and grouped projection. Tests cover exact-once item retention, unknown/failed sources, shared-source placement, preserved original relations, centered roots, non-overlapping boxes, bounded geometry with 500 tasks, immutable inputs and stable identities after an update.

Browser acceptance compares every rendered item ID against the real model, verifies grouped nodes rather than per-task nodes, and checks full initial bounds, list-tail scrolling, keyboard access, source/chapter/exercise navigation, stable deep links and mobile without page overflow. A browser-only new-upload simulation must appear on refresh without an import. Partial API failures must preserve other inputs and identify incomplete state. The isolated preview proxy rejects non-GET/HEAD requests.
