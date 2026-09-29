# Call Nina

Call Nina is a local-first desktop application for learning German with Codex. It includes a self-paced learning path, writing correction, reading and grammar practice, vocabulary review, and optional Codex Voice handoffs. Learner records stay in a selected local SQLite data folder. AI actions send only the context needed for the requested activity.

## Install from a clone

Targets: **Linux x64, macOS x64/ARM64, Windows x64**. Builds are native to the current machine; there are no signed downloads or automatic background updates. macOS and Windows require native-host verification before being considered verified releases.

Install Git and clone this repository, then run from the clone:

| System  | Command                                                                           | Prerequisites                                                                                |
| ------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Linux   | `sh install/install.sh install`                                                   | Git, curl, tar, SHA-256 tool, xdg-utils, a graphical session and Electron's system libraries |
| macOS   | `sh install/install.sh install`                                                   | Git (Command Line Tools), curl, tar, shasum                                                  |
| Windows | `powershell -NoProfile -ExecutionPolicy Bypass -File install/install.ps1 install` | Git, Windows PowerShell, tar, Windows x64                                                    |

The PowerShell execution-policy option applies only to this process. No system policy changes or administrator privileges are required. Review scripts before running downloaded source.

The installer accepts **Node >=26.5.0 <27** and **pnpm >=11.0.9 <12**. It reuses compatible tools or downloads the recommended versions recorded in `.node-version` and `toolchain.json` into user-local storage, verifies archive checksums, installs dependencies using the frozen lockfile, and builds the app and MCP helper. Network access is needed for tool and dependency downloads. The initial build can take several minutes.

App locations:

- Linux: `${XDG_DATA_HOME:-~/.local/share}/call-nina/app`
- macOS: `~/Applications/Call Nina.app`
- Windows: `%LOCALAPPDATA%\Programs\Call Nina`

Linux and Windows receive a launcher; macOS uses the app bundle. Each installation registers `call-nina://` activity links. Linux AppImage packaging remains available with `make package-appimage`; `make package-local` builds an unpacked app without installing it. Both paths build a self-contained MCP helper and inspect package-size budgets before succeeding.

These are unsigned local builds. macOS or Windows may display an unsigned/unrecognized application prompt. Review the build source and use the OS's per-app opening controls; do not disable system security globally.

## First use and Codex

Select a data folder, then follow **Codex connection → level and goal → teaching and languages → review**. A compatible ChatGPT/Codex desktop runtime and a signed-in account are required to finish first-time setup. Installation itself does not require Codex, and the other setup steps remain editable while connecting.

Call Nina discovers the desktop-bundled runtime. If your desktop installation has a different layout, pass `--codex-executable=/absolute/executable` when launching. It must support App Server; a standalone CLI is not silently substituted. See the [official desktop app documentation](https://learn.chatgpt.com/docs/app) and [App Server documentation](https://learn.chatgpt.com/docs/app-server).

The optional Call Nina plugin can be installed or refreshed after sign-in during setup, or later in Settings. Start a new Codex task after installing it. The installer never installs the plugin automatically. **Run setup again** in Settings opens the same flow, prefilled with saved choices. Saved steps survive interruption. Repeated setup can be left at any time; later sign-out shows reconnect guidance without resetting completed onboarding.

Development and installed builds keep separate app configuration. To reuse existing learning records in an installed build, select the existing learner data folder; it is opened in place, without copying or resetting it.

Interface language and explanation language are independent. Model selection and detailed correction preferences stay in Settings. The existing disclosure appears before the first AI action.

Call Nina does not record or play audio. It prepares listening/speaking activities; **Open in Codex** puts the activity reference into a new task's composer. The learner sends the message and starts Voice where available. No message or audio session starts automatically.

## Update, inspect, and remove

Use the same entry point with another command:

```sh
sh install/install.sh status
sh install/install.sh update
sh install/install.sh uninstall
```

On Windows, replace the final `install` argument in the PowerShell command with `status`, `update`, or `uninstall`.

`status` reports the source checkout, revision, tool versions, running state, and whether installed files still match their inventory. `update` requires a clean checkout with a configured upstream and uses a fast-forward-only pull. It builds before replacing the app and refuses replacement while the app is running. A failed build leaves the previous installation available, although the source checkout may already have advanced. Changed or extra files inside the app directory must be preserved elsewhere before replacement.

Uninstall offers:

1. App and owned launchers only (default), retaining learner data and plugin.
2. Also remove the scoped Call Nina Codex plugin and marketplace.
3. Also remove verified Call Nina learner files from the selected data folder, after displaying the path and requiring `DELETE` confirmation.

Close Call Nina and its active helpers before removal. Plugin removal needs the compatible Codex runtime. Unknown, modified, or unrelated files are retained and reported. Credentials, the source checkout, and user-local installer tools are retained. An invalid/newer data format is never guessed at or recursively deleted.

## Development and verification

```sh
make setup
make doctor
make dev
```

`make setup` installs the full development and interactive-verification toolchain. `make setup-build` installs the filtered dependency closure needed to build an unsigned local application from source; this is the profile used by the installer. Use `make help` for available commands, `make debug` to follow the current run, `make logs-once` for bounded redacted logs, and `make kill` to stop only the repository-owned app. `make prd` builds and starts a production-like app. Windows installers use the shared Node commands directly and do not require GNU Make.

There are **no automated application tests or saved test journeys**. Reserve the dedicated verification worktree through the coordinator first. There, use `make verify-start`, `make verify-inspect`, `make verify-do`, and `make verify-stop` to verify real behavior interactively. AI verification uses GPT-6 Luna at runtime-default effort and restores prior settings. Run `make check` only when static verification is requested or preparing a PR; it contains formatting, lint, and TypeScript checks.

[Architecture](docs/architecture.md) explains process ownership, package dependency direction, trust boundaries, and the packaged resource layout. [AGENTS.md](AGENTS.md) and the concise skills under [.agents/skills](.agents/skills) describe development conventions. Learner-facing skills ship under `plugins/call-nina/skills`; curriculum is product data under `content/curriculum`.

Bug reports are welcome; outside feature contributions are not currently a project priority. Remove private learner data and credentials before sharing diagnostics. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Website development

The minimal React/Vite website lives in `apps/website` and imports the browser CSS from `@call-nina/design-system`. It has no dependency on Electron or desktop services.

After `make setup`, run `make dev-website` and open the local URL printed by Vite. The server runs in the foreground; stop it with Ctrl-C. Use `make build-website` to typecheck and produce static files in `apps/website/dist`, then `make preview-website` to inspect that build locally. Both servers bind to loopback by default; pass Vite options explicitly, for example `make dev-website ARGS="--port 5174"`.

The website participates in `make build` and `make check`; `make clean` removes its generated output. This is a Coming soon foundation for later website work. Hosting, deployment and backend services are not configured by these commands.

## Mobile development

`apps/mobile` is a minimal native screen based on Expo's [blank TypeScript starting approach](https://docs.expo.dev/more/create-expo-app/#--template), using [SDK 57](https://expo.dev/changelog/sdk-57) and React Native 0.86. It consumes the portable `@call-nina/design-system` token export, without browser CSS or desktop services. Expo's [automatic monorepo support](https://docs.expo.dev/guides/monorepos/) handles pnpm's isolated dependencies; no custom Metro resolver or repository-wide hoisting is needed.

After `make setup`, use `make dev-mobile` to start Metro in the foreground and scan the QR code with a compatible SDK 57 Expo Go client. The device and computer must share a reachable local network; stop Metro with Ctrl-C. `make dev-mobile-android` opens an available Android emulator/connected device, and `make dev-mobile-ios` opens the iOS Simulator on macOS. Pass Expo options with `ARGS`, for example `make dev-mobile ARGS="--localhost --port 8082"` for a local simulator. SDK 57 Expo Go availability differs by platform; consult the [current Expo Go instructions](https://expo.dev/go).

`make config-mobile` resolves the Android/iOS app configuration. `make build-mobile` typechecks and exports both native JavaScript/Hermes bundles to `apps/mobile/dist`; it does **not** compile, install or launch a native app. Mobile participates in `make build` and `make check`; `make clean` removes its bundle/type output. Mobile build and development commands compile shared tokens before resolving them. A matching React DOM version is pinned only for Expo tooling's optional peer dependency, so it does not pick up the website's different React version; the native entry imports no browser renderer.

For a local native debug build, use `make run-mobile-android` with Java and the Android SDK/platform tools plus an emulator or USB-debugging device, or `make run-mobile-ios` with macOS, Xcode, CocoaPods and a simulator. See Expo's [local native build prerequisites](https://docs.expo.dev/guides/local-app-development/). Expo generates ignored `android/` and `ios/` projects from `app.json`; keep configuration there instead of editing generated projects. The iOS configuration opts into Expo's [scene support for Xcode 27/iOS 27](https://github.com/expo/fyi/blob/main/ios-scene-lifecycle.md#staying-on-sdk-57-with-xcode-27). Native identifiers are local development defaults, not registered store applications. No signing, cloud build or distribution service is configured.

Native launch still requires interactive verification on an available target. The implementation host is Linux without Android SDK/adb/emulator or an attached target; iOS compilation and simulator verification require a Mac. Successful configuration and bundle export do not establish native rendering or launch behavior.

## Troubleshooting

- **Runtime unavailable:** install/open the supported desktop app, sign in, and retry connection. Use the executable override for a nonstandard installation. Plugin installation is optional and will not fix an incompatible runtime.
- **Dirty checkout or no upstream:** preserve your changes and configure the branch's intended upstream before updating. The installer does not discard changes or choose another branch.
- **App/helper running:** close the identified app and active Call Nina MCP sessions, then retry. No process is killed by the installer.
- **Installation changed:** `status` checks the file inventory. Move extra files out of the app directory; do not remove learner data to repair an installation.
- **Interrupted installer:** an operation lock or `.previous` app may remain. Establish that the original operation has ended, preserve the recorded installation and previous app, and recover before retrying. The installer does not break locks based solely on a PID.
- **Missing Linux libraries:** install the distribution's Electron/Chromium runtime libraries and xdg-utils. The unpacked installer does not require FUSE.
- **Partial cleanup:** inspect reported leftovers. Files without established ownership remain untouched.

Installers use platform-default locations. For manual app verification, use an explicit `--config-dir=/absolute/directory`; standard OS configuration roots remain supported.

## License

Repository-original code and content are [MIT licensed](LICENSE). Third-party dependencies and cited external material retain their own terms; see [licensing and attribution](docs/licensing.md) and [third-party notices](docs/third-party-notices.md).

## Autonomous development

The Product Owner interviews the maintainer, works through scope and tradeoffs, then presents a final epic/task proposal for approval before creating or updating GitHub planning issues. The proposal states whether tasks will remain Backlog or be explicitly approved for Ready. Only agreed Ready issues enter the developer queue. GitHub Issues and Projects own product work; Orca owns worker execution; Git owns source integration. All GitHub operations use the existing authenticated `gh` CLI. Project access is granted through `gh auth refresh --hostname github.com --scopes project`, without personal token configuration.

The coordinator selects independent work and supervises at most three workers, including two isolated writers. It integrates commits, arranges independent local review, fixes findings and merges task PRs into main. The coordinator closes epics only after every native child outcome, required merge and epic acceptance criterion is verified; incomplete epics stay open with remaining criteria. Release publishing is separate. Start the developer coordinator with `make orchestrate`. The optional terminal Product Owner entry point is `make orchestrate ARGS="start --role product-owner"`. Models and reasoning live in `.codex/agents/`; reusable workflows live in `.agents/skills/`; shared review rules live in `AGENTS.md`.

`development.json` visibly configures executable overrides, repository/Project, concurrency and the disabled intake switch. `make github ARGS=help` and `make orchestrate ARGS=help` expose the agent tools. Configure only absolute executable overrides; null means normal discovery. The installer may pass its provisioned pnpm path internally to child processes; users do not configure that environment variable. Standard OS variables and process-ownership metadata remain internal plumbing.

Make exposes common operations; Node scripts implement their details under `scripts/build`, `scripts/dev`, `scripts/agents` and `scripts/diagnostics`. Use explicit options, for example `make logs ARGS="--level debug --scope history --lines 100"`. Application overrides use `--config-dir=/absolute/directory` and `--codex-executable=/absolute/executable`. Interactive verification accepts equivalent explicit flags through `make verify-start ARGS="..."`.

Recurring pickup stays disabled until supervised Orca startup works, the initial baseline is published and Project access is configured. One wake-up checks every 15 minutes, resumes existing work first, and stays quiet without meaningful changes. The worker scheduler is Orca; no second task database is maintained.

### Start a planning or development session

For Product Owner work, open this repository in Codex Desktop and say: `Use $call-nina-product-owner to plan the Vercel setup epic with me.` If the skill is not listed, explicitly ask to read `.agents/skills/call-nina-product-owner/SKILL.md`. Select the model/reasoning from `.codex/agents/product-owner.toml` in the conversation controls (currently Astra/high); invoking a skill does not switch the current model. No Orca session is needed for product planning.

For development, open a terminal in the repository's Orca project and run `make orchestrate`. The launcher loads the role's instructions and model/effort and sends an opening message to resume existing work first and pick approved Ready tasks. The coordinator must load the installed Orca orchestration skill and establish its live Run binding before dispatching workers. It reports when no approved work is actionable or startup is blocked. The launcher itself does not start a background scheduler; recurring intake remains separately disabled until activation prerequisites pass.

Use exactly two levels: epic issues with native sub-issues for deliverable tasks. Before proposing new work, the Product Owner checks existing epics and active child tasks for overlap and recommends reuse where appropriate. Epics are identified by their GitHub issue number, for example `Epic #12 — Vercel setup`; there is no separate epic counter. Do not add a story level or nested task issues. For example, a Vercel setup epic might contain project configuration, preview deployment, secrets provisioning and domain configuration tasks. These are examples, not approved work. Parentage groups work; dependency links determine execution order. Only executable approved tasks enter Ready. Epic closure requires verified child outcomes and epic acceptance, including explicit dispositions for cancelled, duplicate or not-planned children.

Agents capture deferred bugs as deduplicated Backlog issues using the bug template. The coordinator may parallelize fixes within already-approved scope; unrelated discoveries wait for Product Owner triage. Service configuration should be versioned using native configuration, maintained providers or idempotent reconciliation scripts, with secret values kept outside Git. Actual Clerk/Vercel integration is not provisioned by this workflow setup.

### Local verification and paused pipelines

GitHub Actions and automatic Vercel Git deployments are disabled for now. Agents review the exact PR commit locally, run `make check` locally when preparing or updating a PR (manifest versions, Prettier, ESLint and TypeScript), fix findings and record evidence in the PR. Interactive application verification still follows the repository policy. All code reviews are local only. Independent exact-head local review, passing local checks, current task metadata and resolved discussions remain part of the merge workflow; no hosted `static` check is required.

`.github/pipeline-policy.json` records the desired GitHub settings. Run `make pipeline-policy` to inspect the remote diff and `make pipeline-policy ARGS=apply` to reconcile and verify it using the existing authenticated `gh` login. The script disables Actions and removes only required status checks, preserving the other branch protections. `vercel.json` disables automatic Git deployments using [Vercel's supported configuration](https://vercel.com/docs/project-configuration/git-configuration). Re-enabling pipelines requires explicit user authorization and an updated policy.

## Existing learner data

Call Nina can use an existing Open Deutsch learner directory through the normal data-directory selection screen. Select the existing directory explicitly. The on-disk `.open-deutsch-root.json` manifest, `open-deutsch.sqlite3` database and root kind remain stable. The rename does not move, copy or reset learner data. Existing installations and plugins are not silently removed.
