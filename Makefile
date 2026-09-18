.PHONY: dev build vet run test web-build docker-build

dev:
	cd server && go run . --static-dir ../web/player/dist

run:
	cd server && go run . --static-dir ../web/player/dist --port 8080

vet:
	cd server && go vet ./...

test:
	cd server && go test ./...

build:
	cd server && CGO_ENABLED=0 go build -o ../kinolink .

web-build:
	cd web && npm install --no-audit --no-fund && npm run build --workspaces

docker-build: web-build
	docker build -t kinolink:dev .
