FROM oven/bun
WORKDIR /app

USER bun

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

ENV NODE_ENV=production

EXPOSE 4545/tcp
EXPOSE 45454/udp
CMD bun run src/index.ts; sleep 3600
