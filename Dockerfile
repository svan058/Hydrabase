# ---- deps stage ----
FROM oven/bun AS deps

RUN \
    groupadd -f -g ${PGID} hydrabasegroup || true && \
    useradd -o -u ${PUID} -g ${PGID} -m hydrabase || true

USER ${PUID}:${PGID}

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---- release stage ----
FROM oven/bun AS release
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

EXPOSE 4545/tcp
EXPOSE 45454/udp

ARG PUID=99
ARG PGID=100

CMD bun src; sleep 3600
