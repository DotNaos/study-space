# Script source comparison (#65)

The script reader has Lesen / Quellenvergleich modes. The comparison shows a pinned original page on the left and the existing rendered script on the right. It does not regenerate or migrate course content, answers, or reading positions.

## One mapping contract

An optional `provenance` field on each LearningSection stores a SHA-256 `markdownHash`, a `status`, and text `spans`. Each span carries UTF-16 `start` / `end` offsets, an exact `quote`, an `origin` (`source`, `user`, `agent`), and exact material/revision/block/page references. This metadata is independent of the display format and also usable with the planned MDX content model. This change does not introduce a full MDX editor or replace the Markdown renderer.

`script-provenance.ts` is the shared projection for the reader and course graph. The reader builds a reverse index from source blocks to all target ranges. Graph links use the same references and provide an action opening the selected chapter in the comparison. Multiple sources and target locations are retained, not collapsed into invented one-to-one relationships.

Future generated sections include mapping quotes using bounded citation labels. The server resolves the labels, rejects absent/non-unique or overlapping quotes, disallows generated human authorship, and saves exact offsets and the text hash. Generated mappings are always unreviewed. The generation cache profile is changed so old cached chunks are not mistaken for newly mapped output. Legacy chunks/versions without mappings remain readable.

The read projection marks a map stale after its script text changes. Frontend quote/range checks conservatively reject broken or ambiguous ranges. An attribution link is not proof of semantic correctness, complete coverage, or successful extraction. No percentages or automatic claims of verified equivalence are introduced.

## Legacy content and gaps

A whole-section SourceRef is not evidence that every sentence is supported. Legacy sections therefore retain their broad source context but display precise text attribution as unknown. Unmapped clauses remain visible. Known user/agent additions have separate labels only when authorship was explicitly stored; lack of provenance never implies an AI addition. A source block without target mappings is labelled unresolved, not automatically discarded or intentionally omitted. No omission reason is invented.

## Original viewing and interaction

PDF page images preserve the actual saved layout, figures, tables and formulas. Normalized source coordinates provide selectable overlays. A source with no region coordinates shows the original page and the selected extracted block with an explicit no-position-data notice. Formats without a rendered original provide a clearly labelled extract plus original download; they do not masquerade as an original preview. Extraction warnings remain visible.

Clicking script text highlights all relevant source blocks and offers every source document/page. Clicking a source block shows all exact target text ranges, or explicitly coarse section references. Unreviewed, unknown, authored-addition and stale statuses are distinct. Open-only mode highlights unresolved mappings and provides next-open navigation without mutating or hiding stored data.

The annotated renderer preserves complete Markdown structure, tables, lists, code and KaTeX, rather than rendering string slices. It keeps the existing HTML, URL and media restrictions. Source requests use the pinned app-owned asset endpoints, validate identity, cancel on changes and unmount, and revoke image object URLs. Cached document data is bounded to five revisions per reader instance.

On narrow screens the same comparison uses Quelle / Skript tabs with preserved selection, rather than unreadable half-width columns. `#compare/<sectionId>/<start>` links restore reader mode and selection on reload. Source failures leave the script readable; retry never silently substitutes another source revision.

## Verification

Frontend tests cover legacy attribution, partial paragraphs, additions, overlap/offset failures, stale mappings, reverse lookup, immutable reference identities, native coordinate validation, and safe annotated Markdown including math and tables. Backend tests cover citation validation, UTF-16 offsets, legacy deserialization, immutable text hashes and stale projection.

Browser acceptance includes actual Bio course original pages and legacy warnings, synthetic precise mappings against real saved source pages, both selection directions, multiple destinations, keyboard navigation, open-only mode, missing-revision retry, stale maps, deep links, graph-to-comparison entry and mobile. Synthetic learning data is injected in the test browser only; it is never written to Study Space. Browser interactions are checked for accidental write requests.
