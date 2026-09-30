---
name: call-nina-desktop-ui
description: Implement or review Call Nina Electron renderer UI, including React controls, CSS layout, localized copy, keyboard interaction, accessibility, and visual behavior. Use for desktop interface changes, not curriculum authoring.
---

# Call Nina desktop UI

Inspect the real renderer and current styles before changing a screen. Repository-relative starting points are `apps/desktop/src/renderer/App.tsx`, the affected feature component, `components/ui/`, `components/layout/`, `styles/tokens.css`, `styles/global.css`, and the locale resources under `locales/`. Follow hooks and contracts to establish behavior; no separate design inventory establishes what is implemented.

## Durable design decisions

- Keep a calm, text-forward, warm, light-only desktop style. Preserve the Call Nina identity. Prioritize the learning task over shell controls, explanatory prose and empty panels.
- Use the shared Page header and refresh slot across screens, Tabs for sibling views, and Breadcrumbs for nested activities with their actual parent destination. Refresh data without remounting drafts or active exercises. Keep language switching in the left sidebar and one compact, accessibly labeled helper toggle visible at a time: in the sticky workspace header when closed and inside the helper when open.
- Semantic colors, type, spacing, radii, borders, shadows and motion come from `packages/design-system/src/index.ts`; use `make design-tokens` to regenerate browser CSS. Import its `tokens.css` and local `fonts.css` before desktop `styles/tokens.css`, which owns only desktop metrics and aliases for existing renderer sizing. Use accessible text aliases on brand and state surfaces.
- Use repository-owned controls/layouts, React Aria, CSS Modules, shared tokens, Lucide and i18next/react-i18next. Extend these before introducing alternatives.
- Let page/card/field/action layouts own spacing. Use shared spacing tokens and explicit `gap` on every multi-item flex or grid container; do not rely on adjoining borders, incidental margins, or whitespace in JSX. Give controls inside bordered cards and compound rows a visible internal gutter from the container edge and from sibling controls. Edge-to-edge joins are reserved for intentional structures such as table cells, tab indicators, and disclosure dividers. Check destructive and trailing actions especially, including long translated labels and narrow layouts. Adapt to available workspace width; inspect existing breakpoints in CSS. Never conceal layout defects by clipping overflow. Keep long content and enlarged text reachable.
- Use concise labels and progressive disclosure. Use InfoHint for optional explanations while keeping essential instructions, privacy information and destructive consequences visible. Keep Cancel beside the initiating action or progress.
- Keep every registered interface locale complete, including keys and interpolation placeholders. Interface, learning and explanation languages are independent; use shared language definitions and explicit capabilities. Preserve substantive learning text and learner input on failure.
- Keep provider connection optional in local onboarding. AI entry points name the required operation and explain unavailable access while retaining local input and prepared practice; never imply a provider subscription is a Nina plan.
- Preserve accessible names, roles, keyboard operation, focus restoration, selected/disabled/pending/error states and reduced motion. Icon-only secondary actions need names and tooltips; important actions need text. Meaning cannot depend only on color.
- Keep participation, skipped work and proficiency evidence distinct. Explanations and corrections must remain understandable without exposing internal implementation details.

CSS-module declarations come from `apps/desktop/scripts/generate-css-types.mjs`; inspect the build/dev scripts and regenerate after class changes. Do not weaken TypeScript checks.

Follow the root exploration/refactor deferral policy; intermediate screens need not work or be visually verified after every change. When verification is due, use [interactive Electron verification](../call-nina-electron-verification/SKILL.md) to inspect changed screens in every supported interface locale at standard and narrower widths, including keyboard/focus and relevant states. Generation uses real GPT-6 Luna; local layout checks need no model call. Report observed behavior and unexercised states. No automated UI tests, screenshot suites or stored journeys.
