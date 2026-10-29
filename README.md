# Call Nina

A local-first desktop companion for practising US English, Brazilian Portuguese, Spanish, and German. Practice, vocabulary, materials, and learning history live in a selected local data folder. Learning, interface, and explanation languages are independent. The Learning Path includes German foundations and everyday scenarios in all four languages.

The desktop app includes direct ChatGPT sign-in and personal API-key connections. Cloud AI receives the context needed for the selected activity. Optional Voice handoff uses the separate Codex app and Call Nina plugin. Local onboarding and prepared practice do not require provider sign-in. Optional managed AI requires an admin-assigned Nina Plus account with an available service allowance. The mobile companion includes authenticated flashcard sync; native mobile release distribution is not configured. The source is open under the MIT License; release verification is described below.

## Install from source

Clone this repository, then run the appropriate command from the clone:

| Platform      | Command                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| Linux / macOS | `sh install/install.sh install`                                                   |
| Windows       | `powershell -NoProfile -ExecutionPolicy Bypass -File install/install.ps1 install` |

These are unsigned local builds. You need Git, network access, and the platform's archive tools; Linux also needs a graphical session, Electron system libraries, and xdg-utils. The installer checks prerequisites and uses supported Node/pnpm versions from `package.json` and `toolchain.json`. macOS and Windows still need native-host release verification.

Use the same command with `status`, `update`, or `uninstall` instead of `install`. Update requires a clean checkout with an upstream and a stopped app; uninstall retains learner data by default. Select an existing learner folder explicitly to reuse it in place. Renaming the product does not rename or reset its existing data files.

## Development

Install the supported Node and pnpm versions from `package.json` and `toolchain.json`, plus Make. Run `make setup`, then `make dev`; use `make help` for commands.

| Location                                 | Purpose                                                      |
| ---------------------------------------- | ------------------------------------------------------------ |
| `apps/desktop/`                          | Electron and React desktop app                               |
| `apps/mobile/`                           | Expo flashcard companion                                     |
| `apps/website/`, `apps/api/`             | Website and hosted account, generation, and sync endpoints   |
| `apps/mcp-server/`, `plugins/call-nina/` | Local MCP server and Codex learner plugin                    |
| `packages/`                              | Shared contracts, learning logic, storage, providers, and UI |
| `content/curriculum/`                    | Authored lessons and source inventory                        |
| `install/`, `scripts/`                   | Source installers, development commands, and release tooling |
| `.agents/skills/`                        | Maintainer and agent development guidance                    |
| `docs/`                                  | Licensing and third-party notices                            |

Read [AGENTS.md](AGENTS.md) and the [development skill](.agents/skills/call-nina-development/SKILL.md) before changing the repository. Use `make check` for static verification when preparing a pull request. Application behavior is verified interactively; the repository does not use automated application test suites.

Hosted administration is optional for local desktop development. Its credentials belong in ignored root `.env` (see [.env.example](.env.example)); follow the [nina-admin skill](.agents/skills/nina-admin/SKILL.md) for account and infrastructure operations.

## Builds and releases

Release builds use the manually dispatched [Build workflow](https://github.com/pedroaz/call-nina/actions/workflows/build.yml). The separate [Publish workflow](https://github.com/pedroaz/call-nina/actions/workflows/publish.yml) promotes a successful complete build from `main`, including desktop and combined website/API artifacts. `make release` displays instructions. Build artifacts are retained for 30 days; desktop publication creates `desktop-vX.Y.Z` from the committed workspace version.

Desktop artifacts are unsigned Linux x64 AppImage, Windows x64 ZIP, and macOS Intel/Apple Silicon app archives. Native mobile distribution is not configured. Successful CI builds and native-platform checks are required before describing artifacts as verified. Pushes and pull requests do not publish releases, and automatic Vercel Git deployments are disabled. See the [release delivery policy](.agents/skills/call-nina-development/SKILL.md#release-delivery-policy) for details.

## Reporting problems and contributing

[Report a bug](https://github.com/pedroaz/call-nina/issues/new?template=bug.yml) with your OS, revision, reproduction steps, and expected and actual behavior. Exclude learner content, credentials, private paths, and databases from reports and attachments.

This is maintained as a solo project. Outside feature contributions are not currently a priority; discuss substantial changes in an issue before preparing a pull request. See the license below for permitted uses and modifications.

## License and enterprise services

Call Nina's original code, documentation, curriculum, and artwork are available under the [MIT License](LICENSE), to the extent the maintainer holds the relevant rights. Commercial use, modification, redistribution, and independent hosting are permitted. Third-party components retain their own licenses; see [licensing and provenance](docs/licensing.md) and [third-party notices](docs/third-party-notices.md).

The software license does not provide access to hosted infrastructure or an AI allowance. Users can create Free Nina accounts. Administrators assign Nina Plus and grant AI actions and audio allowances separately. Independent deployment currently requires adapting the repository's maintainer-specific configuration; turnkey self-hosting is not provided.

For optional paid enterprise setup, customization, and support, contact [Pedro Azevedo Minutetnag](mailto:pedro.azvm@gmail.com). These services are optional; commercial use of the MIT-licensed software does not require purchasing them.
