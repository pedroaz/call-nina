# Curriculum

`learning-path.json` is the canonical 12-unit A1 course: six units each in A1.1 and A1.2, with bilingual explanations, examples, vocabulary, four skill objectives and learning tasks. The split and sequence are Call Nina teaching choices, not official CEFR subdivisions or certification. Explanations, examples and listening scripts are original Call Nina material; source citations support level and topic scope, not external approval. No third-party exercises or recordings are reproduced.

`manifest.yaml` maps the A1–B2 topic inventory, `sources.yaml` records topic provenance, and `topics/<band>/<slug>.md` holds topic foundations or intended scope. Available lessons are determined from actual course links and topic lesson foundations, not publication statuses. A2–B2 remain scope entries without a course. Coverage does not establish learner proficiency.

Author directly here and check language, level, prerequisites, translations, citations and schema consistency as part of authoring. Runtime contracts live in `packages/domain/src/curriculum.ts` and `packages/contracts/src/learning-path.ts`; course loading lives in `packages/persistence/src/learning-path.ts`. There is no curriculum approval queue or promotion operation.

Development loads this directory. Packaged desktop and MCP builds copy it as an immutable curriculum resource; updates require a new build. Learner data and private working material never belong here.
