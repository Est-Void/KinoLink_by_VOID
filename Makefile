.PHONY: dev build vet run docker-build

dev:
	cd server && go run .

run:
	cd server && go run . --port 8080

vet:
	cd server && go vet ./...

build:
	cd server && CGO_ENABLED=0 go build -o ../kinolink .

docker-build:
	docker build -t kinolink:dev .
