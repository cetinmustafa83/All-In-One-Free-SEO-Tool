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

# ---- 14.5b: clients domain ----
STAMP=$(date +%s)
# 10. create (saas + Next.js stack, one niche title preflight-skipped)
CR=$(curl -s -X POST "${AUTH[@]}" -d "{\"name\":\"Smoke Client $STAMP\",\"url\":\"https://smoke-client-$STAMP.test\",\"niche\":\"saas\",\"techStack\":[\"Next.js\"],\"precheck\":[{\"title\":\"Write SoftwareApplication schema for your homepage\",\"evidence\":\"smoke\"}]}" $B/api/internal/clients/create)
CID2=$(echo "$CR" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$CID2" ] && chk "client-create" y y || chk "client-create" y n
echo "$CR" | grep -q "\"redirect\":\"/clients/$CID2/onboarding\"" && chk "client-create-redirect" y y || chk "client-create-redirect" y n
# 11. templates seeded (saas niche minus 1 skipped + Next.js stack rows)
TC=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT COUNT(*) c FROM tasks WHERE client_id=?').get(Number('$CID2')).c)" 2>/dev/null)
[ -n "$TC" ] && [ "$TC" -gt 0 ] && chk "client-templates-seeded" y y || chk "client-templates-seeded" y n
SK=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT COUNT(*) c FROM activity_log WHERE kind='task.template_skipped' AND client_id=? AND message LIKE 'Skipped 1 niche task%'\").get(Number('$CID2')).c)" 2>/dev/null)
[ "$SK" = "1" ] && chk "client-template-skip-logged" y y || chk "client-template-skip-logged" y n
# 12. re-apply is idempotent (11 titles exist, 1 preflight-skipped again → added:0)
RA=$(curl -s -X POST "${AUTH[@]}" -d '{"kind":"niche","precheck":[{"title":"Write SoftwareApplication schema for your homepage","evidence":"smoke"}]}' $B/api/internal/clients/$CID2/apply-templates)
echo "$RA" | grep -q '"added":0' && chk "apply-templates-idempotent" y y || chk "apply-templates-idempotent" y n
# 13. update (+redirect path)
UR=$(curl -s -X POST "${AUTH[@]}" -d "{\"id\":$CID2,\"name\":\"Smoke Renamed $STAMP\",\"url\":\"https://smoke-client-$STAMP.test\",\"niche\":\"blog\"}" $B/api/internal/clients/$CID2/update)
echo "$UR" | grep -q '"ok":true' && chk "client-update" y y || chk "client-update" y n
echo "$UR" | grep -q "\"redirect\":\"/clients/$CID2\"" && chk "client-update-redirect" y y || chk "client-update-redirect" y n
# 14. redetect-stack (technologies computed Next-side)
curl -s -X POST "${AUTH[@]}" -d '{"technologies":["WordPress","Cloudflare"]}' $B/api/internal/clients/$CID2/redetect-stack > /dev/null
TS=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT tech_stack t FROM clients WHERE id=?').get(Number('$CID2')).t)" 2>/dev/null)
[ "$TS" = '["WordPress","Cloudflare"]' ] && chk "client-redetect-stack" y y || chk "client-redetect-stack" y n
# 15. share-token generate (24 bytes → 32 urlsafe chars) + revoke
SG=$(curl -s -X POST "${AUTH[@]}" -d '{"action":"generate"}' $B/api/internal/clients/$CID2/share-token)
echo "$SG" | grep -q '"ok":true' && chk "share-generate" y y || chk "share-generate" y n
TOK=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT share_token t FROM clients WHERE id=?').get(Number('$CID2')).t)" 2>/dev/null)
echo -n "$TOK" | grep -qE '^[A-Za-z0-9_-]{32}$' && chk "share-token-format" y y || chk "share-token-format" y n
SR=$(curl -s -X POST "${AUTH[@]}" -d '{"action":"revoke"}' $B/api/internal/clients/$CID2/share-token)
echo "$SR" | grep -q '"ok":true' && chk "share-revoke" y y || chk "share-revoke" y n
TS2=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT share_token t FROM clients WHERE id=?').get(Number('$CID2')).t)" 2>/dev/null)
[ "$TS2" = "null" ] && chk "share-token-cleared" y y || chk "share-token-cleared" y n
# 16. quick-add (meta over the wire, niche inferred from Shopify)
QA=$(curl -s -X POST "${AUTH[@]}" -d "{\"url\":\"https://smoke-qa-$STAMP.test\",\"meta\":{\"name\":\"Smoke QA\",\"url\":\"https://smoke-qa-$STAMP.test\",\"logoUrl\":\"https://smoke-qa-$STAMP.test/logo.png\",\"socialLinks\":{\"facebook\":\"https://facebook.com/smokeqa\"}},\"techStack\":[\"Shopify\"],\"precheck\":[]}" $B/api/internal/clients/quick-add)
QID=$(echo "$QA" | python3 -c "import json,sys;print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
[ -n "$QID" ] && chk "client-quick-add" y y || chk "client-quick-add" y n
QN=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare('SELECT niche n, social_links s FROM clients WHERE id=?').get(Number('$QID'));console.log(r.n+'|'+r.s)" 2>/dev/null)
[ "$QN" = 'ecommerce|{"facebook":"https://facebook.com/smokeqa"}' ] && chk "client-quick-add-niche-social" y y || chk "client-quick-add-niche-social" y n
# 17. delete + cascade cleanup (tasks of the client go with it)
curl -s -X POST "${AUTH[@]}" -d '{}' $B/api/internal/clients/$QID/delete > /dev/null
DL=$(curl -s -X POST "${AUTH[@]}" -d '{}' $B/api/internal/clients/$CID2/delete)
echo "$DL" | grep -q '"ok":true' && chk "client-delete" y y || chk "client-delete" y n
LEFT=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT COUNT(*) c FROM clients WHERE id IN (?,?)').get(Number('$CID2'),Number('$QID')).c)" 2>/dev/null)
[ "$LEFT" = "0" ] && chk "client-delete-gone" y y || chk "client-delete-gone" y n
TL=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT COUNT(*) c FROM tasks WHERE client_id=?').get(Number('$CID2')).c)" 2>/dev/null)
[ "$TL" = "0" ] && chk "client-delete-cascade-tasks" y y || chk "client-delete-cascade-tasks" y n
echo "----"
echo "PASS=$pass FAIL=$fail"
[ $fail -eq 0 ]
