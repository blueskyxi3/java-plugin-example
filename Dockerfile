FROM node:24-alpine AS frontend
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY plugin.json ../plugin.json
COPY web/ ./
RUN npm test

FROM maven:3.9.11-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml ./
COPY plugin.json catalog.example.json ./
COPY src ./src
COPY --from=frontend /build/web/build ./web/build
RUN --mount=type=cache,target=/root/.m2 mvn -B -ntp verify

FROM eclipse-temurin:21-jre-jammy
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 plugin \
    && useradd --uid 10001 --gid plugin --no-create-home plugin \
    && mkdir -p /app/data && chown plugin:plugin /app/data
WORKDIR /app
COPY --from=build /build/target/java-example-1.0.0.jar /app/plugin.jar
ENV JAVA_EXAMPLE_DATA_DIR=/app/data
USER plugin
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s \
  CMD curl --fail --silent http://127.0.0.1:${JAVA_EXAMPLE_SERVER_PORT:-8080}/healthz > /dev/null || exit 1
ENTRYPOINT ["java", "-jar", "/app/plugin.jar"]
