.DEFAULT_GOAL := help

# One invocation is one command; subsequent goals are positional arguments.
command := $(or $(firstword $(MAKECMDGOALS)),help)
arguments := $(or $(MAKECMDGOALS),help)
.PHONY: $(sort $(arguments))
$(command):
	@node scripts/commands.mjs $(foreach argument,$(arguments),'$(subst ','"'"',$(argument))')

ifneq ($(strip $(filter-out $(command),$(MAKECMDGOALS))),)
$(filter-out $(command),$(MAKECMDGOALS)):
	@:
endif
