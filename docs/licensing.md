# Call Nina licensing and attribution

## License and scope

Call Nina's original software, documentation, teaching content, and artwork are offered under the [MIT License](../LICENSE), to the extent the maintainer holds the relevant copyright. MIT permits personal, commercial, institutional, and hosted use, modification, and redistribution, subject to retaining its copyright and permission notices. It does not require publishing modifications or purchasing a separate commercial license.

The root license preserves the notices for Pedro Azevedo Minutetnag, Call Nina contributors, and Open Deutsch contributors. Material previously distributed under MIT retains those permissions. The repository at [`6d83af64512bb0853b007a89f9f71b16f16d5143`](https://github.com/pedroaz/call-nina/tree/6d83af64512bb0853b007a89f9f71b16f16d5143) and its ancestors remain MIT-licensed; this adoption does not revoke any previously granted rights.

Third-party software, fonts, and attributed external material retain their own terms. Citations are not blanket reproduction permissions. Learner records, imported private material, and generated learner output are not relicensed by the repository. No exclusive copyright in unprotectable AI-generated elements, trademark registration, or endorsement of modified distributions is asserted.

## Hosted access and optional services

The software license grants no access to the maintainer's Vercel, Clerk, database, or AI accounts. Hosted Nina access requires a separately provisioned account and available service allowances. Provider charges and terms remain separate.

Optional paid enterprise setup, customization, and support are available by contacting [Pedro Azevedo Minutetnag](mailto:pedro.azvm@gmail.com). These services are not a condition of commercial use or independent hosting under MIT. The repository currently targets maintainer-operated infrastructure; a turnkey independent deployment workflow is not provided.

## Provenance and contributions

The maintainer stated that he created the original project with AI assistance and no outside contributors in [issue 15](https://github.com/pedroaz/call-nina/issues/15). Git history is consistent with that account but does not prove ownership of every element. The root import [`0dba0e1138c075515fd3b8f46002b599ebd19ece`](https://github.com/pedroaz/call-nina/commit/0dba0e1138c075515fd3b8f46002b599ebd19ece) includes an MIT license naming Call Nina contributors; [`9fcdf1c321d119f067b94bd53c08132d1fe56103`](https://github.com/pedroaz/call-nina/commit/9fcdf1c321d119f067b94bd53c08132d1fe56103) preserves the Open Deutsch attribution. Both notices remain. This is a bounded provenance record, not a complete rights clearance.

Contributors retain ownership. Contributions intended for inclusion must be offered under MIT and identify any third-party material and its terms. No copyright assignment or additional commercial relicensing grant is required. Do not submit material you cannot license.

## Dependencies, teaching sources and packaging

The shared design package bundles unmodified Fredoka, Figtree, JetBrains Mono and Noto Sans Mono variable font binaries from the [Google Fonts source repository](https://github.com/google/fonts/tree/9710da1eacb3be272583c3224dcb70f9da6eadbb/ofl). Each is distributed under SIL Open Font License 1.1; its full `OFL-*.txt` license accompanies the binary in `packages/design-system/assets/fonts/`. The four inspected OFL headers declare no Reserved Font Names. Noto Sans Mono supplies IPA glyphs absent from JetBrains Mono. Brand artwork is maintained in `packages/design-system/assets/brand/`; desktop application icons are maintained in `apps/desktop/assets/`.

The desktop workbook typography also bundles unmodified [Source Sans 3](https://github.com/google/fonts/tree/main/ofl/sourcesans3) and [Source Serif 4](https://github.com/google/fonts/tree/main/ofl/sourceserif4) variable fonts from Google Fonts, under SIL Open Font License 1.1. Their accompanying `OFL-SourceSans3.txt` and `OFL-SourceSerif4.txt` notices are included in the shared font inventory and packaged notices.


The native app bundles these **modified static derivatives** of those pinned variable binaries. They were generated with FontTools 4.60.1 `fontTools.varLib.instancer.instantiateVariableFont`, fixing every axis (including non-weight axes at the source default). SHA-256 identifies each source and resulting file:

| Source variable font SHA-256 | Native static derivative SHA-256 | Fixed axes |
| --- | --- | --- |
| Fredoka `2ba02e68b152868aef9ba28e24b3648c7d457fe6f25c761f2c2c53fb61a73fc8` | `Fredoka-700.ttf` `810d2c684bf5dd9ba8d104095696f83024791674625e679b5a519b51cebcd080` | `wght=700`, `wdth=100` (default) |
| Figtree `26ad3db9b31ff7dde67a91ff515d022d2f495cd506590699cf264f0bfe6fb714` | `Figtree-400.ttf` `a059b3c948f1f87b65fb708f0e40401896866a805b74c12c0fc2fbb00d36089e` | `wght=400` |
| Figtree `26ad3db9b31ff7dde67a91ff515d022d2f495cd506590699cf264f0bfe6fb714` | `Figtree-700.ttf` `ba9c813a463b11ba2b941c163e654d7d7f9ff86799b7cae217456bb80a52cb52` | `wght=700` |
| JetBrains Mono `48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda` | `JetBrainsMono-400.ttf` `055b6ae4449b5274591c1aa5aacbc8dee4b1c8b87a8bd9fbb7dee485ab337c2d` | `wght=400` (default) |
| Noto Sans Mono `2cb2adb378a8f574213e23df697050b83c54c27df465a2015552740b2769a081` | `NotoSansMono-400.ttf` `a860d73c8eb7162ac1beb3da33a5183f3880aa9327b56f055048fc50a6c80fe7` | `wght=400` (default), `wdth=100` (default) |

The original variable binaries and complete OFL notices remain alongside the derivatives. `make generate design-tokens` generates `font-notices.json` directly from the bundled font notice files, and the mobile Font licenses disclosure presents their complete text. The design package build checks the generated notice against its sources.

The generated runtime inventory records the installed package versions and their declared licenses. Those declarations are evidence from package metadata, not a full transitive source audit or a substitute for required license texts. The generator retains the dependency inventory and curriculum attribution and links to this authored policy; regenerating notices does not author or overwrite licensing policy. No dependency or source attribution was removed by adoption.

The desktop packager already copies the complete root `LICENSE` and the authored/generated notices into its notices directory, so the MIT grant and preserved copyright notices travel with the application. This inspection covers the existing desktop/MCP inventory; it does not claim that inventory is a complete mobile SDK, website, build-tool or externally installed Codex notice inventory. A new source license does not replace any distributor's obligation to carry the licenses/notices for the components they actually distribute.

Bundled JavaScript and native-runtime-adjacent dependencies retain their own licenses. The generated [third-party notice inventory](third-party-notices.md) records the package versions installed from the pinned pnpm lockfile and links to upstream metadata where available. The application uses Node's built-in SQLite driver and does not bundle a third-party SQLite addon.

The separately bundled standalone Codex runtime has an additional [distribution notice inventory](codex-runtime-notices/README.md), preserved upstream licenses and a pinned source archive. Its build-time staging preserves those notices beside the native binaries. That inventory states its bounded inspection and the remaining target-specific redistribution review required before a public binary release; the pnpm inventory does not cover Codex's Rust/native dependency graph.

The read-only curriculum snapshot contains repository-original teaching material plus source-attributed public references. Source IDs, titles, URLs, retrieval dates, freshness class, and review dates are in [`content/curriculum/sources.yaml`](../content/curriculum/sources.yaml). Current public references include the [Council of Europe CEFR Companion Volume](https://www.coe.int/en/web/common-european-framework-reference-languages/cefr-companion-volume-and-its-language-versions), [Bundesportal](https://verwaltung.bund.de/leistungsverzeichnis/DE/leistung/99115005104001/herausgeber/HH-S1000020010000000079/region/020000000000), and [Bundesmeldegesetz §17](https://www.gesetze-im-internet.de/bmg/__17.html).

Curriculum and researched content are educational aids. They are not formal CEFR certification, legal advice, immigration advice, or an official public-service determination. Time-sensitive public-service and legal references must be reviewed before reuse, and regional requirements may differ.

The A1.1/A1.2 course in `content/curriculum/courses/de/foundations.json` contains original Call Nina explanations, examples and listening scripts. Its embedded Council of Europe and Goethe-Institut citations support level and topic scope. The local sequence does not imply institutional approval; no third-party exam exercises or audio are reproduced.
