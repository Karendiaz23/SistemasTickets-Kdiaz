#!/usr/bin/env bash
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR" || exit 1

# 1. Levantar PocketBase si no está corriendo
if ! pgrep -f "pocketbase serve" >/dev/null 2>&1; then
    nohup ./pocketbase serve --http=127.0.0.1:8090 >/tmp/pocketbase.log 2>&1 &
    sleep 2
fi

# 2. Levantar Node si no está corriendo
if ! pgrep -f "node index.js" >/dev/null 2>&1; then
    nohup node index.js >/tmp/tickets-api.log 2>&1 &
    sleep 2
fi

# 3. Abrir como ventana de aplicación
URL="http://localhost:3000"
if command -v chromium >/dev/null 2>&1; then
    chromium --app="$URL" --new-window >/dev/null 2>&1 &
elif command -v google-chrome >/dev/null 2>&1; then
    google-chrome --app="$URL" --new-window >/dev/null 2>&1 &
elif command -v firefox >/dev/null 2>&1; then
    firefox --new-window "$URL" >/dev/null 2>&1 &
else
    xdg-open "$URL" >/dev/null 2>&1 &
fi
