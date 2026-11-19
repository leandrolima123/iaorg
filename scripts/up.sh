#!/usr/bin/env bash
# Sobe o IAORG (equivale a "docker compose up -d --build") e, no WSL com Docker Desktop,
# garante que o runner volte sozinho ao ligar o computador.
#
# Por quê: um container criado pelo docker do WSL grava o bind de /var/run/docker.sock
# apontando para dentro da distro (…/docker-desktop-bind-mounts/<distro>/docker.sock).
# Ao ligar o PC, o Docker Desktop sobe os containers antes da distro; o mount falha
# ("not a directory") e o restart policy não tenta de novo. Criado pelo docker do Windows
# (docker.exe), o bind aponta para o socket interno do Docker Desktop, que sempre existe.
#
# Uso: ./scripts/up.sh [serviços...]   (os argumentos vão para o "docker compose up")
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d --build "$@"

# Fora do WSL (Linux, macOS) não há nada a corrigir.
grep -qi microsoft /proc/version 2>/dev/null || exit 0
if ! command -v docker.exe >/dev/null 2>&1; then
  echo "Aviso: docker.exe não encontrado no PATH do WSL; o runner pode não subir ao ligar o PC (ver README)." >&2
  exit 0
fi

project="${COMPOSE_PROJECT_NAME:-$(basename "$PWD" | tr '[:upper:]' '[:lower:]')}"
id="$(docker.exe inspect iaorg-runner --format '{{.Id}}' 2>/dev/null </dev/null | tr -d '\r' || true)"
[ -z "$id" ] && exit 0

# Lê o bind gravado pelo daemon (por um container criado pelo Windows, para o caminho não ser traduzido).
if docker.exe run --rm --entrypoint sh -v /var/lib/docker/containers:/c:ro iaorg-runner:latest \
     -c "grep -q docker-desktop-bind-mounts /c/$id/hostconfig.json" >/dev/null 2>&1 </dev/null; then
  echo "Recriando o runner pelo Docker do Windows (para subir sozinho ao ligar o PC)…"
  win="$(wslpath -w "$PWD")"
  docker.exe compose --project-directory "$win" -f "$win\\docker-compose.yml" -p "$project" \
    up -d --no-build --no-deps --force-recreate runner </dev/null
fi
