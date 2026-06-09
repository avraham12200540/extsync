# ExtSync — unified developer commands.
# On Windows without `make`, see scripts in infrastructure/scripts/*.ps1
# (each target has a PowerShell twin).

SHELL := /bin/bash
COMPOSE := docker compose

.DEFAULT_GOAL := help

.PHONY: help
help: ## הצגת רשימת הפקודות
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------- infra
.PHONY: up
up: ## docker compose up -d --build
	$(COMPOSE) up -d --build

.PHONY: down
down: ## docker compose down
	$(COMPOSE) down

.PHONY: clean
clean: ## הורדה + מחיקת volumes (אובדן נתונים מקומי!)
	$(COMPOSE) down -v

.PHONY: logs
logs: ## מעקב אחרי לוגים (svc=api)
	$(COMPOSE) logs -f $(svc)

.PHONY: ps
ps: ## סטטוס שירותים
	$(COMPOSE) ps

# ---------------------------------------------------------------- db
.PHONY: migrate
migrate: ## הרצת מיגרציות Alembic ל-head
	$(COMPOSE) run --rm api alembic upgrade head

.PHONY: revision
revision: ## יצירת מיגרציה אוטומטית: make revision m="add x"
	$(COMPOSE) run --rm api alembic revision --autogenerate -m "$(m)"

.PHONY: downgrade
downgrade: ## חזרה מיגרציה אחת אחורה
	$(COMPOSE) run --rm api alembic downgrade -1

.PHONY: seed
seed: ## Seed data + יצירת Admin
	$(COMPOSE) run --rm api python -m extsync_api.scripts.seed

# ---------------------------------------------------------------- signing
.PHONY: gen-dev-signing-key
gen-dev-signing-key: ## יצירת מפתח Ed25519 לפיתוח + הדפסת public key ל-.env
	@python infrastructure/scripts/gen_signing_key.py

# ---------------------------------------------------------------- quality
.PHONY: test
test: test-api test-cli test-bridge ## כל הבדיקות

.PHONY: test-api
test-api: ## בדיקות Backend (pytest)
	$(COMPOSE) run --rm api pytest -q

.PHONY: test-cli
test-cli: ## בדיקות CLI
	cd apps/cli && npm test

.PHONY: test-bridge
test-bridge: ## בדיקות Bridge
	cd packages/extension-bridge && npm test

.PHONY: lint
lint: ## Lint (ruff + eslint)
	$(COMPOSE) run --rm api ruff check .
	cd apps/web && npm run lint

.PHONY: typecheck
typecheck: ## בדיקת טיפוסים (mypy + tsc)
	$(COMPOSE) run --rm api mypy extsync_api
	cd apps/web && npm run typecheck

.PHONY: fmt
fmt: ## פירמוט (ruff format)
	$(COMPOSE) run --rm api ruff format .

# ---------------------------------------------------------------- agent / installer (Windows)
.PHONY: agent-build
agent-build: ## בניית Agent + Native Host (.NET 8)
	dotnet build apps/agent-windows/ExtSync.Agent.sln -c Release
	dotnet build apps/native-host/ExtSync.NativeHost.csproj -c Release

.PHONY: installer
installer: agent-build ## בניית מתקין Windows (Inno Setup)
	iscc installers/windows/extsync-agent.iss

# ---------------------------------------------------------------- dev fixtures
.PHONY: build-fixtures
build-fixtures: ## אריזת תוספי הבדיקה ל-ZIP
	python tests/fixtures/build_fixtures.py
