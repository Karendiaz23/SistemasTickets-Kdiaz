#!/usr/bin/env bash
cd /home/etec/Documentos/SistemasTickets-Kdiaz || exit 1

if ! pgrep -f "pocketbase serve" >/dev/null 2>&1; then
    nohup ./pocketbase serve --http=127.0.0.1:8090 >/tmp/pocketbase.log 2>&1 &
    sleep 2
fi

if ! pgrep -f "node index.js" >/dev/null 2>&1; then
    nohup node index.js >/tmp/tickets-api.log 2>&1 &
    sleep 2
fi

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
