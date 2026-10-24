#!/usr/bin/env bash
# Task 14.5a smoke — /api/internal/* (internal-token family, NOT the parity
# harness: those endpoints are Next-proxy-only by design).
# Usage: backend/tools/internal-smoke.sh  (expects backend on :3100, data.db
# with at least one client; TOKEN read from dataDir/.seo-internal-token)
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TOKEN="${SEO_INTERNAL_TOKEN:-$(cat "$ROOT/.seo-internal-token" 2>/dev/null || cat "$ROOT/data/.seo-internal-token" 2>/dev/null)}"
B="http://127.0.0.1:3100"
AUTH=(-H "X-Internal-Token: $TOKEN" -H "Content-Type: application/json")
CID=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare('SELECT id FROM clients LIMIT 1').get();console.log(r?r.id:'')" 2>/dev/null)
pass=0; fail=0
chk() { # name expected actual
  if [ "$2" = "$3" ]; then pass=$((pass+1)); echo "PASS $1"; else fail=$((fail+1)); echo "FAIL $1 (expected=$2 got=$3)"; fi
}
# 1. no token -> 401
chk "401-no-token" 401 "$(curl -s -o /dev/null -w '%{http_code}' $B/api/internal/notifications/recent)"
# 2. notifications recent -> valid JSON
chk "notif-json" 200 "$(curl -s -o /dev/null -w '%{http_code}' "${AUTH[@]}" $B/api/internal/notifications/recent)"
# 3. task create -> id
TID=$(curl -s -X POST "${AUTH[@]}" -d "{\"clientId\":$CID,\"title\":\"smoke task $(date +%s)\",\"priority\":\"low\"}" $B/api/internal/tasks/create | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$TID" ] && chk "task-create" y y || chk "task-create" y n
# 4. FK violation surfaces (userId=999999) -> 500 ok:false
chk "task-status-fk-500" 500 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"status":"done","userId":999999}' $B/api/internal/tasks/$TID/status)"
# 5. valid status -> ok:true
R=$(curl -s -X POST "${AUTH[@]}" -d '{"status":"done"}' $B/api/internal/tasks/$TID/status); echo "$R" | grep -q '"ok":true' && chk "task-status-ok" y y || chk "task-status-ok" y n
# 6. recurrence-free delete
chk "task-delete" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{}' $B/api/internal/tasks/$TID/delete)"
# 7. keyword track + dedupe + untrack
KW=$(curl -s -X POST "${AUTH[@]}" -d "{\"clientId\":$CID,\"query\":\"smoke kw $(date +%s)\"}" $B/api/internal/keywords/track)
echo "$KW" | grep -q '"ok":true' && chk "kw-track" y y || chk "kw-track" y n
KID=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare('SELECT id FROM keywords ORDER BY id DESC LIMIT 1').get();console.log(r?r.id:'')")
chk "kw-untrack" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" $B/api/internal/keywords/$KID/untrack)"
# 8. backlink add/status/delete
BL=$(curl -s -X POST "${AUTH[@]}" -d "{\"clientId\":$CID,\"sourceUrl\":\"https://smoke.test/$(date +%s)\"}" $B/api/internal/backlinks/add)
BLID=$(echo "$BL" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$BLID" ] && chk "bl-add" y y || chk "bl-add" y n
chk "bl-status" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"status":"lost"}' $B/api/internal/backlinks/$BLID/status)"
chk "bl-delete" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" $B/api/internal/backlinks/$BLID/delete)"
# 9. ahrefs import (1 row)
R1=$(python3 -c "
import json,urllib.request
csv='Referring page URL,Domain rating,Anchor\\nhttps://smoke-ahrefs.test/'+'$(date +%s)'+',42,nice'
req=urllib.request.Request('$B/api/internal/backlinks/import-ahrefs',data=json.dumps({'clientId':$CID,'csvText':csv}).encode(),headers={'X-Internal-Token':'$TOKEN','Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
")
echo "$R1" | grep -q '"inserted":1' && chk "ahrefs-import" y y || chk "ahrefs-import" y n
echo "----"
echo "PASS=$pass FAIL=$fail"
[ $fail -eq 0 ]
