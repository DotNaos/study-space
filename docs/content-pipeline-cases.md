# Cross-course acceptance cases

Companion to the [accepted content-pipeline design](content-pipeline.md). These are **specifications for synthetic regression fixtures**, not already implemented tests and not copies of private course material.

The structural patterns below come from read-only Study Space inspection of eight courses on 2026-09-13 (biology and numerical methods, followed by six contrasting courses). That inspection covered returned provider hierarchies, section text, activity descriptions, and resource metadata, with earlier prepared-content inspection for biology. It did not establish byte/content equivalence for every attachment. Some long fields were truncated by the read surface. Names and content in future executable fixtures must be synthetic; no student answers, grades, credentials, or private originals belong in this repository.

## 1. Biology: tasks repeated in solution documents

**Observed pattern:** topic blocks contain several slide decks, original exercises, a solution document, and separate assessment descriptions. Empty week templates and labels coexist with real subject material. Prepared exercises included repeated task statements from a slide deck and its solution sheet. New assignment files in the live provider inventory were absent from an older preparation snapshot.

**Synthetic fixture:** slides contain Exercise A with two subquestions; a solution file repeats A and supplies answers. A later provider snapshot adds Assignment B without changing the saved material snapshot. Include a blank week and a separator label.

**Expected:** one task A with separate statement/solution provenance; no task generated from the blank template or separator. B appears immediately as discovered/not yet captured. Existing answers to duplicate legacy task IDs survive reconciliation. An old completed import is not labelled a complete current inventory.

## 2. Numerical methods: central script versus weekly delivery

**Observed pattern:** a central teaching script sits under General Information. Week groups mostly contain numbered task/solution sheets, occasional supplementary notes, and a task data file. Task numbering and displayed week order disagree.

**Synthetic fixture:** General Information contains a multi-chapter script; Week 4 contains supplementary notes for one of its chapters. A task sequence is displayed as 11, 10, 9. One task needs `data.txt`.

**Expected:** the central script is not excluded as administrative. Source containment, confirmed teaching sequence, and task numbering remain separate. Notes supplement a chapter only after the relationship is established. Preserve the data file as a task dependency, not an artificial lesson.

## 3. Machine learning: shared tasks, notebooks, and misleading metadata

**Observed pattern:** a sheet under one topic explicitly covers several topics. Another section directs learners to tasks elsewhere. Folders mix notebooks, datasets, and solutions. Meaningful labels still contain `Kopie` in their names. Notebook metadata advertises JSON, plain text, or HTML; similarly named notebooks can have very different sizes. One task label appears under a topic inconsistent with its wording.

**Synthetic fixture:** topics A/B/C share one worksheet stored under C; a label in A references C. Repeat a dataset occurrence and include similarly named notebook variants with different bytes. Include a populated copied label and a topic/task mismatch.

**Expected:** one task collection with links from all confirmed topics. Retain all source occurrences; do not merge by filename/size alone. Inspect actual format without executing notebooks. Do not discard populated copied labels. A mismatch becomes a review item, not a silent rewrite. Large outputs must be bounded explicitly without dropping notebook content unnoticed.

## 4. Programming: multiple representations and task definitions outside the listing

**Observed pattern:** a recursion activity exposes PDF and PPTX versions; another activity repeats the PPTX name and size. Solutions are HTML. Some Moodle assignments have only a short prompt and empty attachments in the available response. Chapter and exercise numbers differ. Project-code and presentation submissions coexist with exercises.

**Synthetic fixture:** a resource contains `recursion.pdf` and `recursion.pptx`; a second resource lists `recursion.pptx`. A task activity says "solve the worksheet" but supplies no statement in the listing. Supply an HTML solution, a Python starter file, and two different project submission activities.

**Expected:** equivalence is proposed and checked, never assumed. All representations and unique annotations remain addressable. Missing task content remains visibly unresolved. Importing a solution does not fabricate an unseen task definition. Distinct project deliverables are not conflated with each other or with textbook exercises.

## 5. Mathematics: parallel subjects and conflicting titles

**Observed pattern:** weekly sections mix differential equations, stochastics, slides, notes, and separate exercises. In one resource the activity title indicates stochastics while the filename indicates differential equations. Another code resource's sheet/task numbering differs between title and filename.

**Synthetic fixture:** one week contains both subjects. A resource title and filename disagree; a Python starter file has contradictory task numbers. Notes and slides share a date but have different content.

**Expected:** week membership is retained, not mistaken for one semantic topic. A human or authorized agent inspects the source and records the subject/task decision with evidence. Shared dates do not prove duplicates. Follow-up imports preserve the decision for unchanged content and reopen it for relevant changed revisions.

## 6. Applied English: source text without files, reverse order, and assessments

**Observed pattern:** toolboxes and assessment sections precede reverse-chronological teaching weeks. Some sections contain substantive lesson/task instructions in their summary with no activities. Worksheets occur as PDF/DOCX variants; a talk link and transcript are separate resources. An assignment-type activity may be a grade record. Source-use constraints and assessment requirements can exist in section text rather than attachments.

**Synthetic fixture:** return weeks newest-first; one section has a multi-step task and `modules: []`. Include a PDF/DOCX worksheet pair, a video link/transcript pair, source-use guidance in a summary, and a grade-only assignment record. Make one summary explicitly truncated.

**Expected:** section text is first-class input, not an empty placeholder. Chronology is confirmed separately from provider display order. Variant relations require inspection. Grade-only records are not automatically actionable exercises. Truncation/access limitations and source-use requirements remain visible; no unsupported claim that the whole section was processed. Source links are not automatically followed into unlimited crawling or media downloads.

## 7. NLP: range-level relevance and a project bundle

**Observed pattern:** a resource description limits exam relevance to part of a document. Other materials include notebooks, a solution ZIP, a separate PDF worksheet, optional reading links, and HTML follow-up pages. A hackathon bundle includes Markdown instructions, schemas, datasets, starter code, evaluation code, and a result-file submission. A file called `submission_template.py` is task support, not a generic empty template.

**Synthetic fixture:** a source description says a document is exam-relevant through page 19. Include the notebook/worksheet/solution alternatives and a project folder with README, dataset, schema, starter, evaluator, and submission.

**Expected:** preserve the lecturer's range restriction as evidence; do not equate exam relevance with all learning relevance or automatically delete later pages. Use explicit source-use decisions for optional material. Preserve project dependencies and individual source references. Do not execute code during ingestion or assume notebook and PDF tasks are duplicates.

## 8. HPC: solution absence versus failed conversion

**Observed pattern:** topic sections contain several exercise/solution pairs. One numbered exercise has no explicitly named matching solution in the returned inventory, while adjacent exercises do. A lecture resource is marked updated without changing its general filename. Cluster-access and recording links are also present.

**Synthetic fixture:** tasks 9 and 10 exist; only a solution explicitly labelled 10 is returned. Update a lecture resource under its existing activity. Include an operational access link and a recording description with usage restrictions.

**Expected:** report "no matching official solution identified", not "solution lost in extraction" or a guessed solution 9. A lecture update creates an inspectable revision and rechecks affected mappings without rebuilding unrelated structure. Supporting links and media restrictions remain part of the source context, not invented script chapters.

## Cross-cutting checks

- Begin with source-use reconciliation, not only a final-script view; inputs with no output remain reachable.
- Show one hierarchy level at a time on mobile and laptop; preserve navigation/selection and aggregate unresolved outcomes upward.
- Inspect exact original/result mappings in both directions. A source link or mapping count does not certify semantic coverage.
- Distinguish intentional exclusion, unknown use, failed acquisition, incomplete extraction, known additions, and stale mappings.
- Record user/authorized-agent decisions against exact input/base revisions. Test simultaneous edits and relevant-change invalidation.
- Preserve edited MDX, task IDs/history, drafts, submissions, and feedback through a source update, content migration, and task consolidation.
- Do not write real course data while running tests. Browser-injected fixtures must remain test-only.
