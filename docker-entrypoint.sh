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
if [ -d /data ]; then
  if [ "$(stat -c '%u:%g' /data)" != "$PUID:$PGID" ]; then
    echo "entrypoint: fixing ownership of /data for $PUID:$PGID"
    # Best effort: CIFS without unix extensions, NFS with root_squash and read-only mounts reject
    # chown even though their mode bits may already let the app write, and `set -e` would otherwise
    # kill the container here. What matters is writability, which is checked as the app user below.
    chown -R "$PUID:$PGID" /data 2>/dev/null \
      || echo "entrypoint: could not change ownership of /data (network/read-only mount?); continuing" >&2
  fi
  if ! gosu node test -w /data; then
    echo "entrypoint: /data is not writable by uid $PUID; fix the mount permissions or set PUID/PGID" >&2
    exit 1
  fi
fi

exec gosu node "$@"
