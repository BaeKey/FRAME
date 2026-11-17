# syntax=docker/dockerfile:1
FROM node:22-alpine AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/ ./web/
COPY --from=web-build /src/web/dist ./web/dist
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/frame ./cmd/gateway

FROM gcr.io/distroless/static-debian12:nonroot
ARG VERSION
ARG REVISION
LABEL org.opencontainers.image.title="FRAME" \
      org.opencontainers.image.description="Private OpenList media library with browser-side decryption" \
      org.opencontainers.image.source="https://github.com/BaeKey/FRAME" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION
WORKDIR /app
COPY --from=build /out/frame /frame
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/frame"]
CMD ["-config", "/app/config.yaml"]
