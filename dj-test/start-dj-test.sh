#!/bin/sh
# Starts the Spotless AI DJ test stack and opens the DJ page.
set -e
cd "$(dirname "$0")"
docker compose up -d --build
echo "Waiting for Spotless on http://localhost:3300 ..."
until curl -s -o /dev/null http://localhost:3300/api/users; do sleep 2; done
url=http://localhost:3300/dj
if command -v xdg-open >/dev/null 2>&1; then xdg-open "$url"; elif command -v open >/dev/null 2>&1; then open "$url"; else echo "Open $url"; fi
