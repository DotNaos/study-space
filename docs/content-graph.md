# Course-wide provenance graph (#63)

The Graph tab shows the **entire course**, not a selected source's neighbourhood. All nodes and edges remain on the React Flow canvas on desktop and mobile. Search, clicking and deep links move the viewport or open details; they never prune the graph. There is no neighbour pagination or automatic first-PDF selection.

## Data and meaning

The graph combines independent read-only inputs:

- Moodle's course-contents response: every returned section (including empty sections), activity (including labels, forums and unknown types), and resource. These nodes exist before import or generation, so newly returned uploads are not hidden by an older material snapshot.
- The last prepared material snapshot: every recorded material outcome and its exact revision, including unsupported, pending and failed sources.
- The active learning version: every saved chapter/exercise and its pinned source references, including historical sources and content without provenance.

Moodle hierarchy and activity-to-prepared-material edges are **containment**, drawn dashed. They do not assert that a live file has the same revision as a prepared source. Provider resource IDs and prepared material IDs are distinct identities; matching names are not evidence of identical content. Saved **provenance** edges are solid and retain exact material/revision/block/page references. No chapter-exercise relation or semantic completeness score is inferred.

A deterministic layout gives every node a position. The initial camera fits the complete graph; zoom/pan and search make individual nodes readable in larger courses. Selection highlights its edges, retaining all other nodes. The fit control returns to the whole-course view. Controls use DotNaos UI and existing theme tokens; the graph is lazily loaded, with no minimap or dashboard tiles.

## Failures and limits

Moodle loading/error/disconnected state is explicit. Available saved nodes remain usable when the live inventory cannot be read, but the UI does not label that fallback a complete current course. Conversely, Moodle nodes remain visible when learning/preparation requests fail. Refresh fetches read endpoints only; it does not import, generate, modify Moodle or change saved learning content.

"Entire course" means the sections/activities/resources returned to the connected account. The course-contents API is not a guarantee that posts, protected interactive content or every embedded asset inside an activity are readable. Such activities remain visible as nodes. This first slice still has no MDX editor, expected-chapter plan or omission-decision log; it cannot invent the reason for a never-created chapter.

## Verification

`cd web && bun run build && bun test` checks the frontend and pure graph model. Cases include all live sections/resources before preparation, empty sections, unknown activities, new uploads with an old snapshot, duplicate filenames/resource occurrences, exact provenance revisions, unlinked/failed sources, complete positioning, search without graph mutation, and stable deep links.

Browser acceptance: count every course section/activity/resource against the actual API and every rendered node against the full model, ensure all nodes fit the initial overview, keep the node count unchanged on selection/search/mobile, exercise sources and learning navigation, refresh with a simulated new upload without an import, and surface incomplete API responses honestly. The isolated preview proxy rejects non-GET/HEAD requests.
