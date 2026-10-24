FROM oven/bun:1.4.4-debian
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
COPY scripts/postinstall.ts scripts/postinstall.ts
RUN bun install --frozen-lockfile --ignore-scripts
COPY . .
ENV GBRAIN_HOME=/data
CMD ["bun", "--no-env-file", "src/deployment/worker.ts"]
