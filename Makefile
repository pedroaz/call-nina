.DEFAULT_GOAL := help

.PHONY: orchestrate
orchestrate: ## Orca roles, safe worktree transfer and verification barrier (ARGS='help').
	@node scripts/agents/orchestrate.mjs $(ARGS)

# Pass advanced options explicitly, for example: make logs ARGS="--level debug".
ARGS ?=

.PHONY: help setup setup-build clean build build-desktop dev debug prd start status kill logs logs-errors logs-clear \
	typecheck lint lint-fix format format-check check \
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

check: ## Run formatting, lint, and strict TypeScript checks without live actions.
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

.PHONY: verify-start verify-resume verify-status verify-inspect verify-do verify-shot verify-stop logs-once
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
verify-stop: ## Clean up tracked records, restore preferences, and close the owned session.
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
github: ## GitHub project, queue and PR operations via gh (ARGS="help").
	@node scripts/agents/github.mjs $(ARGS)
