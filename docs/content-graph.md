# Course content graph (#63)

The course's **Graph** tab is a read-only view over the prepared material snapshot and the active learning version. It uses React Flow (`@xyflow/react`) loaded only when the tab opens, existing DotNaos controls, and the shared light/dark design tokens. It does not regenerate or edit course content.

## What a connection means

Every edge comes from an existing `SourceRef` and points from an exact material revision to a chapter or exercise. Multiple blocks are retained on the edge; the inspector groups reader links by source revision and page. Chapter/exercise relations are not inferred from shared sources. A citation is provenance, not a claim of semantic completeness.

All inventoried materials remain searchable, including pending, unsupported, failed and unreferenced ones. Historical revisions that are still referenced remain distinct from a newer source revision. An absent inventory entry is not reported as a confirmed Moodle deletion. Unreferenced sources and manually authored content without citations are not automatically treated as errors; an undocumented omission reason is explicitly unknown.

## Interaction

The initial view focuses a referenced PDF where available. Search can select any material, chapter or exercise; the separate notice filter includes open/unreferenced/changed relationships. The canvas shows that node's actual immediate neighbours, six at a time on desktop, with explicit pagination. Mobile portrait shows one legible source-to-content path at a time. No minimap, decorative grid, statistical tiles, force simulation or coverage percentage is used.

Click or press Enter on a node for its details. Open the exact source revision/page, a chapter, or an exercise from there. Graph focus is encoded in `#graph/<encoded-node-id>` and survives reload. Invalid or no-longer-present links show a notice rather than silently claiming that content was deleted. Opening a learning target does not save answers or reading progress.

## Limits of this first slice

This is not the MDX authoring or incremental generation pipeline. Materials are the last prepared snapshot, not a guarantee that every current Moodle upload has already been imported. There is no stored expected-chapter plan or omission decision log in the existing learning schema. Consequently the graph cannot detect a chapter that was never represented, or invent a reason why it was omitted. The UI explicitly states this limitation. Source revisions and identifiers are preserved; no data migration is performed.

## Verification

`cd web && bun run build && bun test` validates the frontend and the pure graph model. Tests cover duplicate references, unknown/failed sources, unreferenced and manually authored content, source-revision updates, historical sources, rewrite-stable identities, complete neighbourhood paging, source-page grouping and deep links.

Browser acceptance: desktop and mobile; light and dark mode including a live theme switch; focus/search/paging; opening/closing the inspector without clipping graph nodes; keyboard access; source/chapter/exercise navigation; an unsupported material; reload; and no API write requests. The preview proxy denies non-GET/HEAD requests so real course data cannot be changed by preview interactions.
