.DEFAULT_GOAL := help
ARGS ?=

.PHONY: help setup dev start stop kill status logs build check clean format
help: ## Show everyday desktop commands.
	@awk 'BEGIN {FS = ":.*## "; print "Usage: make <command> [ARGS=\"...\"]"} /^[a-zA-Z0-9_-]+:.*## / {printf "  %-12s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo 'Other surfaces: pnpm --filter @call-nina/website run dev; pnpm --filter @call-nina/mobile run dev'
	@echo 'Maintenance: pnpm run (lists packaging, installation, plugin and individual check commands)'

setup: ## Install workspace dependencies.
	@pnpm run setup

dev: ## Build and start desktop development in the background.
	@node scripts/dev/lifecycle.mjs start dev

start: ## Run the built desktop app (make build first).
	@node scripts/dev/lifecycle.mjs start prd

stop: ## Stop the desktop app and its development watchers.
	@node scripts/dev/lifecycle.mjs stop

kill: stop ## Alias for stop.

status: ## Show desktop process state.
	@node scripts/dev/lifecycle.mjs status

logs: ## Read logs; ARGS="--follow", "--errors", or "--clear".
	@node scripts/dev/lifecycle.mjs logs $(ARGS)

build: ## Build desktop and its dependencies.
	@pnpm run build

check: ## Run static consistency, formatting, lint and type checks.
	@pnpm run check

format: ## Format repository source and configuration.
	@pnpm run format

clean: ## Remove generated build output, preserving learner data.
	@pnpm run clean

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

