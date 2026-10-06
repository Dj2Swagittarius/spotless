#!/bin/sh
# Stops the Spotless AI DJ test stack. Data and downloaded models are kept (named volumes).
cd "$(dirname "$0")"
docker compose down
