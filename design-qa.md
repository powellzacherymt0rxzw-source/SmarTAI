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

final result: passed
