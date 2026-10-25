.DEFAULT_GOAL := help

# Pass advanced options explicitly, for example: make logs ARGS="--level debug".
ARGS ?=
EMULATOR_AVD ?= Call_Nina_Pixel_8_API_36

.PHONY: help setup setup-build clean build build-desktop dev debug prd start status kill logs logs-errors logs-clear \
	typecheck lint lint-fix format format-check check design-tokens \
	doctor package-appimage package-inspect install-plugin \
	refresh-plugin plugin-status uninstall-plugin

##@ Setup and workspace builds
help: ## Show grouped commands and usage.
	@awk 'BEGIN {FS = ":.*## "; print "Usage: make <command> [ARGS=\"...\"]"} /^##@ / {printf "\n%s\n", substr($$0, 5)} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-38s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

setup: ## Install the pinned workspace dependencies and validate the toolchain.
	@echo "+ node scripts/build/setup.mjs"
	@node scripts/build/setup.mjs

setup-build: ## Install only dependencies required to build and package from source.
	@echo "+ node scripts/build/setup.mjs --profile build"
	@node scripts/build/setup.mjs --profile build

clean: ## Remove only repository-generated build and package output.
	@echo "+ node scripts/build/clean.mjs"
	@node scripts/build/clean.mjs

build: ## Incrementally build workspace packages and refresh application bundles.
	@echo "+ pnpm run build"
	@pnpm run build

##@ Website
.PHONY: dev-website build-website preview-website
dev-website: ## Run the website locally in the foreground (Ctrl-C to stop).
	@pnpm --filter @call-nina/website run dev $(ARGS)

build-website: ## Typecheck and build the static website into apps/website/dist.
	@pnpm --filter @call-nina/website run build

preview-website: ## Preview the built website locally in the foreground (Ctrl-C to stop).
	@pnpm --filter @call-nina/website run preview $(ARGS)

.PHONY: package-website website-deployment-help
package-website: ## Build and package only the static website for a manual Vercel upload; no remote actions.
	@node scripts/build/package-website.mjs

website-deployment-help: ## Print the desired Vercel settings and manual deploy/readback commands; no remote actions.
	@node scripts/build/package-website.mjs --help

##@ Mobile (Expo and native builds)
.PHONY: emulator dev-mobile dev-mobile-android dev-mobile-ios build-mobile config-mobile run-mobile-android run-mobile-ios
# Expo's localhost URL uses 127.0.0.1 through adb reverse. Prefer IPv4 for that
# route so Node does not bind Metro only to ::1 on IPv6-first hosts.
mobile-localhost-node-options = $(if $(or $(findstring --localhost,$(ARGS)),$(findstring --host localhost,$(ARGS))),NODE_OPTIONS="$${NODE_OPTIONS:+$$NODE_OPTIONS }--dns-result-order=ipv4first" ,)

emulator: ## Start the Android emulator; override with EMULATOR_AVD="name".
	@emulator -avd "$(EMULATOR_AVD)" $(ARGS)

dev-mobile: ## Start Expo Go's foreground Metro server; scan its QR code on a native device.
	@$(mobile-localhost-node-options)pnpm --filter @call-nina/mobile run dev $(ARGS)

dev-mobile-android: ## Start Metro and open Expo Go on an available Android device/emulator.
	@$(mobile-localhost-node-options)pnpm --filter @call-nina/mobile run dev --android $(ARGS)

dev-mobile-ios: ## Start Metro and open Expo Go in the iOS Simulator (macOS only).
	@pnpm --filter @call-nina/mobile run dev --ios $(ARGS)

build-mobile: ## Typecheck and export Android/iOS JavaScript bundles; does not build/install a native app.
	@pnpm --filter @call-nina/mobile run build

config-mobile: ## Resolve public Expo configuration without starting the app.
	@pnpm --filter @call-nina/mobile run config

run-mobile-android: ## Generate, compile and launch a local Android debug app (requires Android SDK).
	@pnpm --filter @call-nina/mobile run android $(ARGS)

run-mobile-ios: ## Generate, compile and launch a local iOS debug app (requires macOS/Xcode).
	@pnpm --filter @call-nina/mobile run ios $(ARGS)

##@ Desktop
build-desktop: ## Incrementally compile desktop dependencies and refresh Electron/renderer bundles.
	@echo "+ pnpm --filter @call-nina/desktop run build"
	@pnpm --filter @call-nina/desktop run build

dev: ## Start the development stack in the background and wait for health.
	@echo "+ node scripts/dev/lifecycle.mjs start dev"
	@node scripts/dev/lifecycle.mjs start dev

debug: ## Start or attach to development; show build progress and follow readable logs.
	@node scripts/dev/lifecycle.mjs debug

prd: ## Build and start the production-like stack in the background.
	@echo "+ pnpm run prd"
	@pnpm run prd

start: prd ## Alias for make prd.

status: ## Show only tracked Call Nina process and health state.
	@echo "+ node scripts/dev/lifecycle.mjs status"
	@node scripts/dev/lifecycle.mjs status

kill: ## Stop only exact tracked Call Nina processes; safe when already stopped.
	@echo "+ node scripts/dev/lifecycle.mjs kill"
	@node scripts/dev/lifecycle.mjs kill

##@ Logs
.PHONY: logs-once
logs-once: ## Read bounded redacted logs once with the same filters as make logs.
	@node scripts/dev/lifecycle.mjs logs $(ARGS)

logs: ## Follow current-run logs (ARGS="--scope history" includes earlier runs).
	@node scripts/dev/lifecycle.mjs logs --follow $(ARGS)

logs-errors: ## Follow current-run warnings and errors (ARGS="--scope history" includes earlier runs).
	@node scripts/dev/lifecycle.mjs logs --follow --errors $(ARGS)

logs-clear: ## Confirm and clear all resolved Call Nina log files.
	@echo "+ node scripts/dev/lifecycle.mjs logs-clear"
	@node scripts/dev/lifecycle.mjs logs-clear

##@ Static checks and diagnostics
typecheck: ## Run strict TypeScript project-reference checks.
	@echo "+ pnpm run typecheck"
	@pnpm run typecheck

lint: ## Run ESLint with zero warnings.
	@echo "+ pnpm run lint"
	@pnpm run lint

lint-fix: ## Apply deterministic ESLint fixes.
	@echo "+ pnpm run lint:fix"
	@pnpm run lint:fix

format: ## Format repository-owned source and configuration files.
	@echo "+ pnpm run format"
	@pnpm run format

format-check: ## Verify Prettier formatting without changing files.
	@echo "+ pnpm run format:check"
	@pnpm run format:check

design-tokens: ## Regenerate browser CSS from the portable design tokens.
	@node scripts/build/generate-design-tokens.mjs

check: ## Run build consistency, formatting, lint, and strict TypeScript checks without live actions.
	@echo "+ pnpm run check"
	@pnpm run check

doctor: ## Diagnose supported tools and local workspace prerequisites without mutation.
	@echo "+ node scripts/diagnostics/doctor.mjs"
	@node scripts/diagnostics/doctor.mjs

##@ Codex plugin and MCP
install-plugin: ## Install only the scoped Call Nina Codex plugin payload.
	@echo "+ pnpm run plugin:install"
	@pnpm run plugin:install

refresh-plugin: ## Refresh only the scoped Call Nina Codex plugin payload.
	@echo "+ pnpm run plugin:refresh"
	@pnpm run plugin:refresh

plugin-status: ## Show supported Call Nina plugin and MCP status.
	@echo "+ pnpm run plugin:status"
	@pnpm run plugin:status

uninstall-plugin: ## Uninstall only the scoped Call Nina Codex plugin.
	@echo "+ pnpm run plugin:uninstall"
	@pnpm run plugin:uninstall

.PHONY: build-mcp-helper
build-mcp-helper: ## Build the self-contained MCP helper without a package tree.
	@node scripts/build/build-mcp-helper.mjs

##@ Interactive desktop verification
.PHONY: verify-start verify-resume verify-status verify-inspect verify-do verify-shot verify-stop verify-suspend
.PHONY: verify-session-status verify-manual-recover verify-manual-quarantine verify-manual-enter verify-manual-leave
verify-session-status: ## Read reservation, local cleanup and retained history independently of app status.
	@node scripts/dev/verify.mjs manual-status
verify-manual-recover: ## Release an explicitly selected, proven-stopped Manual reservation; retain all cleanup evidence.
	@node scripts/dev/verify.mjs manual-recover $(ARGS)
verify-manual-quarantine: ## Archive an explicitly fingerprinted unresolved journal without changing learner data.
	@node scripts/dev/verify.mjs manual-quarantine $(ARGS)
verify-manual-enter: ## Reserve desktop runtime inputs; pending compatible cleanup resumes under the new session.
	@node scripts/dev/verify.mjs manual-enter
verify-manual-leave: ## Release a proven-stopped Manual reservation while retaining any pending cleanup.
	@node scripts/dev/verify.mjs manual-leave

verify-start: ## Build once and launch an interactive real Electron verification session.
	@node scripts/dev/verify.mjs start $(ARGS)
verify-resume: ## Rebuild and reopen a stopped verification session while retaining its recovery journal.
	@node scripts/dev/verify.mjs resume $(ARGS)
verify-status: ## Show the owned verification process status.
	@node scripts/dev/verify.mjs status
verify-inspect: ## Inspect the current window's visible UI (session-only learner content).
	@node scripts/dev/verify.mjs snapshot
verify-do: ## Send one bounded JSON UI action on stdin to the running session.
	@node scripts/dev/verify.mjs do
verify-shot: ## Capture a private screenshot deleted when the session stops.
	@node scripts/dev/verify.mjs screenshot
verify-suspend: ## Stop exact-owned processes without UI cleanup; preserve records/preferences for verify-resume.
	@node scripts/dev/verify.mjs suspend
verify-stop: ## Bounded graceful-first shutdown of exact-owned processes; retain incomplete UI recovery.
	@node scripts/dev/verify.mjs stop

##@ Desktop packaging and installation
package-appimage: ## Build and inspect an unsigned Linux AppImage locally.
	@echo "+ pnpm run package:appimage"
	@pnpm run package:appimage

package-inspect: ## Report and enforce local package footprint budgets.
	@echo "+ node scripts/build/inspect-package.mjs"
	@node scripts/build/inspect-package.mjs

.PHONY: package-local install-local update-local install-status uninstall-local
package-local: ## Build an unsigned unpacked app for the current OS and CPU.
	@pnpm run package:local
install-local: ## Build and install for the current user.
	@sh install/install.sh install
update-local: ## Fast-forward the clean source checkout and replace the installed app.
	@sh install/install.sh update
install-status: ## Inspect the user-local installation.
	@sh install/install.sh status
uninstall-local: ## Choose scoped installation removal.
	@sh install/install.sh uninstall

##@ Repository settings
.PHONY: pipeline-policy
pipeline-policy: ## Show GitHub settings diff; ARGS="apply --plan-digest SHA" applies the reviewed plan.
	@node scripts/dev/pipeline-policy.mjs $(ARGS)

##@ Service and offline configuration
.PHONY: managed-service-plan
managed-service-plan: ## Build and print the disabled starter service plan; no remote actions or inference.
	@pnpm --filter @call-nina/managed-service run build
	@node apps/managed-service/build/plan.js

.PHONY: offline-artifacts
offline-artifacts: ## Explicit offline artifact inspect/install/remove; ARGS includes the device --config-dir. Never runs inference.
	@pnpm --filter @call-nina/offline-runtime run build
	@node scripts/dev/offline-artifacts.mjs $(ARGS)
