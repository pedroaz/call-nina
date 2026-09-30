.DEFAULT_GOAL := help

.PHONY: orchestrate
orchestrate: ## Start the developer coordinator; ARGS="help" shows advanced operations.
	@node scripts/agents/orchestrate.mjs $(ARGS)

# Pass advanced options explicitly, for example: make logs ARGS="--level debug".
ARGS ?=

.PHONY: help setup setup-build clean build build-desktop dev debug prd start status kill logs logs-errors logs-clear \
	typecheck lint lint-fix format format-check check design-tokens \
	doctor package-appimage package-inspect install-plugin \
	refresh-plugin plugin-status uninstall-plugin

help: ## Show this help.
	@awk 'BEGIN {FS = ":.*## "} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

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

build-desktop: ## Incrementally compile desktop dependencies and refresh Electron/renderer bundles.
	@echo "+ pnpm --filter @call-nina/desktop run build"
	@pnpm --filter @call-nina/desktop run build

.PHONY: dev-website build-website preview-website
dev-website: ## Run the website locally in the foreground (Ctrl-C to stop).
	@pnpm --filter @call-nina/website run dev $(ARGS)

build-website: ## Typecheck and build the static website into apps/website/dist.
	@pnpm --filter @call-nina/website run build

preview-website: ## Preview the built website locally in the foreground (Ctrl-C to stop).
	@pnpm --filter @call-nina/website run preview $(ARGS)

.PHONY: dev-mobile dev-mobile-android dev-mobile-ios build-mobile config-mobile run-mobile-android run-mobile-ios
# Expo's localhost URL uses 127.0.0.1 through adb reverse. Prefer IPv4 for that
# route so Node does not bind Metro only to ::1 on IPv6-first hosts.
mobile-localhost-node-options = $(if $(or $(findstring --localhost,$(ARGS)),$(findstring --host localhost,$(ARGS))),NODE_OPTIONS="$${NODE_OPTIONS:+$$NODE_OPTIONS }--dns-result-order=ipv4first" ,)

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

.PHONY: package-website website-deployment-help
package-website: ## Build and package only the static website for a manual Vercel upload; no remote actions.
	@node scripts/build/package-website.mjs

website-deployment-help: ## Print the desired Vercel settings and coordinator deploy/readback commands; no remote actions.
	@node scripts/build/package-website.mjs --help

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

logs: ## Follow current-run logs (ARGS="--scope history" includes earlier runs).
	@node scripts/dev/lifecycle.mjs logs --follow $(ARGS)

logs-errors: ## Follow current-run warnings and errors (ARGS="--scope history" includes earlier runs).
	@node scripts/dev/lifecycle.mjs logs --follow --errors $(ARGS)

logs-clear: ## Confirm and clear all resolved Call Nina log files.
	@echo "+ node scripts/dev/lifecycle.mjs logs-clear"
	@node scripts/dev/lifecycle.mjs logs-clear

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

package-appimage: ## Build and inspect an unsigned Linux AppImage locally.
	@echo "+ pnpm run package:appimage"
	@pnpm run package:appimage

package-inspect: ## Report and enforce local package footprint budgets.
	@echo "+ node scripts/build/inspect-package.mjs"
	@node scripts/build/inspect-package.mjs

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

.PHONY: verify-recovery-inventory verify-recovery-resume verify-recovery-reconcile verify-recovery-do verify-start verify-resume verify-status verify-inspect verify-do verify-shot verify-stop verify-suspend verify-recovery-stop verify-recovery-advance verify-reconcile-disclosure verify-reconcile-plugin-refresh logs-once
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
verify-recovery-inventory: ## Coordinator: inspect current artifacts for no-build controller recovery using one stdin request.
	@node scripts/dev/verify.mjs recovery-inventory
verify-recovery-resume: ## Coordinator: resume cleanup with reviewed controller and unchanged target app from a digest-bound stdin request.
	@node scripts/dev/verify.mjs recovery-resume
verify-recovery-reconcile: ## Coordinator: reconcile the retained recovery attempt; never spawn another app.
	@node scripts/dev/verify.mjs recovery-reconcile $(ARGS)
verify-recovery-do: ## Coordinator: inspect, restore or clean exact-owned records in the retained recovery app.
	@node scripts/dev/verify.mjs recovery-do $(ARGS)
verify-recovery-stop: ## Coordinator: stop only the existing Run barrier target and retain terminal identity proof.
	@node scripts/dev/verify.mjs recovery-stop $(ARGS)
verify-recovery-advance: ## Coordinator: advance the stopped reserved checkout to a reviewed descendant, preserving its journal.
	@node scripts/dev/verify.mjs recovery-advance
verify-reconcile-disclosure: ## Coordinator: reconcile one source-bounded disclosure from stdin using stopped proof and journal CAS.
	@node scripts/dev/verify.mjs reconcile-disclosure $(ARGS)
verify-reconcile-plugin-refresh: ## Coordinator: reconcile an evidenced scoped plugin refresh after verified UI registration.
	@node scripts/dev/verify.mjs reconcile-plugin-refresh $(ARGS)
verify-stop: ## Bounded graceful-first shutdown of exact-owned processes; retain incomplete UI recovery.
	@node scripts/dev/verify.mjs stop
logs-once: ## Read bounded redacted logs once with the same filters as make logs.
	@node scripts/dev/lifecycle.mjs logs $(ARGS)

.PHONY: build-mcp-helper
build-mcp-helper: ## Build the self-contained MCP helper without a package tree.
	@node scripts/build/build-mcp-helper.mjs

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

.PHONY: github
github: ## GitHub project, linked task publication, metadata and PR operations via gh (ARGS="help").
	@node scripts/agents/github.mjs $(ARGS)

.PHONY: pipeline-policy
pipeline-policy: ## Show additive GitHub settings diff; ARGS="apply --plan-digest SHA" applies the reviewed plan.
	@node scripts/agents/pipeline-policy.mjs $(ARGS)
