FROM oven/bun

RUN apt-get update && apt-get install -y git gosu && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone https://github.com/QuixThe2nd/Hydrabase .
RUN bun install

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "src"]
