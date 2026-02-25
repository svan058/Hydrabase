#!/bin/bash
PUID=${PUID:-1000}
PGID=${PGID:-1000}

groupadd -o -g "$PGID" hydrabase 2>/dev/null || true
useradd -o -u "$PUID" -g hydrabase -M -s /bin/false hydrabase 2>/dev/null || true

chown -R hydrabase:hydrabase /app/data 2>/dev/null || true

exec gosu hydrabase "$@"