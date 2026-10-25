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
