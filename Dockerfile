# syntax=docker/dockerfile:1
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
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=server --chown=1654:1654 /publish .
ARG VERSION=development
ARG COMMIT=unknown
ENV ASPNETCORE_HTTP_PORTS=8080 STUDY_VERSION=$VERSION STUDY_COMMIT=$COMMIT
LABEL org.opencontainers.image.source="https://github.com/DotNaos/study-space" org.opencontainers.image.version=$VERSION org.opencontainers.image.revision=$COMMIT
USER 1654:1654
EXPOSE 8080
ENTRYPOINT ["dotnet", "StudySpace.Api.dll"]
