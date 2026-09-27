# Call Nina third-party notices

This inventory covers the 36 package versions bundled into, or providing the Electron runtime for, the local application from the pinned pnpm lockfile. Build-only quality and packaging tools are excluded. Each dependency remains under its own license; consult the package metadata and upstream repository for the complete license text. This file is regenerated with `pnpm run generate:third-party-notices`.

## Application and assets

- Call Nina application code, original teaching content, and the `call-nina` N mark are maintained by Call Nina contributors and distributed under the repository MIT license.
- The curriculum snapshot is original or source-attributed content. Authoritative source links and freshness fields are maintained in `content/curriculum/sources.yaml`.
- Researched curriculum is educational material, not formal CEFR certification, legal advice, immigration advice, or an official public-service determination.
- Curriculum attribution: [Council of Europe CEFR Companion Volume](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-companion-volume-and-its-language-versions), [Bundesportal](https://verwaltung.bund.de/leistungsverzeichnis/DE/leistung/99115005104001/herausgeber/HH-S1000020010000000079/region/020000000000), and [Bundesmeldegesetz §17](https://www.gesetze-im-internet.de/bmg/__17.html), as listed in the source registry.

## Installed package inventory

| Package | Version | Declared license | Homepage |
| --- | --- | --- | --- |
| `@babel/runtime` | `7.29.7` | MIT | [upstream](https://babel.dev/docs/en/next/babel-runtime) |
| `@electron-internal/extract-zip` | `1.0.5` | BSD-2-Clause | — |
| `@electron/get` | `5.1.0` | MIT | — |
| `@internationalized/date` | `3.12.3` | Apache-2.0 | — |
| `@internationalized/number` | `3.6.7` | Apache-2.0 | — |
| `@internationalized/string` | `3.2.10` | Apache-2.0 | — |
| `@modelcontextprotocol/core` | `2.0.0` | MIT | [upstream](https://modelcontextprotocol.io) |
| `@modelcontextprotocol/server` | `2.0.0` | MIT | [upstream](https://modelcontextprotocol.io) |
| `@react-types/shared` | `3.36.1` | Apache-2.0 | — |
| `@swc/helpers` | `0.5.23` | Apache-2.0 | [upstream](https://swc.rs) |
| `aria-hidden` | `1.2.6` | MIT | [upstream](https://github.com/theKashey/aria-hidden#readme) |
| `client-only` | `0.0.1` | MIT | [upstream](https://reactjs.org/) |
| `clsx` | `2.1.1` | MIT | — |
| `debug` | `4.4.3` | MIT | — |
| `electron` | `42.7.1` | MIT | — |
| `env-paths` | `3.0.0` | MIT | — |
| `graceful-fs` | `4.2.11` | ISC | — |
| `html-parse-stringify` | `4.0.1` | MIT | [upstream](https://github.com/i18next/html-parse-stringify) |
| `i18next` | `26.3.6` | MIT | [upstream](https://www.i18next.com) |
| `lucide-react` | `1.33.0` | ISC | [upstream](https://lucide.dev) |
| `ms` | `2.1.3` | MIT | — |
| `progress` | `2.0.3` | MIT | — |
| `react-aria-components` | `1.20.0` | Apache-2.0 | — |
| `react-aria` | `3.51.0` | Apache-2.0 | — |
| `react-dom` | `19.2.8` | MIT | [upstream](https://react.dev/) |
| `react-i18next` | `17.0.11` | MIT | [upstream](https://github.com/i18next/react-i18next) |
| `react-stately` | `3.49.0` | Apache-2.0 | — |
| `react` | `19.2.8` | MIT | [upstream](https://react.dev/) |
| `scheduler` | `0.27.0` | MIT | [upstream](https://react.dev/) |
| `semver` | `7.8.5` | ISC | — |
| `sumchecker` | `3.0.1` | Apache-2.0 | [upstream](https://github.com/malept/sumchecker#readme) |
| `tslib` | `2.8.1` | 0BSD | [upstream](https://www.typescriptlang.org/) |
| `undici` | `7.29.0` | MIT | [upstream](https://undici.nodejs.org) |
| `use-sync-external-store` | `1.6.0` | MIT | — |
| `yaml` | `2.9.0` | ISC | [upstream](https://eemeli.org/yaml/) |
| `zod` | `4.4.3` | MIT | [upstream](https://zod.dev) |

## Release boundary

The Linux AppImage includes this notice, the Call Nina licensing note, and the immutable curriculum/plugin/helper snapshot. It does not include learner data, credentials, or a Codex account. A compatible external Codex installation remains a prerequisite for AI actions.
