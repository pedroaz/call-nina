# Call Nina

A local-first desktop companion for practising US English, Brazilian Portuguese, Spanish, and German. Practice, vocabulary, materials, and learning history live in a selected local data folder. Learning, interface, and explanation languages are independent; the structured Learning Path is German-only.

The development app includes direct ChatGPT sign-in and personal API-key connections. Cloud AI receives the context needed for the selected activity. Optional Voice handoff uses the separate Codex app and Call Nina plugin. Local onboarding and prepared practice do not require provider sign-in. Managed AI is disabled; the mobile companion includes authenticated flashcard sync, while native mobile release distribution is not configured. Source availability does not establish a verified public release.

## Install from source

Clone this repository, then run the appropriate command from the clone:

| Platform      | Command                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| Linux / macOS | `sh install/install.sh install`                                                   |
| Windows       | `powershell -NoProfile -ExecutionPolicy Bypass -File install/install.ps1 install` |

These are unsigned local builds. You need Git, network access, and the platform's archive tools; Linux also needs a graphical session, Electron system libraries, and xdg-utils. The installer checks prerequisites and uses supported Node/pnpm versions from `package.json` and `toolchain.json`. macOS and Windows still need native-host release verification.

Use the same command with `status`, `update`, or `uninstall` instead of `install`. Update requires a clean checkout with an upstream and a stopped app; uninstall retains learner data by default. Select an existing learner folder explicitly to reuse it in place. Renaming the product does not rename or reset its existing data files.

## Development

Run `make setup`, then `make dev`; use `make help` for commands. Use the [nina-admin skill](.agents/skills/nina-admin/SKILL.md) for hosted account and infrastructure administration; `make verify`, `make package`, `make deploy help`, and `make install` list their subcommands. Release builds and deployments run manually through [GitHub Actions → Release](https://github.com/pedroaz/call-nina/actions/workflows/release.yml). Select `desktop`, `hosting` (website + API), or `all`; `build-only` creates downloads retained for 30 days, and `publish` releases from `main`. Desktop publication requires a version matching the committed workspace manifests and uses `desktop-vX.Y.Z`. Initial desktop assets are unsigned Linux x64 AppImage, Windows x64 ZIP, and macOS Intel/Apple Silicon app archives. Native mobile distribution is deferred. `make release` displays instructions; `make deploy production` also displays instructions without uploading locally. Local development and packaging primitives remain available. CI and native-platform verification must succeed before a build is described as verified. Admin credentials belong in ignored root `.env` (see `.env.example`); edit that file directly rather than passing credentials on the command line. Read [AGENTS.md](AGENTS.md) and the [development skill](.agents/skills/call-nina-development/SKILL.md) for repository work. Skills own technical guidance; source and observed behavior establish implementation status.

Bug reports are welcome. Include the OS, revision, reproduction steps, and bounded redacted diagnostic codes; exclude learner content, credentials, private paths, and databases. Outside feature contributions are not currently a project priority.

## License

New original material uses the [Call Nina Personal Learning Source License 1.0](LICENSE): independent personal self-study is free; professional teaching and organizational use require separate written permission. This is source available, not open source. Previously MIT-licensed material retains its MIT permissions. See [licensing and provenance](docs/licensing.md) and [third-party notices](docs/third-party-notices.md).
