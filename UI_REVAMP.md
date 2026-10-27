# Call Nina UI revamp

Living design work plan, explicitly requested on 2026-10-26. Update this file as inspection reveals findings, implementation resolves them, and interactive verification establishes results. This file tracks the revamp; current source/runtime establish behavior, and repository instructions and owning skills retain their authority. Keep durable decisions in their owning skill and implemented components rather than duplicating a permanent design manual here.

## Goal

Make Call Nina feel like one thoughtfully designed language-learning product: consistent, legible, accessible, calm, and recognizably Nina. Improve every desktop screen and meaningful state through repeated inspection, focused fixes, and verification. Strengthen the existing design system so future features inherit its quality and personality.

Work is focused on design, UI, UX, interaction, feel, and personality. It includes small behavior changes necessary for coherent interaction, such as navigation guards, filter behavior, focus, and preserving drafts. It excludes unrelated backend, curriculum, provider, accounting, infrastructure, and performance projects.

Current phase: **complete on 2026-10-27, with explicit state-dependent verification limitations below**.

The current findings table, completion audit and final closeout are authoritative for status. Earlier work-log entries preserve the evidence and limitations at that time; later acceptance and cleanup entries supersede their pending statuses.

## Working agreement

- Read root/scoped `AGENTS.md` and the development, desktop UI, and Electron verification skills. Work as one agent unless the user asks for delegation. Inspect branch/worktrees/changes before edits and preserve concurrent work.
- Continue autonomously through small, reversible local improvements. Ask only for a material product decision that evidence cannot resolve, missing authorization, or a genuinely blocked dependency. Record unresolved choices without blocking independent work.
- Keep delivery local. Do not commit, push, publish, deploy, enable CI, or create PRs unless separately requested.
- Preserve learner records, settings, credentials, learning semantics, accessibility, and unsaved work. Use exact-owned verification sessions. Never stop a user-owned app.
- Follow the repository's interactive verification policy: no automated application tests, fixtures, saved journeys, or screenshot regression suites. Run `make check` only when static verification is explicitly requested or preparing/updating a PR.
- Personality work may refine concise, useful interface wording. Do not add reassurance paragraphs, technical explanations, marketing filler, or commentary about the implementation to the product. Preserve essential instructions, privacy information, and destructive consequences.
- Keep all registered interface locales complete for changed copy. Interface, target, and explanation languages remain distinct.
- Do not manufacture learner data or trigger paid AI generation just to decorate a screenshot. If a state needs live generation or a controlled mutation, follow the verification skill and record scope and cleanup.
- This is a finite revamp. Complete the coverage and acceptance criteria below; do not invent new visual directions indefinitely.

## Initial evidence and coverage

Baseline source: `535159af693b6e7a5f64247ddfd34ab11a3ffb88`, branch `consolidation/local-finish`. The working tree was clean before and after the initial inspection. No UI changes or Impeccable installation were made during that inspection.

The first pass reviewed source and the real Electron UI in English. It inspected the default large window, Writing at 1000×800 with the helper closed/open, Writing and Home at 800×800, and the vocabulary generation dialog at 1440×900. These were visual and limited interaction observations, not full behavior or accessibility acceptance.

| Surface | Initial evidence | Remaining coverage |
| --- | --- | --- |
| App shell, navigation, language/model controls, helper | Source; visible shell across pages; helper open/closed; smaller-window samples | Keyboard navigation, collapsed navigation, zoom, long labels, helper content/feedback and focus return |
| Home | Resume state and quick-practice composer; large and narrow samples | First use, no resume, loading/failure, all chooser states and launch/return behavior |
| Practice | New/Quiz and Saved activities; shared composer source | Every setup type, expanded options, source-material workflows, filtering, empty/error/pending/cancel states |
| Learning paths | Library, one trail, one lesson's Activities tab | Search/no results, other trail states, Progress/Lesson guide, review, completion, return context and responsive variants |
| Vocabulary | Empty library and generation dialog; dialog dismissed with Escape | Populated/candidate/due/paused states, details/editing, selection/bulk actions, review, validation and failure |
| History | Populated list and basic filter form; source | Advanced filters, details by activity type, no results, evidence presentation, return/repractice behavior |
| Settings | Learning, AI connections, Data & privacy, Diagnostics | Connection dialogs and states, dirty/save/discard, validation, long labels, overflow and keyboard operation |
| Personal Data | Overview and shared table source | Storage, Clean up, confirmations, responsive tables and precise copy |
| Writing | Blank free-writing surface and helper; large/narrow layouts | Prompt/reference, answer/review, corrections, pending/cancel/error/completion, dirty navigation and enlarged text |
| Other activity players | Shared activity architecture and selected consumers reviewed in source | Quiz/grammar, flashcards, reading, listening/speaking preparation and returns, placement, vocabulary review; all meaningful player states |
| Startup and onboarding | Partial source review | Folder/profile/access flows, optional connection, readiness/error/recovery and first-use keyboard flow |

Shared controls also affect the website. Inspect affected website consumers whenever shared browser UI changes. Mobile shares portable tokens but has a separate native design foundation: inspect that impact when changing tokens, without expanding this project into a mobile feature implementation.

Inspection lifecycle: the controlled app stopped and its reservation was released. No learner records or preference mutations were created by this pass. The resumed verification journal retained older unresolved interrupted-action entries; do not claim those were reconciled or discard their evidence. Inspect current verification status before the next session.

### Early implementation coverage (historical; current status follows)

- Shell/Home: English at 800×800 and 1000×800, helper/navigation open/close and Escape. Writing temporary unsaved draft persisted through 800→1440→1000 resizing and helper toggles; cleared without saving.
- Practice: empty Quiz setup and topic draft blocking; real target-language change to Spanish returned Home; restored German. Saved library heading and other setup/player/material states remain to inspect.
- Vocabulary: empty German and Spanish libraries, generator open/Escape and language guard. Portuguese empty state visually inspected at 800×800 and 1440×900. Populated/no-match regression remains.
- Settings: saved interface changes through German, Portuguese, Spanish, then restored English; learner profile fields otherwise preserved. German large/800×800 and Spanish 1440×900/800×600 layouts inspected. Portuguese shell/empty Vocabulary at both widths. Dirty save controls observed.
- History: populated list and Speaking no-results state. Changing the select applied immediately despite the Apply button, confirming DS-01.
- Lifecycle at that early checkpoint: owned session stopped, reservation released, no remaining tracked records/preferences. Three pre-existing interrupted-click entries remained unresolved. See the latest closeout for the subsequently retained vocabulary review.

### Expanded state inventory (source-backed; not a claim of live coverage)

| Owner / surface | Meaningful states to cover | Current dependency |
| --- | --- | --- |
| Startup.tsx | Folder selection, selection warning/confirmation, cancel; schema-newer, locked, stale, missing, invalid/failed root; retry/recover | Root is healthy. Failure states require an actual unavailable root; do not corrupt or replace learner storage to produce them. Folder confirmation must preserve the current root. |
| ProfileOnboarding.tsx | Connection, goal, defaults, review; optional connection, connected/pending/failure, required goal validation, return/cancel | All four setup steps and return inspected. Empty/whitespace goal disables Next with associated hint/error and invalid state; valid recovery and saved-goal preservation verified EN/DE. Account failure states depend on real service conditions, not simulated credentials. |
| App.tsx | First-AI disclosure; unavailable-operation dialog; dirty Writing navigation; model menu; helper empty/selection/response/error | Disclosure depends on unacknowledged privacy state; preserve existing consent. Helper responses need live AI. |
| PracticePage / MaterialPractice | Six setup types, options, saved type filters, deletion confirmation; material list/detail/edit/create, source selection, validation, unsaved return | Setup/library, source create/select/edit-Cancel and owned deletion inspected. Saved source paragraphs preserved; material language guard verified. Revision-saving outcomes require explicit tracked revision readback; existing sources untouched. |
| LearningPathPage / Catalog | Library search/type/level/no matches; trail stages/checkpoints; lesson Activities/Progress/Lesson guide; review queue; saved completion/return | Library, trail, three lesson tabs, retry label and review queue inspected. Starting/answering/skipping/completing existing course work changes learner progress; current controller cannot own/restore course marks and evidence, so those mutations remain deferred. |
| WritingWorkspace / CorrectionComparison | Free text, prompt/reference, review options, pending/cancel/error/retry, corrected/unchanged/uncertain text, inline/side-by-side selection | Blank/draft, resizing, selection/helper and dirty-navigation Keep editing checked. Correction variants require actual saved model output and exact history cleanup; controller tracks activities/materials but not standalone correction records. |
| ExerciseEngine | Prepared start, multiple-choice, blanks, short answer; reveal/support, submitted feedback, retry, advance, abandon, completion/review | Use session-owned real activities for mutations and cleanup. |
| FlashcardWorkspace | Cue/reveal, example/translation, previous/next, finish, restart; save word/all, existing/suspended word, delete | Two real owned decks exercised cue/reveal/next/completion, keyboard advance and restart. One saved word was proven through its tracked deck link. The saved word and its review were removed through exact-owned UI actions after the History interaction fix; no user deck modified. |
| Vocabulary | Empty, populated statuses, no matches/reset, paging, selection/bulk, details/edit; generator pending/cancel/preview; recognition/recall/completion | Empty/dialog, narrow generation pending state, real preview/reveal and Vocabulary breadcrumb return verified. Cancellation restores editable topic and generation action; explicit Cancel then closes. Library count unchanged after cancellation. Populated library/details and no-match/reset inspected; one owned word reviewed through recall/reveal/grade/completion. German details edit Cancel preserved saved meaning; Pause reflected state. EN/DE library singular counts verified. Individual vocabulary-review History removal is now supported and verified without changing the word schedule; exact-owned word cleanup succeeded afterward. Selection and bulk resume/pause verified on the single owned word; paused due-review action is disabled, and minimum-three-word deck creation stays disabled with one selected. Paging and candidate states require suitable data and remain unverified. |
| History | Compound filters/advanced/validation/reset, mistake patterns, writing/exercise/voice/vocabulary details, repractice/delete | Existing exercise/vocabulary history available. Writing/voice variants depend on real records. Never delete existing history for verification. |
| Settings | Learning dirty/save/discard; AI model/effort and connection dialogs, auth/integration; storage/privacy; diagnostics | Locale save/restore checked. Credential/auth mutations are unnecessary for layout; inspect dialogs without changing secrets. |
| Personal Data | Overview, Storage, Clean up, destructive confirmation/cancel; blocked/pending/success/error | Read-only tabs and cancel reachable. Destructive outcomes intentionally not exercised on learner data. |
| Shared desktop controls | Dialog/menu/popover, disclosures, tabs, select/fields, notices, icon actions, focus/return, reduced motion | InfoHint, dialog Escape, tab navigation, reset focus, overlay occlusion/focus return and resize checked. Reduced motion inspected. Controlled input did not establish zoom behavior. On 2026-10-27 the user confirmed native zoom shortcuts work and Writing’s text field, footer actions and helper toggle remain reachable at 200% zoom; enlarged-text acceptance is user-verified. Shared browser/token packages unchanged. |

### Earlier live coverage (historical checkpoint)

- Real GPT-6 Luna, runtime-default effort, generated one tracked three-card German flashcard deck. Observed pending/cancel affordance, cue/reveal/examples, ArrowRight advance, narrow sticky controls, and saved completion with Nina. Completion inspected at 800×600 and 1440×900. Removed the exact-owned deck using controller cleanup; no vocabulary words were saved.
- Learning paths: search no-results/recovery by clearing input; course trail, lesson Activities/Progress/Lesson guide, expanded language reference. Narrow guide screenshot exposed DS-06; prior-attempt status exposed UX-10. No course answers/skips/completions were changed.
- Shell: helper closed automatically when focus returned to a covered catalog field at 800px. Reduced-motion emulation enabled; catalog remained usable. Attempted Ctrl++ produced no visible zoom, so enlarged-text acceptance remains unverified.
- Personal Data: Overview revised privacy text read back; Storage long paths wrap at 800px; Clean up table and practice confirmation opened then Cancelled. No cleanup executed against learner records.

## Existing design system: preserve and strengthen

- `packages/design-system/src/index.ts`: portable semantic colors, typography, spacing, radii, borders, shadows, motion, and native exports.
- `packages/browser-ui/src/`: shared browser controls and surfaces, including buttons, fields, tabs, dialogs, feedback, and activity choices.
- `apps/desktop/src/renderer/components/layout/`: page/header/breadcrumbs, sections, actions, grids, filters, content rows, shell, and table styling.
- `apps/desktop/src/renderer/components/activity/`: activity workspace/frame, reference, progress, feedback, footer, recall, and completion.
- `.agents/skills/call-nina-desktop-ui/SKILL.md`: owning guidance for visual identity, components, layout, accessibility, copy, and verification.

The foundation already exists. The initial diagnosis is that drift occurs mainly in composition, state design, local overrides, interaction conventions, and context-sensitive copy.

Consistency rule: **the same role gets the same treatment; different tasks use deliberate, approved variants**. A writing editor, vocabulary table, and lesson trail need different compositions. Their controls, spacing roles, navigation conventions, and feedback should still belong to one system.

## Personality direction to explore

Working direction: **a warm language studio with an attentive teaching companion**. Preserve the existing cream, espresso, terracotta, Figtree, Fredoka wordmark, and Nina character as the starting identity. These are established choices, not defects merely because a generic design detector dislikes warm palettes or rounded shapes.

Nina should feel observant, capable, patient, and lightly playful. The adult learner should feel respected. Personality should make learning clearer or more inviting, and become quieter when concentration matters.

| Trait | Concrete expression | Avoid |
| --- | --- | --- |
| Attentive | Surface the actual next step; restore the learner's place; make corrections easy to compare | Generic dashboards, repeated summaries, losing context after an action |
| Warm | Conversational, concise labels; readable rhythm; sparing character presence at meaningful transitions | Excessive praise, childish wording, exclamation marks everywhere |
| Capable | Clear distinction between answering, checking, saving, and completing; specific recovery actions | Fake progress, vague success, making participation look like mastery |
| Quietly playful | A small purposeful Nina pose or restrained response to completion | Constant movement, novelty cursors, gratuitous confetti, bouncing controls |
| Rooted in language | Beautiful reading passages, clear annotations, pronunciation/example presentation, thoughtful correction marks | Generic SaaS decoration or turning every section into a card |
| Respectful | Keep the learner's words intact; distinguish original, correction, and explanation; support unhurried practice | Rewriting learner intent, gamification pressure, infantilizing feedback |

### Candidate signature moments

These are design hypotheses to inspect and implement selectively, not a requirement to add all of them.

1. **A recognizable learning typography.** Give prompts, learner answers, examples, translations, and corrections distinct semantic roles within the existing type system. Explore restrained editorial cues such as an annotation marker or underline where they convey meaning. Keep text selectable and readable; verify contrast and ensure meaning survives without color.
2. **A useful welcome and return.** Let the current learning task carry the Home screen. Nina can acknowledge a meaningful return with an existing pose and a concise contextual action. Avoid unnecessary greetings or a second dashboard above the task.
3. **Feedback with a teacher's precision.** Separate what happened, what the learner can learn from it, and the next action. Prefer existing structured evidence over new generated praise. Never imply proficiency from unsupported evidence.
4. **Character with a job.** Assign the existing welcome/listening/thinking/celebration poses to meaningful moments, with consistent scale and placement. Use Nina sparingly in onboarding, genuinely empty states, and completion. Keep routine forms and dense libraries quiet. Do not require per-topic artwork or runtime image generation.
5. **A coherent motion vocabulary.** Use a few short transitions to explain selection, disclosure, feedback arrival, or completion. Reuse motion tokens. Keep task controls stable and implement reduced-motion equivalents. No artificial waiting or animation that delays the next action.
6. **Language-specific craft.** Check diacritics, long German compounds, Portuguese/Spanish labels, pronunciation text, mixed-language passages, and the difference between interface and learning language. These details contribute more identity than decorative badges.
7. **Consistent tactile details.** Refine icon alignment, focus treatment, selection, hover, separators, and empty space. Establish one treatment for each purpose instead of improvising decorative styles per page.

Build personality into a small number of reusable components and semantic roles. Do not create a large menu of decorative variants. Evaluate a candidate in both a simple and a dense real screen before making it the default.

### Personality acceptance questions

- Does this detail belong specifically to language learning or to Nina's role?
- Does it help orientation, comprehension, confidence, or a meaningful transition?
- Does it remain pleasant after repeated daily use?
- Does it preserve readability, task speed, adult tone, and reduced-motion access?
- Can the same decision be applied consistently elsewhere?
- Would the screen still be recognizable through its hierarchy, typography, and behavior without the mascot or logo?

## Initial findings register

Priority: P1 = substantial task/accessibility obstruction; P2 = recurring UX/design inconsistency; P3 = refinement. These are initial priorities, subject to new evidence. Status: open → investigating → implemented/unverified → verified; alternatively intentional or deferred with a reason. A code change alone does not make a finding verified.

| ID | Priority / status | Finding and evidence | Proposed resolution / acceptance |
| --- | --- | --- | --- |
| UX-01 | P1 / verified; 200% zoom user-verified | At 1000px the open helper and navigation leave Writing a narrow center column. At 800px expanded navigation occupies a large part of the initial viewport. Observed live; shell grid in `components/layout/AppShell.module.css`. | Implemented compact navigation by default below 80rem, overlay navigation and helper at constrained widths, and Escape navigation dismissal. Live Home inspected at 800×800 and 1000×800; Writing draft survived 800→1440→1000 transitions and helper open/close. Escape helper focus ring observed on toggle. Representative shell layouts checked across four locales. Selection survived helper opening and a live translation at 800×600; Escape focused the toggle. Covered task focus dismisses overlay. On 2026-10-27 the user confirmed Ctrl+plus/minus zoom and reachability of Writing’s text field, footer actions and helper toggle at 200%; this is user evidence, not an agent-controlled zoom pass. |
| UX-02 | P2 / verified browse/activity boundaries | Empty Practice, Saved activities, and empty Vocabulary disable language switching and say to leave/finish an activity. Observed live; page-level restrictions in `App.tsx`. | Scoped blockers to Practice drafts/material selections/operations/activities and Vocabulary dialogs/review/operations. Verified empty Practice switch to Spanish, typed topic blocks and clearing restores availability; empty Vocabulary permits switch, generation dialog blocks, Escape restores. Returned to German. Active quiz/grammar guard verified through generation, prepared and playing states. Selected-material guard also verified with an owned source. Populated Vocabulary review also verified: learning-language select disabled during review, with return to the library available. No additional grading was needed. |
| DS-01 | P2 / verified English/German | History has a bordered filter form and Apply button; Learning paths filters immediately; Vocabulary has another toolbar. Live/source evidence in `HistoryPage.tsx`, `LearningPathCatalog.tsx`, `VocabularyPage.tsx`. | Live second pass confirmed History applies Skill changes before Apply is pressed. Keep explicit submission for its compound date/text form and add reset; simple catalog/vocabulary filters remain immediate. Verified edited Skill leaves results unchanged until Apply, then no-results; Clear filters restores the list. Invalid topic submitted shows validation feedback; clearing recovers. German Apply/Reset layout inspected at 800×600. |
| UX-03 | P2 / verified first-use and populated no-results | Empty Vocabulary exposes search, sort, five zero-count filters, and table headings alongside onboarding content. Observed live. | Distinguish first use from no matching results. Make the next useful action clear without hiding recovery controls after filtering. |
| DS-02 | P2 / verified migrated surfaces | Practice recreates card-like surfaces in `PracticePage.module.css`; Vocabulary has a custom welcome surface. Source evidence. | Practice now uses Card and empty Vocabulary uses Section surface; old local recipes removed. Both inspected in the live app at narrow/normal widths. Populated Vocabulary at 800×600 preserves readable word/meaning and status/date groupings. |
| DS-03 | P2 / intentional API retained after audit | `packages/browser-ui/src/Button.tsx` defaults to primary except pressed toggles. This makes accidental visual emphasis easy. Source finding, not proof every consumer is wrong. | AST source audit found every desktop Button/IconButton supplies an explicit variant. The only implicit website button is its disabled Download primary action. No observed desktop defect depends on the default; retain API and explicit-variant guidance. Shared packages unchanged. |
| UX-04 | P2 / verified English/German readback | Personal Data's English privacy text says AI actions send context through Codex despite direct connection support. Live/source evidence in `locales/en.json` under personal-data privacy. | Updated all four locales; English and German readback distinguish selected AI connection from Codex Voice and retain local/audio privacy information. |
| DS-04 | P3 / intentional | Home/Practice/Settings use form width; collections use standard width, causing cross-page edge changes. Existing intentional variants, not automatically a defect. | Form pages constrain reading and field scanning; collections use standard width; active activities use their task/reference composition. These intentional page families are retained. Live Settings, Vocabulary, catalog and task screenshots share aligned edges within their family. |
| UX-05 | P3 / verified; repeated-heading audit completed | Saved activities repeats its tab label as a section heading; several screens repeat summary/status content. Observed examples; broader audit needed. | Removed redundant Saved activities heading; live library retains tab orientation and neutral count. Setup duplicate headings addressed in UX-13. Retained reading/reference titles where they identify distinct content. |
| DS-05 | P2 / considered, deferred by design | No dedicated component gallery was found in the initial repository inventory. The skill is detailed, but canonical compositions are harder to inspect together. | Do not add a second gallery surface in this revamp. Existing real catalog, History filters, Settings form, ActivityFrame and dialogs provide reference compositions without inert sample maintenance. Recorded references in UI skill; revisit a gallery only if concrete adoption problems remain. |
| ID-01 | P2 / verified learning moments | The current palette, type, and mascot are recognizable, but personality is not yet defined across feedback, copy, motion, and learning-content presentation. Design hypothesis. | Shared completion heading uses small celebration/listening poses chosen by the caller, without inferring proficiency. Real generated flashcard completion inspected at 800×600 and 1440×900; existing Home return remains a useful reference. Lesson-guide word/translation typography verified at 800px. Exercise completion pose also inspected after a real three-exercise quiz; real one-word Vocabulary completion and its celebration pose also inspected at 800×600. Completion count wording changed afterward and remains separately recorded in UX-22. |
| UX-06 | P2 / verified English/German names | Writing exposes two buttons named “Generate prompt” in the live accessibility tree. Source identifies the second as InfoHint, not a duplicate generation action. | Shared desktop InfoHint now prefixes accessible names with localized “About …”; visible dialog titles remain concise. Verified Writing action and help button have distinct names; opened help and dismissed with Escape. German Writing names also distinguish action from Informationen zu … help. |
| UX-07 | P3 / verified English readback | Saved activities count says “17 ready” while the list includes started activities and retained evidence. Observed in English live; locale practice.library.count. | Use a neutral activity count in every locale; do not imply all listed work is ready or complete. |
| UX-08 | P3 / verified narrow | Flashcard completion Restart deck stretches across the whole activity width, competing with the return actions. Observed at 800×600 and 1440×900; FlashcardWorkspace.tsx. | Shared ActionGroup keeps Restart compact and quiet below return actions. Real owned deck at 800×600 verified completion and restart to card 1, unrevealed. Deck removed. |
| UX-09 | P2 / verified English | Learning-path no-results copy offers “clear the filters” but no reset control exists. Observed live; LearningPathCatalog.tsx. | Clear filters beside result count resets query, type and level together; verify count and results recover without losing navigation context. |
| UX-10 | P2 / verified English/German | Lesson activity shows Not started beside saved feedback/Retry. Source: explicit reopen marks override attempt status in courseActivityStatus; prior evidence is retained intentionally. | Preserve progress semantics; presentation labels reopened activities with prior attempts “Ready to retry” in header and accessible activity navigation. Verify real existing case. |
| UX-11 | P3 / verified German readback | Personal Data cleanup heading says “Start fresh for testing” in the learner UI. Observed live; personalData.cleanup.learning.title. | Use concise “Start fresh” in all locales. Preserve full destructive consequences and confirmation. |
| DS-06 | P3 / verified narrow English/German | Lesson guide renders every word/translation as a separate rounded bordered box and a full-width primary save action. Observed at 800×800; LearningPathLesson/stylesheet. | Use a definition list with reading-size target words, supporting translations and quiet separators; assign target-language attributes; use shared ActionGroup for the secondary save action. |
| UX-12 | P2 / verified English narrow | Dirty Settings puts its save/discard hint inside the header action group; at 800px Refresh falls onto its own row. Observed with unsaved new API connection. | Move the existing hint into page content as status; verify normal/dirty layouts and discard. |
| UX-13 | P2 / verified English/German | Setup step 3 exposes two Interface language selects for the same value; step 4 repeats its heading inside a bordered fieldset. Observed live through all four steps. | Retain the global language control, remove duplicate, use named borderless fieldsets and one review heading. Verify four-step navigation and cancel without changing profile. |
| UX-14 | P1 / verified active/browse boundary | Learning-path active players remount when target language changes, while App originally allowed language switching on the whole learningPath route. Inferred draft-loss risk from keyed workspace and unrestricted select, not reproduced by discarding a learner answer. | Apply the same state-scoped blocker while a path player or operation is active; browsing remains switchable. Verified by opening the existing current resumable activity to its pre-start screen: language disabled. Returning via lesson breadcrumb re-enabled it. No exercise started/answered; existing current course selection retained. |
| UX-15 | P2 / verified for three answer types | Real three-exercise quiz completion review showed verdicts and explanations without questions or submitted answers. Learners must remember the original context to understand corrections. | Reused read-only exercise content with retained answers. Real second quiz verified choice selection, incorrect blank and short answer in completion review; 800px view reaches the final explanation. Found clipped submitted blank text (UX-16). |
| UX-16 | P2 / verified narrow | Submitted blank input has fixed 10ch width; the real review clips even a short two-word phrase. | Evaluated blanks now render wrapping text. Real owned grammar activity at 800×600 showed a full multiword phrase with accepted-answer feedback and reachable next action. Editable blanks remain inputs. |
| UX-17 | P2 / verified | Clear filters removes its own focused button in catalog and History. Source review indicates focus can fall back to the document after reset. | Reset now focuses catalog search or History Skill. Live typing into the focused element after catalog reset entered search; History focused-element snapshot confirmed Skill after reset. |
| UX-18 | P2 / verified narrow | Scrolled material details at 800×600 pins the Practice header at viewport top, placing Refresh underneath the fixed helper toggle. | Narrow page headers now scroll naturally. At 800×600 the scrolled material no longer pins Refresh under helper; keyboard focus brings header back with both controls separated. |
| UX-19 | P2 / verified Spanish response markup | ContextualHelper marks all translation source text with lang=de even when studying another supported language. | Translation source uses active learning language. Live Spanish helper response with German interface/English explanation matched span[lang="es"] for its source phrase. Temporary unsaved Writing text cleared; settings restored. |
| UX-20 | P1 / verified | Explicitly opened docked helper covers an already-focused Writing field after 1440→800 resize. Focus-change handling does not run when the field keeps focus. | Resize now runs the same focus-occlusion check. Verified explicit helper open at 1440, focused Writing draft, resize to 800: helper closes, field stays focused and visible. Return to 1440 retains focus and exact text; cleared temporary draft. |

When adding a finding, include a stable ID, priority, screen/state, observed impact, source owner, evidence type, proposed acceptance, and status. Avoid vague entries such as “make it polished.” Record an intentional difference explicitly instead of forcing uniformity.

## Evaluation checklist

For each screen and significant state:

- **Task:** main learner goal, clear next action, useful information order, ability to recover/return.
- **Structure:** approved page family, widths, aligned edges, breadcrumbs, tabs, scroll ownership, footer behavior.
- **Rhythm:** heading/content/control spacing, density, internal gutters, grouping, readable line length, unnecessary borders/cards.
- **Components:** shared imports and semantic variants, control heights, icon slots, local overrides, duplicated recipes.
- **Actions:** primary/secondary/quiet/danger hierarchy, cancellation, pending feedback, save semantics, destructive consequences.
- **States:** first use, empty, no results, loading, unavailable access, validation, error, retry, partial progress, success/completion.
- **Access:** keyboard order, visible focus, restoration, accessible names, selected/disabled semantics, contrast, enlarged text, reduced motion, non-color cues.
- **Adaptation:** available workspace width with helper/navigation open or closed, short windows, long translations, long learner content, reachable overflow.
- **Personality:** specific and respectful wording, meaningful character presence, restrained motion, language-focused presentation, repeated-use comfort.

### Vocabulary follow-up findings

| ID | Priority / status | Evidence | Decision / acceptance |
| --- | --- | --- | --- |
| UX-21 | P2 / verified English | Clearing an unmatched Vocabulary search removes the focused Clear filters control; subsequent focus inspection finds no focused element. | Return focus to the search input, matching catalog/history reset behavior. Rebuilt live reset produced focused searchbox readback. |
| UX-22 | P3 / library verified EN/DE; completion verified English | Live single-word library says “1 matching words”; completed review says “1 words reviewed.” | Add singular/plural forms for both counts in all four interface languages. Library singular readback verified in English and German at 800×600. After resolving History cleanup, a new owned recognition review verified “1 word reviewed.” and both completion actions at 700×500; its review/word/deck/source were removed. |
| UX-23 | P2 / placeholder and review removal verified EN/DE | Vocabulary review History Details displays a development placeholder about a future workspace. No Delete action exists; repository explicitly rejects non-attempt review deletion. | Remove the development placeholder. Reference-only rows without actions/metadata hide Details. Vocabulary review rows now offer the existing quiet confirmed removal action, with explicit schedule-preservation copy in four locales. The existing transaction removes only that history row; live Cancel and deletion verified, followed by unchanged paused word/stage/date/grade readback. This narrow supporting change resolves the observed interaction without altering scheduling or adding storage/schema machinery. |
| UX-24 | P3 / verified compact and wide | Narrow Vocabulary folds Next review under Status, repeating “Paused” twice for suspended words. Observed accessibility tree at 700×500. | Suppress the redundant compact schedule label only for paused rows. Rebuilt screenshot/tree at 700×500 show one Paused label; 1440×900 retains separate Status and Next review cells. |
| UX-25 | P2 / verified EN/DE | Setup shows a goal hint and required-goal paragraph without associating either with the textarea; whitespace-only input lacks aria-invalid despite disabled Next. Source finding, with real empty-goal behavior observed. | Replace the hand-built goal field with existing TextAreaField. Rebuilt invalid/description selector matched the real field; English and German 700×500 layouts remain readable. Valid text re-enables Next; leaving setup preserves/restores the saved goal. |
| UX-26 | P3 / verified English pending state | Creating a Reading activity shows “Creating quiz…” on the action. Observed live; ReadingPractice and other activity generators share exercises.custom.generating. | Use activity-neutral pending copy in all four locales; preserve the specific idle action labels. |
| UX-27 | P3 / verified English/German | Reference disclosure keeps a downward chevron when closed at 700×500. Observed live/source in ActivityReference. | Reuse the right-chevron/rotate-on-open convention of the existing Disclosure. |
| UX-28 | P1 / verified | At 700×500, the sticky activity footer covers the focused Reading short-answer field. Screenshot confirms input content underneath footer, unlike the earlier long-draft hypothesis. | Shared ActivityFrame checks actual focus/footer intersection after focus and layout/resize, scrolling only an obscured control into view without animation. Verified Reading blanks/summary at 700×500 and 1440×900, resize with draft preserved, and free Writing at 700×500 with the full field above the footer. |
| UX-29 | P2 / verified wide/narrow | Reading completion review preserves questions and answers but loses the source passage. Observed after completing a real six-question activity. | Keep the existing reference inside Review your answers, preceding the answers; no new copy or learning-state changes. |
| UX-30 | P2 / verified English/German | Reading setup nests two identical Practice options disclosures; two clicks are required to reach Level and Questions. Live tree and source confirm both PracticePage and ReadingPractice wrap settings. | Pass bare practiceSettings from PracticePage; ReadingPractice retains the single shared disclosure. Verify one-click access and preserved values across type switches. |

## Execution sequence

### 1. Complete the inventory and choose reference compositions

Enumerate actual routes, nested views, dialogs, and activity states from current source. Expand the coverage table rather than relying on filenames as a complete screen list. Inspect pending high-impact states. Choose canonical collection, settings form, activity workspace, and dialog compositions from the strongest existing examples.

### 2. Repair shell and recurring interaction issues

Start with UX-01 and UX-02. Establish predictable task space, navigation, helper behavior, focus, and draft protection. Then resolve filtering and empty states. These decisions affect many screens and should precede decorative refinement.

### 3. Consolidate the design system

Migrate recurring layouts and surfaces to the smallest useful shared patterns. Make spacing ownership, action hierarchy, and state treatments explicit. Remove replaced CSS and redundant aliases when safe. Avoid abstractions for genuinely unique behavior. Evaluate a lightweight component gallery after identifying the patterns it must show.

### 4. Introduce personality through real learning moments

Begin with Home/return, learning-content typography, feedback/completion, and one empty state. Keep dense screens practical. Extend the approved direction through the remaining surfaces. Refine localized wording as part of the same change, preserving teaching and proficiency semantics.

### 5. Inspect all remaining surfaces and harden the result

Cover onboarding, settings and connection dialogs, personal data, each activity family, history details, material workflows, and helper states. Check shared changes across registered interface languages at normal and narrow widths as required by the UI skill. Inspect the website when shared browser components change and native impact when portable tokens change.

## Impeccable integration

Impeccable is a development aid for critique, extraction, layout, hardening, and polish; production UI continues to use Nina's existing components and tokens. It was researched but not installed in the initial audit.

Sources reviewed on 2026-10-26: [official site](https://impeccable.style/) and [repository/command reference](https://github.com/pbakaus/impeccable). Recheck the current package and instructions before installation or command use.

- Start with critique of real screens and bounded accessibility/responsive inspection; use extraction after choosing canonical patterns, then layout/harden/polish for focused changes.
- Preserve Nina's established visual decisions. Generic detector output is evidence to assess, not an instruction to replace the brand or chase a score.
- Route its recommendations through existing repository boundaries: one agent, interactive verification, local delivery, no unsolicited product copy or CI.
- Its default `PRODUCT.md`/`DESIGN.md` workflow overlaps with this repository's skill-owned guidance. Resolve that ownership explicitly; do not introduce competing permanent specifications. Prefer references to the existing owners where supported.
- Installing dependencies/plugins, trusting hooks, and enabling integrations must follow applicable tool/skill requirements and the user's authorization. The revamp goal does not authorize deployments or arbitrary external actions.
- Impeccable availability is not a prerequisite for useful audit and UI work. Record setup blockers and continue independent findings.

## Repeatable work loop

1. Read this file and inspect current source/status. Select the highest-impact finding or uncovered surface.
2. Observe the real state and locate its owning code. Label inference separately from observed behavior.
3. Define a concrete acceptance condition and choose the smallest shared fix that addresses the cause.
4. Implement a coherent batch, including locales and removal of replaced styling. Follow the verification skill's source/session ownership rules.
5. Inspect the actual result at relevant widths and states. Verify meaningful interaction, keyboard behavior, and data preservation where affected. Broaden checks only when shared scope or new evidence warrants it.
6. Update this file: finding status, concise change, evidence, coverage, unresolved limitations, and next action. Update the owning skill only when a durable decision changes.
7. Continue with the next finding. Do not mark an item verified because it compiles or looks correct in source.

If blocked, record the exact dependency and continue independent work. Do not repeatedly launch incompatible verification sessions, erase historical cleanup evidence, or silently treat missing evidence as success.

## Completion criteria

- Every inventoried desktop surface and meaningful state has evidence or an explicit, specific unresolved verification dependency. Resolve reachable dependencies before claiming completion; deferred states remain visible in the final report.
- No known P1 findings remain. Recurring P2 findings are fixed and verified or have a reasoned, user-visible disposition.
- Repeated component/layout roles use approved patterns; remaining differences are intentional and recorded in their owning implementation/skill.
- Personality is demonstrated in real learning moments, remains restrained in dense screens, and is expressed through shared decisions rather than page-specific decoration.
- Relevant long-content, localization, keyboard, narrow-workspace, and reduced-motion checks are complete. Shared-package changes have appropriate consumer coverage.
- No known learner-data loss, navigation regression, broken drafts, or misleading learning/proficiency feedback has been introduced.
- Superseded CSS is removed, durable guidance is updated, and this file accurately distinguishes verified work from limitations.
- The final report names completed improvements, evidence, remaining issues, and process/cleanup status. Do not declare the full goal complete while required implementation or acceptance work is outstanding.

## Work log and next action

| Date | Work | Result / next step |
| --- | --- | --- |
| 2026-10-26 | Initial source/live desktop inspection | Findings above recorded; no application edits. Broader state/accessibility/localization coverage remains. |
| 2026-10-26 | User-requested personality brainstorm and living plan | Created this file. Personality direction is a working brief to validate in real screens. |
| 2026-10-26 | Shell/task-space batch | Reproduced squeezed Home at 1000×800. Replaced stacked narrow navigation with compact rail and expandable overlay; helper overlays below 80rem; added Escape navigation dismissal. Real rebuilt app: Home 800×800 and 1000×800, navigation/helper toggles and Escape, Writing draft retained through width/panel changes. Cleared the temporary unsaved draft. No AI calls or learner records created. Owned session stopped and reservation released; three historical interrupted clicks remain unresolved, with no remaining tracked records/preferences. Broader acceptance remains open. |
| 2026-10-26 | Idle language switching, library composition and copy batch | Added state-scoped blockers; verified empty/draft Practice and empty/dialog Vocabulary cases. Replaced custom Practice card and Vocabulary welcome recipes with shared Card/Section; removed repeated Saved heading. Localized InfoHint names and corrected privacy copy. Checked DE/PT/ES layouts; restored English interface/German learning language. Build succeeded after re-entering with regenerated CSS declarations. No AI calls or records created. Broader states remain open. |
| 2026-10-26 | History and naming follow-up | History now separates edited criteria from applied criteria and provides Clear filters. Verified Speaking edits retain the populated list until Apply, then show no results. Saved activities no longer repeats its heading. Writing InfoHint opens/dismisses correctly with the distinct “About Generate prompt” name. Found misleading “ready” count (UX-07). Refining shell auto-open threshold and focused-control visibility next. Owned session stopped, no remaining tracked records/preferences; historical unresolved clicks preserved. |
| 2026-10-26 | Completion personality and controller compatibility | Added explicit small listening/celebration poses to shared completion headings; outcome text/evidence semantics unchanged. Neutralized Saved activity counts in four locales. Helper auto-open now requires docked width; overlays dismiss when they would cover keyboard focus. Verification baseline exposed a controller dependency on the removed redundant heading; replaced it with existing data-library-ready marker. No generation happened before the failed baseline; stopped exact-owned session and retained historical cleanup evidence. New batch awaiting interaction checks. |
| 2026-10-26 | Live completion and learning-path/data inspection | Generated/tracked/revealed/completed/removed one real flashcard deck; completion companion verified at two sizes. Inspected course trail and three lesson tabs, catalog no-results, Personal Data tabs and cancellation. Added UX-08–11 and DS-06. Implemented clear-filter action, restrained Restart, reopened-attempt label, ordinary cleanup heading and language-reference list styling. Acceptance for these newest refinements remains next. |
| 2026-10-26 | Catalog/lesson acceptance and Settings/onboarding critique | Reset restored 15/15 paths; reopened lesson header/navigation now say Ready to retry; revised guide inspected at 800px. Reviewed AI connection draft/details then discarded, Diagnostics controls and all four setup steps then returned without saving. Recorded and implemented UX-12/13. Button audit found all desktop variants explicit; retained API. Recorded intentional widths and deferred optional gallery with canonical references in UI skill. No records/preferences left tracked after owned stop. |
| 2026-10-26 | Settings/setup and active-path guard acceptance | Dirty Settings at 800px keeps header actions aligned. Setup teaching step has one interface-language control; review has one visible heading; returned without saving. Existing current path activity opened only to pre-start: language switch disabled, then re-enabled on breadcrumb return. History invalid topic produces validation feedback only on Apply and Clear filters recovers. No new records or learner answers in this pass. |
| 2026-10-26 | Live quiz feedback and completion critique | Generated and tracked one real three-exercise quiz. Verified empty-answer validation, correct multiple choice, Hint/Escape, incorrect blank with accepted answer, short-answer feedback and completion. Completion review revealed UX-15. Exact activity and dependent history cleanup succeeded. Settings/setup and History acceptance are recorded above; remaining exercise review, locale and accessibility coverage continues. |
| 2026-10-26 | Contextual review acceptance and Voice preparation | Second owned quiz verified original questions and submitted answers alongside feedback; narrow screenshot exposed clipped submitted blanks (UX-16). Quiz/history cleanup succeeded. Read-only Listening transcript, Speaking guidance popover/Escape, German privacy/cleanup readback and narrow table inspected. Prior shutdown timed out but exact process stopped, no tracked records/preferences remained; historical evidence retained. |
| 2026-10-26 | Submitted blanks, reset focus and live helper | Real grammar answer verified unclipped multiword submitted text at 800×600. Catalog reset accepted immediate keyboard typing in search; History reset focused Skill. Selected exercise word survived helper opening, live GPT-6 Luna translation and Escape focus return. Exact grammar activity cleanup succeeded. Flashcard restart acceptance is next. |
| 2026-10-26 | Restart and material flow acceptance | Owned deck completed and restarted to first unrevealed card, then removed. Created/tracked a real two-paragraph source; selected-source language guard worked, edit Cancel restored saved title and paragraph breaks. Exact material removed. Scrolled material view exposed UX-18; helper source review found UX-19. |
| 2026-10-26 | Header, localized layouts and helper semantics acceptance | Narrow material scroll/header focus no longer collides with helper toggle. German History reset, setup defaults/review, lesson retry label/guide and review queue inspected. Live Spanish helper chat verified Spanish source-language markup independently of German UI and English explanation. Cleared unsaved draft; owned stop restored preferences with no new failures/records remaining. Reviewing full diff and remaining shell edge cases. |
| 2026-10-26 | Vocabulary generation route and cancellation | Revalidated worktree/process state. Real GPT-6 Luna preview from Vocabulary showed pending controls at 800×600, preserved Vocabulary breadcrumb, revealed meaning/examples, and returned to empty library without saving words. First cancellation lost the race to completed generation and was not counted; a second in-flight cancellation preserved topic and restored editable Generate, then Cancel closed. Library stayed at its observed baseline count. Continued the retained baseline through a tracked retry because historical interrupted actions block no-creation attestation. Removed only the owned previews. A settings-restoration timeout was recovered through resume/restore; final stop had no new failures or remaining records/preferences. Historical interrupted entries preserved. |

**Delivery status:** revamp complete with documented verification limitations. Native zoom acceptance was supplied by the user on 2026-10-27. No further implementation finding remains open after repeated critique; all changes remain local.

### Latest batch closeout

The final resize critique found and fixed UX-20 after the earlier shell checks. A rebuilt live session verified both resize directions, preserved focus/draft, dirty-Writing Keep editing, and Reading/Situation reference layouts at 1440×900 and 800×800. No further concrete defect emerged from that bounded pass. Reviewed the complete local diff, including guard ownership, global vocabulary counts independent of search, locale changes, completion semantics and removed CSS. Builds succeeded through the owned controller; no automated application tests or `make check` were run.

Before the populated Vocabulary follow-up, all revamp-created activities/materials and their dependent history had been removed through exact-owned UI cleanup. Temporary drafts were cleared. Latest stop: exact-owned app exited normally, reservation released, no new cleanup failures and no remaining tracked records/preferences. Three older interrupted-click journal entries remain unresolved; their evidence is preserved. Intermediate shutdown timeouts were recorded and must not be described as a fully clean historical journal. The latest Vocabulary batch left a settings-restoration obligation after a timeout; supported resume + restore cleared it, and the subsequent normal stop reported no remaining records/preferences or new failures.

Current acceptance is substantial but not complete. Native enlarged-text behavior is unverified; standalone Writing corrections lack exact supported record cleanup; populated Vocabulary and its review-history removal have now been inspected and the owned records removed; startup/storage/auth failure states require real conditions, not fabricated failures or modified learner storage; external Voice requires an actual external session; existing course completion/skip/review mutations are not disposable. These are explicit dependencies, not verified passes. The goal remains active.

### In-progress populated Vocabulary batch

A real GPT-6 Luna flashcard deck supplied one explicitly saved word. The bounded controller extension captures a complete vocabulary baseline (maximum 30 words) and proves the new ID through the saved-word link on a tracked deck. Flashcard saves intentionally use learner-owned source metadata, so the initial source-activity assumption was rejected and corrected without changing persistence. Library, details, no-match/reset, recall reveal, self-grading, saved next-review feedback, and completion were inspected at 800×600. Completion personality is observed; three fresh findings above are being addressed.

Cleanup limitation discovered during the real pass: vocabulary-review history cannot be deleted by the existing service. The exact tracked word and its review remain a pending cleanup obligation; deck and source were removed, settings restored, and the owned process stopped. No unknown learner records were touched. Three historical interrupted clicks remain preserved; the attempted exact cleanup also retains its receipt. Do not describe this batch as fully cleaned. No more review records will be created while this dependency remains.

### Populated Vocabulary batch closeout

UX-21 reset focus is verified; UX-22 library singular wording is verified in English and German; UX-23 empty Details/placeholder removal is verified in German. The actual review completion and Nina pose were inspected before the wording fix. German edit cancellation preserved the saved meaning; pausing reflected the correct state. Scope stayed in renderer/locales and bounded verification support; no persistence changes were made.

Latest stop completed normally and released the reservation. Original interface/learning preferences were restored. One paused session-owned vocabulary word and its single review remain retained because history deletion is explicitly unsupported; the word is preserved to retain its evidence link. The failed exact-cleanup receipt remains alongside the three historical interrupted clicks. This is a real remaining cleanup limitation, not a clean pass. The deck and inline source are removed. Do not repeat the unsupported cleanup or create additional graded review records; continue independent UI acceptance.

### Minimum-window and bulk-state follow-up

At 700×500, Home remained usable. A three-paragraph unsaved Writing draft was inspected with the natural page scroll and sticky action footer. Initial concern about covered text was not confirmed as trapped content: Tab brought the whole draft and review options into view, Shift+Tab returned visible focus, and the full draft remained intact. Cleared it without correction/submission. This is a recorded hypothesis resolved by interaction, not another styling change.

On the already-owned word, verified selection controls, minimum-three-word deck restriction, bulk Resume and Pause, recognition-mode preparation, disabled future recall mode, and disabled language switching during review. Returned without grading and restored the word to paused. UX-24 was discovered, fixed and verified afterward. No AI calls or additional learning records created. The exact-owned process was suspended/stopped and reservation released without retrying the known unsupported cleanup; one word/review obligation and four interruption receipts remain, with zero preference obligations.

Final source review reduced the History placeholder fix to the existing Disclosure component’s native hidden attribute, avoiding a whole-renderer reindent. Rebuilt English History confirmed reference-only rows have no empty Details control while substantive reading/grammar rows retain theirs. `git diff --check` reported no whitespace errors. The owned process is stopped and reservation released; the previously recorded cleanup dependency is unchanged.

### Review-history interaction and cleanup resolution

Reconsidered the previous persistence deferral against the actual interaction scope. The missing review-removal action is a learner-facing History inconsistency; the existing transaction can support it with a bounded row-only case, preserving the word, grade and schedule. Added the existing quiet ConfirmDialog for vocabulary reviews and precise localized consequences. No schema, scheduling, provider or infrastructure changes. The earlier blanket backend deferral was too broad for this necessary interaction fix.

Real verification: English confirmation and Cancel preserved the owned review; German confirmation fitted 700×500; confirmed removal detached the exact owned row. Vocabulary detail readback retained paused status, stage 2, due date and last-review grade. Exact-owned cleanup then removed the word. Final stop restored English, exited normally and released the reservation: no failures, remaining records or preference obligations. The interrupted exact-cleanup receipt reconciled through absence readback; only the three pre-existing interrupted clicks remain unresolved. This supersedes the earlier pending-word/review closeouts above.

### Completion wording and full cleanup acceptance

Generated one real three-card deck with GPT-6 Luna/runtime-default effort and saved/tracked one word against an empty vocabulary baseline. Selected recognition mode, revealed, graded and completed the review. At 700×500, “1 word reviewed.”, Nina’s small celebration pose and both next actions were visible. Full controller cleanup removed the exact review History row, word, deck and inline source. Final stop: no failures, remaining records or preferences; normal exit and released reservation. Only the three historical interrupted clicks remain.

Standalone Writing dependency was rechecked against current source: its renderer consumes the validated correction candidate, while persistence creates an attempt, correction, vocabulary candidates and potentially merges mistake occurrences into existing learner categories. The current UI ownership path cannot prove and restore that entire result set. Do not treat one history-row deletion as full cleanup or generate a correction until those dependent effects are owned. This is a more specific boundary than the now-resolved review-row case.

### Setup validation and acceptance audit

Clearing the setup goal showed required feedback and disabled Next; Return to Settings preserved the saved goal. Source inspection identified missing accessible hint/error associations. Reused TextAreaField, then verified whitespace invalidity through a live aria-invalid/aria-describedby selector, readable English/German layouts at 700×500, and valid-input recovery. Restored the original goal/interface language. Stop completed with no failures or remaining records/preferences; historical three-click uncertainty is unchanged.

The audit does not yet prove full completion. Known P1 task-space/resize/language-loss findings are fixed and verified. Shared compositions, personality in actual completions, superseded CSS removal, locale updates, keyboard/narrow/reduced-motion checks and local-only delivery have evidence. Active Reading remains a reachable coverage gap and must be exercised rather than deferred merely because its pre-start view was inspected. Native enlarged text, first-use consent without resetting consent, unavailable-root/auth recovery without fabricating failures, external Voice returns, and owned course/standalone-writing effects remain specific dependencies. Candidate/paged vocabulary states lack suitable existing data; mass-creating learner records solely to populate them is not an acceptable fixture substitute.

### Active Reading discovery batch

Generated/tracked a real six-question Reading activity and its inline source. Wide 1440×900 reference/task columns were readable; answered the opening multiple choice correctly, then exercised short answer and vocabulary recognition at 700×500. Collapsed Reference to access the task. Found UX-26–28 above. Suspended the exact-owned session with the activity/source tracked and resumed after the shared fixes; the attempt is at question four and remains an explicit cleanup obligation until the coherent batch finishes.


### Reading focus acceptance and review context

Finished the owned six-question Reading activity with saved feedback. Closed Reference now points right. At 700×500, focused blanks and the long final summary remain fully above the footer; 1440×900 and return to narrow preserve the answer. Free Writing’s multi-paragraph temporary draft also remained visible above its footer, then was cleared without submission. Completion review exposed UX-29: the passage was absent. Reused the existing reference inside answer review; rebuilt acceptance remains next.

Stop proved exact-owned process exit but restoration timed out: the owned Reading activity/source and AI preference obligations remain journaled. Resume and exact cleanup are required. The three historical interrupted clicks remain unchanged.

The Reading activity/history and source cleanup succeeded after resume. UX-26 neutral pending label was read back during the next real three-question Reading generation. That pass exposed UX-30, a redundant nested options disclosure; fix after current completion acceptance.

### Reading review context acceptance

The second real Reading activity completed with three answers and saved feedback. At 1440×900, expanded answer review includes the original titled passage followed by questions and submitted answers. At 700×500 the same passage remains readable; Reference supports Space to close/reopen. UX-29 is verified. UX-30 remains the next focused source batch. Exact cleanup of this second activity/source is in progress.

Reading cleanup completed: no remaining records/preferences or new failures, normal owned exit and reservation release. Three historical interrupted clicks and shutdown-history notes remain preserved. Removed the redundant Reading options wrapper in PracticePage; ReadingPractice continues to own its disclosure. No new fields, styles or copy.

### Reading options closeout and repeated critique

One click now exposes Level and Questions. Selected three questions, switched to Quiz and back, then confirmed the choice and open state remained. At 700×500 keyboard Tab from Level reaches the selected count with visible focus; screenshot shows readable fields and actions within the single disclosure. No additional defect found in this bounded critique. Latest owned stop: normal exit, reservation released, no failures or remaining records/preferences. Historical three-click receipts and shutdown notes are preserved. No automated tests or make check ran.

Remaining audit: localized regression of the latest Reading/reference changes, native enlarged-text acceptance, and the explicit state dependencies inventoried above. Keep those distinct from the newly completed English Reading coverage. All changes remain local.


### Localized Reading and no-resume Home acceptance

German Reading setup at 700×500 exposes Level/Questions through one disclosure; long custom-count/example labels fit. Existing Reading was opened only to pre-start: Material collapses with Space and displays the right-pointing closed chevron, with the start action reachable. No existing attempt was started. Controlled Ctrl+= still produces an identical screenshot; native zoom remains unverified and a user observation has been requested, not assumed.

Spanish Home has a real resume activity; Portuguese Home has none. The latter at 700×500 leads with the quick-practice composer. Customize carries the entered topic to Practice; returning preserves Home's separate draft. Both temporary drafts were cleared. Final stop restored German learning language and English interface, reported no failures/records/preferences, and released the reservation after normal exit. Three historical interrupted clicks and prior shutdown notes remain.

Source audit correction: PlacementDiagnostic is declared but has no import/caller anywhere in the renderer. Its states are dormant, not a reachable product route. Do not invent an entry point or mutate placement data for this revamp. This supersedes the initial generic placement-coverage assumption.

### Completion audit against the stated criteria

| Requirement | Current evidence and disposition |
| --- | --- |
| Every meaningful desktop state has evidence or a specific dependency | Route/state inventory, live work log and findings cover the reachable healthy-data flows. Home no-resume and active Reading gaps are now closed. Startup/auth failures, first-use consent, external Voice, course mutations, standalone correction variants and data-dependent candidate/paging states retain explicit dependencies; none is counted as a live pass. Dormant placement is excluded by caller evidence. |
| No known P1 defect; recurring P2 findings resolved | UX-01/14/20/28 task-space and draft protection have live evidence; UX-01 enlarged-text acceptance is closed by the user’s 2026-10-27 confirmation at 200% zoom. All concrete P2 findings through UX-30 have implemented/verified outcomes or explicit intentional dispositions. |
| Shared patterns and intentional differences | Current diff reuses Card, Section, ActivityFrame/Completion, TextAreaField, ActionGroup and existing dialogs. Form/collection/activity widths remain intentional. Button default and gallery decisions are recorded rather than creating redundant APIs or surfaces. |
| Nina personality in real learning moments | Real flashcard, quiz, Reading and vocabulary completions demonstrate restrained shared poses; lesson-guide language typography and focused feedback remain useful in dense screens. |
| Long-content/localization/keyboard/narrow/reduced motion | Recorded real checks across four interface languages, narrow/minimum windows, keyboard focus, long text and reduced motion. Latest Reading setup/reference has EN/DE evidence. Native zoom and reachability at 200% are user-verified on 2026-10-27; no screenshot resizing is substituted for that evidence. Shared browser/token packages are unchanged, so no new website/mobile consumer impact. |
| Learner-data/draft/navigation safety | Owned records were removed through exact UI ownership; settings restored; real draft/resize/navigation checks passed. Three pre-existing interrupted clicks remain uncertainty, not revamp-created cleanup obligations. No claim of a clean historical journal. |
| Remove superseded CSS and keep guidance/plan accurate | Replaced local surface recipes removed; durable shared composition/verification guidance lives in the two owning skills. Current diff reviewed and whitespace check passes. Living plan records superseded historical closeouts chronologically and current closeouts explicitly. |
| Final report and completion | Achieved with the user-verified 200% zoom acceptance on 2026-10-27. Specific unexercised state dependencies and historical journal limitations remain disclosed, as allowed by the first completion criterion. Local-only delivery, no automated application tests or make check, and no CI/deployment changes remain intact. |


### Native input feasibility check

Investigated the remaining zoom dependency rather than repeating controller presses. The environment exposes X11/XTest under Wayland. Matched the visible Call Nina window PID to the current owned process identity/start ticks, focused that exact window, sent a bounded native Ctrl+= event and released both keys. The 1440×900 screenshot still showed ordinary-size controls/text; this does not prove enlarged-text behavior. No input helper or saved journey was added to the repository. The requested manual zoom observation remains pending. Owned stop completed normally with no new failures, records or preferences; historical receipts remain unchanged.

The remaining native-zoom condition is now revalidated through both available controlled input paths. Do not keep launching identical sessions or mark this criterion passed without actual enlargement evidence. No new independent defect emerged from the completed source/coverage audit.


### Blocked acceptance closeout

The same enlarged-text evidence gap persisted through localized acceptance, native-input feasibility, and the final revalidation turn. No manual result has arrived. Both available input paths failed to produce observable enlargement; process state confirms dev/prd/verify stopped. The independent audit found no remaining concrete implementation finding, and repeating unchanged launches would not establish acceptance. Goal is blocked, not complete, pending actual native zoom behavior/observation. Resume with that evidence or a working native input environment. All local improvements remain reviewable; no commits, pushes, deployments or CI changes were made. Other unexercised state dependencies above remain explicitly unverified.


### Final closeout — 2026-10-27

The user confirmed that Ctrl+plus/minus zoom works and that Writing’s text field, footer actions and helper toggle remain reachable at 200% zoom. This closes the final blocking acceptance gap with user-supplied evidence; the unsuccessful controlled-input observations above remain accurately recorded. The user then requested completion.

Final audit: all concrete findings through UX-30 and DS-06 have verified fixes or recorded intentional dispositions. Repeated review included live narrow/wide states, four interface locales, keyboard/focus, preserved drafts, reduced motion, actual learning completions and the latest Reading/Home follow-ups. No additional concrete implementation defect emerged. Shared compositions and personality decisions live in the existing components and owning skills; superseded local styling was removed. Final worktree/branch review found the expected local change set, and git diff --check passed. No automated application tests or make check were run.

Remaining verification limitations are specific, not claimed passes: first-use consent and startup/storage/auth failures require actual conditions; external Voice needs a real external session; course outcomes and standalone Writing corrections lack exact supported restoration of all learning effects; vocabulary candidate/paged states lack suitable data. Dormant placement code has no renderer route. These limitations satisfy the plan’s explicit dependency-reporting provision and do not leave a known UI defect unresolved.

Cleanup/status readback: no owned records, AI preferences or learning preferences remain; no Manual reservation exists; verification is stopped. Three pre-existing interrupted-click receipts and historical shutdown notes remain preserved. The user’s development app is now running and was left untouched. All changes remain local and uncommitted; no pushes, deployment or CI changes. The revamp is complete with the limitations above.
