# syntax=docker/dockerfile:1
FROM --platform=$BUILDPLATFORM ubuntu:24.04 AS codex
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN set -eu; case "$TARGETARCH" in \
      amd64) target=x86_64-unknown-linux-musl; checksum=0b7afd1de4ecf06a8633f1e4958ec5f8d57d4b7842773416d9cb9d8c816f2c84 ;; \
      arm64) target=aarch64-unknown-linux-musl; checksum=08ea8232c5556a8096f8bea1dc38b3166d32a9999465e32cc0183c960c4fae28 ;; \
      *) exit 1 ;; esac; \
    curl -fsSL "https://github.com/openai/codex/releases/download/rust-v0.153.1/codex-package-$target.tar.gz" -o /tmp/codex.tar.gz; \
    printf '%s  /tmp/codex.tar.gz\n' "$checksum" | sha256sum -c -; \
    mkdir -p /opt/codex && tar -xzf /tmp/codex.tar.gz -C /opt/codex && rm /tmp/codex.tar.gz

FROM mcr.microsoft.com/dotnet/sdk:10.0-noble AS checks
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils=24.02.0-1ubuntu9.9 tesseract-ocr=5.3.4-1build5 \
    tesseract-ocr-eng=1:4.1.0-2 tesseract-ocr-deu=1:4.1.0-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /source
COPY server/ ./server/
ENV STUDY_RUN_MATERIAL_TOOLS=1
ENTRYPOINT ["dotnet", "test", "server/StudySpace.Api.Tests/StudySpace.Api.Tests.csproj", "-c", "Release", "-p:RestoreLockedMode=true"]

FROM oven/bun:1.3.9 AS web
WORKDIR /source/web
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile
COPY web/ ./
RUN bun run build && bun test

FROM mcr.microsoft.com/dotnet/sdk:10.0 AS server
WORKDIR /source
COPY server/ ./server/
RUN dotnet restore server/StudySpace.Api/StudySpace.Api.csproj --locked-mode
RUN dotnet publish server/StudySpace.Api/StudySpace.Api.csproj -c Release --no-restore -o /publish /p:UseAppHost=false
COPY --from=web /source/web/dist /publish/wwwroot

FROM mcr.microsoft.com/dotnet/aspnet:10.0-noble AS runtime
USER root
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    poppler-utils=24.02.0-1ubuntu9.9 tesseract-ocr=5.3.4-1build5 \
    tesseract-ocr-eng=1:4.1.0-2 tesseract-ocr-deu=1:4.1.0-2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server --chown=1654:1654 /publish .
COPY --from=codex /opt/codex /opt/codex
ARG VERSION=development
ARG COMMIT=unknown
ENV ASPNETCORE_HTTP_PORTS=8080 STUDY_VERSION=$VERSION STUDY_COMMIT=$COMMIT
LABEL org.opencontainers.image.source="https://github.com/DotNaos/study-space" org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$COMMIT
USER 1654:1654
EXPOSE 8080
ENTRYPOINT ["dotnet", "StudySpace.Api.dll"]
