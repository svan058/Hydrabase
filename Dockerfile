FROM oven/bun
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

ENV NODE_ENV=production

USER bun
EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD ls; bun run src/index.ts; sleep 3600
