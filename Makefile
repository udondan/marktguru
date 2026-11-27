SHELL := /bin/bash -euo pipefail

NO_COLOR=\x1b[0m
TARGET_COLOR=\x1b[96m

build:
	@echo -e "$(TARGET_COLOR)Running build$(NO_COLOR)"
	@bun run build

clean:
	@echo -e "$(TARGET_COLOR)Running clean$(NO_COLOR)"
	@rm -rf node_modules dist

install:
	@echo -e "$(TARGET_COLOR)Running install$(NO_COLOR)"
	@bun install --frozen-lockfile

test:
	@echo -e "$(TARGET_COLOR)Running tests$(NO_COLOR)"
	@bun run test

test-unit:
	@echo -e "$(TARGET_COLOR)Running unit tests$(NO_COLOR)"
	@bun run test:unit

# The tests take their types from the declarations in dist/.
eslint: build
	@echo -e "$(TARGET_COLOR)Running eslint $$(bunx eslint --version)$(NO_COLOR)"
	@bunx eslint .; \
	echo "Passed"

# The deterministic checks of Glama's Tool Definition Quality Score (TDQS)
# for the tools of the built MCP server. Warnings fail. CI passes
# TDQS_ARGS for a markdown report.
lint-tools: build
	@echo -e "$(TARGET_COLOR)Running tdqs lint$(NO_COLOR)"
	@bun run lint:tools $(TDQS_ARGS)

format:
	@echo -e "$(TARGET_COLOR)Running prettier$(NO_COLOR)"
	@bunx prettier --write .

validate-package:
	@echo -e "$(TARGET_COLOR)Checking package content$(NO_COLOR)"
	@\
	if ! TARBALL=$$(npm pack --quiet) || [ -z "$$TARBALL" ]; then \
		echo "❌ npm pack failed"; \
		exit 1; \
	fi; \
	TARBALL=$$(printf '%s\n' "$$TARBALL" | tail -n 1); \
	if [ ! -f "$$TARBALL" ]; then \
		echo "❌ npm pack package file not found: $$TARBALL"; \
		exit 1; \
	fi; \
	trap 'rm -f "$$TARBALL"' EXIT; \
	if ! tar -tf "$$TARBALL" >/dev/null; then \
		echo "❌ Failed to list tarball contents"; \
		exit 1; \
	fi; \
	FILES_TO_CHECK="dist/cli.js dist/program.js dist/api.js dist/auth.js dist/config.js dist/query.js dist/commands/config.js dist/commands/login.js dist/commands/mcp.js dist/commands/search.js dist/commands/serve.js LICENSE README.md"; \
	MISSING_FILES=""; \
	for file in $$FILES_TO_CHECK; do \
		if ! tar -tf "$$TARBALL" "package/$$file" >/dev/null 2>&1; then \
			MISSING_FILES="$$MISSING_FILES $$file"; \
		fi; \
	done; \
	if [ -n "$$MISSING_FILES" ]; then \
		echo "❌ The following files are NOT included in the package:$$MISSING_FILES"; \
		exit 1; \
	fi; \
	echo "✅ Package content looks good"

# The image takes the compiled dist/, it doesn't compile TypeScript itself.
docker-build: build
	@echo -e "$(TARGET_COLOR)Building Docker image$(NO_COLOR)"
	@docker build -t udondan/marktguru .

# Adds the server to a Docker MCP Toolkit profile, created if missing.
# docker mcp only reads server files from its catalogs directory.
PROFILE ?= marktguru
docker-register:
	@echo -e "$(TARGET_COLOR)Adding the server to the Docker MCP Toolkit profile $(PROFILE)$(NO_COLOR)"
	@catalogs="$$HOME/.docker/mcp/catalogs"; \
	mkdir -p "$$catalogs"; \
	cp docker-mcp.yml "$$catalogs/marktguru.yml"; \
	server="file://$$catalogs/marktguru.yml"; \
	if docker mcp profile show "$(PROFILE)" >/dev/null 2>&1; then \
		docker mcp profile server add "$(PROFILE)" --server "$$server"; \
	else \
		docker mcp profile create --name "$(PROFILE)" --id "$(PROFILE)" --server "$$server"; \
	fi

docker: docker-build docker-register
