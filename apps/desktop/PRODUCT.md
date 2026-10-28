# Call Nina Desktop

<!-- impeccable:product-schema 1 -->

## Platform

web

Call Nina Desktop is an Electron application with a React web-based interface. This record covers the desktop app, not the website or mobile app.

## Users

Independent language learners who want self-paced practice, useful corrections, and a persistent local learning record.

## Product Purpose

Help learners practise, understand corrections, revisit useful vocabulary, and return to learning with continuity. Success means learning and returning to practice. Participation is kept distinct from proficiency evidence.

## Positioning

A local-first learning workspace combining reusable learning paths, personal practice, corrections, vocabulary review, and learning history. Optional connected AI supports generation and feedback alongside locally available prepared practice.

## Operating Context

Learners set up local learning data and a language profile, then work through learning paths or choose practice activities. Writing feedback and saved vocabulary support follow-up practice; history preserves earlier work and feedback.

Local setup and supported prepared practice do not require an AI connection. Generation and AI feedback require access to an appropriate connected service. External Voice practice is handled through Codex, with bounded structured results retained in Call Nina.

## Capabilities and Constraints

- Preserve learner content, drafts, saved work, and continuity across practice sessions.
- Keep interface, learning, and explanation language choices independent.
- Keep local learner identity separate from provider accounts and access. A provider subscription does not establish a Nina entitlement.
- Distinguish completed participation, supported practice, and self-reported review from independent proficiency evidence.
- Keep activities self-paced and preserve prepared learning when AI access is unavailable.

Implementation and workflow guidance remains in the repository's [development skill](../../.agents/skills/call-nina-development/SKILL.md), [desktop UI skill](../../.agents/skills/call-nina-desktop-ui/SKILL.md), and applicable AGENTS.md files. Current source and runtime observations establish implemented behavior.

## Brand Commitments

The product name is Call Nina. Existing brand assets and UI commitments are maintained by the desktop UI skill and shared design-system package. This product record does not establish a new visual direction.

## Evidence on Hand

- Desktop workflows and interface copy: `src/renderer/`, including `App.tsx` and `locales/`.
- Reusable learning content: `../../content/curriculum/`.
- Shared brand assets: `../../packages/design-system/`.

These sources establish product content and implementation, not measured learning outcomes. No testimonials, efficacy benchmarks, or certification claims are established by these sources.

## Product Principles

1. Support a learner's own pace and return to practice.
2. Make corrections useful for subsequent learning.
3. Preserve a durable local learning record.
4. Keep prepared practice available independently of AI connection setup.
5. Describe learning evidence honestly without equating activity with proficiency.

## Accessibility & Inclusion

Preserve keyboard operation, accessible control names, visible focus, reduced-motion support, and meaning that does not depend on color alone. Keep learning text and enlarged content reachable. Maintain the registered interface translations and independent language choices, following the desktop UI skill.
