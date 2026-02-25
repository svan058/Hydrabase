FROM oven/bun

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/* \
    && useradd -u 1000 -m hydrabase

WORKDIR /app
RUN git clone https://github.com/QuixThe2nd/Hydrabase .
RUN bun install
RUN chown -R hydrabase:hydrabase /app

USER hydrabase

CMD git pull; bun install; bun src