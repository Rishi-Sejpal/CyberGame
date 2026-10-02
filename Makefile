# Simple deployment commands
.PHONY: dev build start test lint db-up db-down db-logs clean

# Development
dev:
	npm run dev

# Build for production
build:
	npm run build

# Start production server
start:
	npm run start

# Run all tests
test:
	npm test

# Lint and typecheck
lint:
	npm run lint
	npm run typecheck

# Full verification
verify:
	npm run verify

# Database
db-up:
	docker compose up -d mongodb

db-down:
	docker compose down

db-logs:
	docker compose logs -f mongodb

db-reset:
	docker compose down -v && docker compose up -d mongodb

# Docker
docker-build:
	docker build -t cybergrid .

docker-run:
	docker compose up -d

docker-logs:
	docker compose logs -f app

docker-stop:
	docker compose down

# Clean everything
clean:
	rm -rf .next node_modules package-lock.json
	docker compose down -v

# Generate secrets for .env.local
gen-secrets:
	@echo "SESSION_SECRET=$(shell openssl rand -base64 32)"
	@echo "PASSWORD_PEPPER=$(shell openssl rand -base64 32)"

# Quick start for new developers
setup: gen-secrets
	@echo "Copy the above secrets to .env.local"
	@echo "Then run: make db-up && make dev"