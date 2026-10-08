#!/bin/sh
# Container entrypoint. The image starts as root only so this script can make the bind-mounted
# /data writable by the app user, then it drops privileges with gosu. Running as a non-root
# user from the start would leave a root-owned ./data (created by docker compose on first run)
# unwritable and the app dead on arrival.
set -eu

if [ "$(id -u)" != "0" ]; then
  # Already unprivileged (e.g. `user:` set in compose): nothing to fix, just run the app.
  exec "$@"
fi

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

case "$PUID$PGID" in
  '' | *[!0-9]*)
    echo "entrypoint: PUID and PGID must be numeric (got PUID=$PUID PGID=$PGID)" >&2
    exit 1
    ;;
esac

# Re-map the built-in node user to the requested ids so files it creates in /data match the host.
# -o allows an id that another account already holds (e.g. PGID=100 "users" on many distros).
if [ "$(id -g node)" != "$PGID" ]; then
  groupmod -o -g "$PGID" node
fi
if [ "$(id -u node)" != "$PUID" ]; then
  usermod -o -u "$PUID" node
fi

# Only /data is ever chowned. /music is the user's library and must never be touched.
if [ -d /data ] && [ "$(stat -c '%u:%g' /data)" != "$PUID:$PGID" ]; then
  echo "entrypoint: fixing ownership of /data for $PUID:$PGID"
  chown -R "$PUID:$PGID" /data
fi

exec gosu node "$@"
