#!/usr/bin/env bash
# Proxy contract check: browser -> :3000 rewrite -> Django :8001 with cookies.
set -u
BASE=http://localhost:3000
JAR=/tmp/proxy-cookies.txt
rm -f "$JAR"

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

echo "== unauthenticated"
printf 'GET  /api/meta/            %s\n' "$(code -b "$JAR" -c "$JAR" $BASE/api/meta/)"
printf 'GET  /api/meta             %s\n' "$(code -b "$JAR" -c "$JAR" $BASE/api/meta)"
printf 'GET  /api/sync/            %s (want 401)\n' "$(code -b "$JAR" $BASE/api/sync/)"

echo "== login (new device)"
LOGIN=$(curl -s -b "$JAR" -c "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"identifier":"sita","password":"exposing-demo-1"}' $BASE/api/auth/login)
echo "  $LOGIN"
CH=$(sed -E 's/.*"challenge":([0-9]+).*/\1/' <<<"$LOGIN")
CD=$(sed -E 's/.*"dev_code":"([0-9]+)".*/\1/' <<<"$LOGIN")
printf 'POST /api/auth/otp/        %s\n' "$(code -b "$JAR" -c "$JAR" -X POST -H 'Content-Type: application/json' \
  -d "{\"challenge\":$CH,\"code\":\"$CD\"}" $BASE/api/auth/otp/)"

echo "== session"
printf 'GET  /api/auth/me/         %s\n' "$(code -b "$JAR" $BASE/api/auth/me/)"
SYNC=$(curl -s -b "$JAR" -c "$JAR" -w '\n%{http_code}' $BASE/api/sync/)
printf 'GET  /api/sync/            %s\n' "${SYNC##*$'\n'}"
SYNC="${SYNC%$'\n'*}"
node -e '
const d = JSON.parse(process.argv[1]);
console.log("  keys:", Object.keys(d).join(","));
console.log("  me:", d.me.username, "people:", d.people.length, "suggestions:", d.suggestions.length,
            "follows:", d.follows.length, "promotions:", d.promotions.length,
            "unread:", JSON.stringify(d.unread), "coins:", d.me.coins);
' "$SYNC"

echo "== csrf-protected writes"
CSRF=$(grep exposing_csrf "$JAR" | awk '{print $7}')
printf 'csrf cookie                %s\n' "${CSRF:0:12}..."
POST=$(curl -s -b "$JAR" -c "$JAR" -X POST -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d '{"text":"proxy contract check","audience":"public"}' $BASE/api/posts/)
PID=$(sed -E 's/.*"id":([0-9]+).*/\1/' <<<"$POST")
printf 'POST /api/posts/           %s id=%s\n' "$(grep -o '"id":[0-9]*' <<<"$POST" | head -1)" "$PID"
printf 'POST /api/reactions/       %s\n' "$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d "{\"target_type\":\"post\",\"target_id\":\"$PID\",\"kind\":\"like\"}" $BASE/api/reactions/)"
printf 'POST /api/comments/        %s\n' "$(code -b "$JAR" -X POST -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d "{\"post\":\"$PID\",\"text\":\"proxy comment\"}" $BASE/api/comments/)"
printf 'DELETE /api/reactions/toggle/ %s\n' "$(code -b "$JAR" -X DELETE -H 'Content-Type: application/json' -H "X-CSRF-Token: $CSRF" \
  -d "{\"target_type\":\"post\",\"target_id\":\"$PID\"}" $BASE/api/reactions/toggle/)"
printf 'DELETE /api/posts/%s/       %s\n' "$PID" "$(code -b "$JAR" -X DELETE -H "X-CSRF-Token: $CSRF" $BASE/api/posts/$PID/)"
printf 'POST /api/posts/ no csrf   %s (want 403)\n' "$(code -b "$JAR" -X POST -H 'Content-Type: application/json' \
  -d '{"text":"should be blocked"}' $BASE/api/posts/)"

echo "== refresh + logout"
printf 'POST /api/auth/refresh/    %s\n' "$(code -b "$JAR" -c "$JAR" -X POST $BASE/api/auth/refresh/)"
# refresh rotates the csrf cookie, so replay the value the browser now holds
CSRF=$(grep exposing_csrf "$JAR" | awk '{print $7}')
printf 'POST /api/auth/logout/     %s\n' "$(code -b "$JAR" -c "$JAR" -X POST -H "X-CSRF-Token: $CSRF" $BASE/api/auth/logout/)"
printf 'GET  /api/sync/ after      %s (want 401)\n' "$(code -b "$JAR" $BASE/api/sync/)"
