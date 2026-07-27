# Design QA — Q01–Q03 unified preparation and review

## Comparison target

- Source visual truth:
  - `/Users/annie/code/SmarTAI/docs/20260710/figma/06 Question Preparation Overview 题目准备总览.png`
  - `/Users/annie/code/SmarTAI/docs/20260710/figma/07 Question Detail 题目详情与材料槽位.png`
- Rendered implementation:
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260726-q03-risk-overview-final.png`
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260726-q03-continuous-review.png`
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260726-q03-latex-edit-state.png`
- Side-by-side evidence:
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260726-qa-compare-risk.png`
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260726-qa-compare-detail.png`

## Viewport and normalization

- Figma exports: `2880 × 1800`, representing the `1440 × 900` logical desktop canvas at 2× density.
- Browser CSS viewport: `1280 × 720`, deviceScaleFactor `1`.
- Risk implementation full-page image: `1280 × 774`; continuous review full-page image: `1280 × 2775`; fixed review/edit captures: `1280 × 720`.
- Comparison copies normalize each Figma source with aspect-preserving downsampling to a `1280 × 800` content panel. Implementation uses its 1× browser pixels. The remaining 1440→1280 difference is the intended responsive desktop state, not a density mismatch.
- State differs intentionally from the generic Figma examples: the implementation uses an 8-step workflow, a risk-only matrix, and continuous all-question review because these are explicit user-approved product overrides.

## Findings

- No actionable P0/P1/P2 visual or interaction mismatch remains in the compared scope.
- Typography: the implementation retains the project sans-serif stack, bold 30px page hierarchy, compact 13–14px controls, and muted supporting copy. No clipped or broken text was visible.
- Spacing/layout: 1300px content cap, restrained borders/radii, independent metric cards, full-width search, table hierarchy, and large whitespace follow the Figma language. The 8-step rail scrolls horizontally instead of compressing labels.
- Colors/tokens: white and blue-gray surfaces, primary blue, teal completion, and limited amber/red risk colors match the source intent without increasing decoration.
- Image/assets: these screens contain no product imagery. SmarTAI is text branding as in the source; interface icons use one Lucide stroke family rather than custom SVG/CSS drawings.
- Copy/content: workflow wording uses `新建任务 / 上传题目 / 审核题目` and the risk/detail copy reflects actual capabilities. Non-programming questions do not mention programming test cases.
- Interaction/accessibility: prior/current steps are links; future steps are disabled; search is IME-safe; table headers expose sorting/filtering; fields have named edit controls; browse mode renders KaTeX while edit mode exposes source; no final-page console errors or warnings were observed.

## Focused region evidence

- The risk table and metric/search region are readable in `20260726-qa-compare-risk.png`; no extra crop was needed.
- The top of the continuous review, sticky question rail, complete question package, rendered equation, and raw edit state are separately readable in the full-page and edit-state captures. The detail source is a single-question mock while the implementation deliberately repeats the same card anatomy for continuous review, so pixel-level row-for-row comparison would be misleading.

## Comparison history

- Pass 1: source and implementation were placed into the two side-by-side comparison images above. No P0/P1/P2 issue was found, so no visual fix-and-recapture iteration was required.
- Earlier product corrections already incorporated before this blocking pass: removed tabs and all/single mode, added the left question rail, grouped all applicable material per question, hid programming tests for non-programming questions, rendered LaTeX in browse state, and changed the workflow label from “上传资料” to “上传题目”.

## Residual test gaps / P3 follow-up

- Native browser 200% zoom and VoiceOver remain user-device checks; automated focus semantics and responsive overflow checks passed in the existing project QA suite.
- A future 1440 × 900 capture can make the design comparison numerically 1:1, but the current 1280 responsive capture contains no actionable layout drift.

## Primary interactions tested

- Eight-step current/past navigation and disabled future steps.
- Q01 role switching, multiple independent sources, edit-task round trip, and missing-BYOK explanation.
- Q03 search, ascending/descending header sort, multi-select question type filter, and risk-only rows.
- Left-rail navigation, previous/next scrolling, per-field edit state, rendered LaTeX, programming-only OJ samples, and confirm-all entry.
- Console checked on final risk and continuous-review states: 0 errors, 0 warnings.

## 2026-07-27 regression comparison

- New rendered evidence:
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260727-q03-matrix.png`
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260727-student-continuous-review.png`
- New combined comparison inputs:
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260727-q03-comparison.png`
  - `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260727-student-comparison.png`
- Q03 intentionally evolves Figma 06 from coverage percentages to the user-required complete material matrix. The comparison retains the same header, title scale, step rail, large metric cards, full-width search, restrained table, radii, borders, whitespace, and status palette. No clipped table column or nested legacy card pattern is visible at `1280 × 720`.
- Student answer review intentionally evolves the prior single-question screen into the Q03 continuous pattern. The comparison confirms a labeled, independently scrolling left question rail; a complete question header with previous/next controls; and one flat content card without the former duplicated top/bottom question switch bars.
- Interaction regression: Q2 deep-link aligns both the card and sticky rail at `86px`; selecting a different student keeps Q2; Chinese “积分” is committed without pinyin residue and filters by an explainable alias; persisted task state keeps completed workflow links reachable.
- No new P0/P1/P2 visual or interaction mismatch was found in this regression scope. Native Safari IME composition was addressed in code and the final-value/filter behavior was verified in the bound local browser; device-level 200% zoom and VoiceOver remain user checks.

## 2026-07-27 canonical student review and C01 inline materials

- Student review now has one implementation and one URL: `/tasks/:id/students/:sid?question=:qid`. The former `/questions/:qid` route and separate overview component were deleted rather than hidden behind a redirect.
- The merged page keeps the spacious metrics and source context from the student overview while adopting the independently scrolling question rail, continuous cards, search, previous/next positioning, and keyboard behavior already proven in Q03.
- Browse mode renders both question and student-answer LaTeX. The question is read-only in this stage; only an explicitly edited student answer exposes source text, then returns to rendered mode after save.
- The former “识别状态与提示” textarea and normal “未发现异常” copy are absent. Exactly one compact badge beside each question communicates `已识别`, `需复核/低置信`, or `作答空/未识别`.
- Switching students resets the document to absolute top so the current identity is visible. Reaching the document end forces the last card active, fixing the Safari case where Q3 was visible while Q2 remained highlighted.
- C01 now keeps supplementary materials inline: a restrained single surface shows library search, local upload, the save-to-library choice, selected count, one material per row, remove action, and the course-library link. The obsolete independent materials page was removed.
- Visual evidence: `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260727-grading-setup-inline-materials.png`. C01 has no dedicated Figma frame, so the comparison uses the locked density/hierarchy constraints from Figma 08, 12, and 17 rather than inventing a new visual language.
- Console evidence for the C01 browser state: 0 errors / 0 warnings. Temporary task and fake local provider created only for layout verification were deleted before commit.
- Engineering evidence: visible-scope audit and TypeScript passed; Vite production build passed; task-KB/RAG regression `16 passed`; combined C01/course-material/S04/S05/Q02-Q03 regression `41 passed`.

final result: passed

## 2026-07-27 S05 / R01 matrix-and-queue alignment

### Source and rendered evidence

- User-marked R01 source: `/var/folders/_p/v8vvlf6x441989_5zxzsl3y40000gn/T/codex-clipboard-8f7a1264-f079-4473-a4f4-3b856beb79b9.png`.
- Verified R01 implementation: `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/R01-review-matrix-aligned-full.jpg`.
- Verified S05 implementation: `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/S05-submission-matrix-aligned.jpg`.
- Browser state: real local teacher account and existing task `T_39aca252a1`; no provider call and no mutation was performed.

### Comparison findings

- Both pages now use the same elastic matrix plus 280px queue anatomy and the same bottom action rail. The queue is materially narrower than the source while the matrix remains the dominant surface.
- The matrix explicitly separates 学号 and 姓名 and ends every row with 查看. Question columns are 60px and their state surface fills the cell, leaving enough room for roughly ten questions before internal horizontal scrolling.
- Status semantics are visual and accessible: green check = normal, blue circled check = reviewed, amber warning = attention, red cross = error, sky note = teacher comment. Text remains available through `aria-label`, `title`, and screen-reader content.
- R01 keeps 查看批改详情 to the left of the bottom-right primary action. Completed historical tasks correctly replace the mutation with 查看最终结果; an editable task will show 确认复核完成 in the same position.
- S05 and R01 queues contain only real pending items and share the same compact link-row rhythm; an empty queue does not invent warnings.
- The workflow label is consistently 复核批改 / Review Grading, followed by 结果分析 / Results Analysis.
- Typography, restrained color count, border radius, page width, status colors, and whitespace remain within the established Figma 14/product-shell language.
- No actionable P0/P1/P2 mismatch remains in this scope.

### Interaction, accessibility, and engineering checks

- S05 rendered 4 students × 3 questions. All four rows have 查看; all 12 status links expose complete accessible labels; the reviewed state is visibly distinct from normal recognition.
- R01 rendered the same 4 × 3 result matrix with full row actions and canonical student/question review links.
- Both pages have no page-level horizontal overflow; additional question columns scroll inside the matrix instead of expanding the document.
- Clean in-app browser tabs reported `0` console errors and `0` warnings for both routes.
- `npm run lint` passed, including visible-scope audit and TypeScript.
- `npm run build` passed with `937 modules transformed`.

final result: passed
