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
CID=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get();console.log(r?r.id:'')" 2>/dev/null)
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

# ---- 14.6a: tools wave 1 (pure-DB tool actions, backend/src/tools_basic.rs) ----

# 18. token middleware covers the new family (401 without X-Internal-Token)
chk "tools-401-redirects" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/tools/redirects/add)"
chk "tools-401-robots" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/tools/robots-history/list)"

# 19. redirects add golden path + DB row (status_code default baked 301)
RA=$(curl -s -X POST "${AUTH[@]}" -d '{"sourcePath":"/smoke-old","targetUrl":"https://smoke.test/new","statusCode":301,"note":"smoke"}' $B/api/internal/tools/redirects/add)
echo "$RA" | grep -q '"ok":true' && chk "redirect-add" y y || chk "redirect-add" y n
RDB=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare(\"SELECT id, status_code s FROM redirect_rules WHERE source_path='/smoke-old' AND note='smoke' ORDER BY id DESC LIMIT 1\").get();console.log(r?r.id+'|'+r.s:'')" 2>/dev/null)
RID=$(echo "$RDB" | cut -d'|' -f1)
[ "$RDB" = "$RID|301" ] && chk "redirect-add-db" y y || chk "redirect-add-db" y n
# 20. redirects validation parity (hand-rolled action messages, 200 {ok:false})
RV1=$(curl -s -X POST "${AUTH[@]}" -d '{"sourcePath":"/x","targetUrl":"/y","statusCode":300}' $B/api/internal/tools/redirects/add)
echo "$RV1" | grep -q '"error":"Status code must be 301/302/307/308/410."' && chk "redirect-bad-status" y y || chk "redirect-bad-status" y n
RV2=$(curl -s -X POST "${AUTH[@]}" -d '{"sourcePath":"no-slash","targetUrl":"/y","statusCode":301}' $B/api/internal/tools/redirects/add)
echo "$RV2" | grep -q '"error":"Source path must start with /"' && chk "redirect-bad-source" y y || chk "redirect-bad-source" y n
RV3=$(curl -s -X POST "${AUTH[@]}" -d '{"sourcePath":"/x","targetUrl":"javascript:alert(1)","statusCode":301}' $B/api/internal/tools/redirects/add)
echo "$RV3" | grep -q '"error":"Target must be absolute URL or /-prefixed path."' && chk "redirect-bad-target" y y || chk "redirect-bad-target" y n
# 21. delete + idempotency (second delete still 200, row gone)
curl -s -X POST "${AUTH[@]}" -d "{\"id\":$RID}" $B/api/internal/tools/redirects/delete > /dev/null
RD2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"id\":$RID}" $B/api/internal/tools/redirects/delete)
[ "$RD2" = "200" ] && chk "redirect-delete-idempotent" y y || chk "redirect-delete-idempotent" y n
RG=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT COUNT(*) c FROM redirect_rules WHERE id=?\").get(Number('$RID')).c)" 2>/dev/null)
[ "$RG" = "0" ] && chk "redirect-delete-gone" y y || chk "redirect-delete-gone" y n

# 22. 404 record (hits upsert) -> resolve (rule + resolved flag) flow
P404="/smoke-404-$(date +%s)"
curl -s -X POST "${AUTH[@]}" -d "{\"sourcePath\":\"$P404\"}" $B/api/internal/tools/redirects/404/record > /dev/null
FR=$(curl -s -X POST "${AUTH[@]}" -d "{\"sourcePath\":\"$P404\"}" $B/api/internal/tools/redirects/404/record)
echo "$FR" | grep -q '"ok":true' && chk "404-record" y y || chk "404-record" y n
NDB=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare('SELECT id, hits h FROM not_found_log WHERE source_path=?').get('$P404');console.log(r?r.id+'|'+r.h:'')" 2>/dev/null)
NID=$(echo "$NDB" | cut -d'|' -f1)
[ "$NDB" = "$NID|2" ] && chk "404-record-hits2" y y || chk "404-record-hits2" y n
RZ=$(curl -s -X POST "${AUTH[@]}" -d "{\"id\":$NID,\"targetUrl\":\"/smoke-new\"}" $B/api/internal/tools/redirects/404/resolve)
echo "$RZ" | grep -q '"ok":true' && chk "404-resolve" y y || chk "404-resolve" y n
RZD=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare(\"SELECT target_url t, note n FROM redirect_rules WHERE source_path=? ORDER BY id DESC LIMIT 1\").get('$P404');const l=db.prepare('SELECT resolved rv, resolved_to_url u FROM not_found_log WHERE id=?').get(Number('$NID'));console.log(r?r.t+'|'+r.n+'|'+l.rv+'|'+l.u:'')" 2>/dev/null)
[ "$RZD" = "/smoke-new|Auto-created from 404 log (2 hits)|1|/smoke-new" ] && chk "404-resolve-db" y y || chk "404-resolve-db" y n
RN=$(curl -s -X POST "${AUTH[@]}" -d '{"id":999999999,"targetUrl":"/x"}' $B/api/internal/tools/redirects/404/resolve)
echo "$RN" | grep -q '"ok":false' && chk "404-resolve-notfound" y y || chk "404-resolve-notfound" y n
curl -s -X POST "${AUTH[@]}" -d "{\"id\":$NID}" $B/api/internal/tools/redirects/404/delete > /dev/null
FN2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"id\":$NID}" $B/api/internal/tools/redirects/404/delete)
[ "$FN2" = "200" ] && chk "404-delete-idempotent" y y || chk "404-delete-idempotent" y n

# 23. uptime add/toggle/delete + validation (+ NaN -> NOT NULL 500)
UA=$(curl -s -X POST "${AUTH[@]}" -d '{"url":"https://smoke-uptime.test","label":"smoke","expectedStatus":200,"expectedText":null}' $B/api/internal/tools/uptime/add)
echo "$UA" | grep -q '"ok":true' && chk "uptime-add" y y || chk "uptime-add" y n
UID2=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare(\"SELECT id, enabled e FROM uptime_targets WHERE url='https://smoke-uptime.test' ORDER BY id DESC LIMIT 1\").get();console.log(r?r.id+'|'+r.e:'')" 2>/dev/null)
UTID=$(echo "$UID2" | cut -d'|' -f1)
[ "$UID2" = "$UTID|1" ] && chk "uptime-add-db-enabled" y y || chk "uptime-add-db-enabled" y n
curl -s -X POST "${AUTH[@]}" -d "{\"id\":$UTID,\"enabled\":false}" $B/api/internal/tools/uptime/toggle > /dev/null
UE=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare('SELECT enabled e FROM uptime_targets WHERE id=?').get(Number('$UTID')).e)" 2>/dev/null)
[ "$UE" = "0" ] && chk "uptime-toggle-db" y y || chk "uptime-toggle-db" y n
UV1=$(curl -s -X POST "${AUTH[@]}" -d '{"url":"","expectedStatus":200}' $B/api/internal/tools/uptime/add)
echo "$UV1" | grep -q '"error":"URL required."' && chk "uptime-bad-url" y y || chk "uptime-bad-url" y n
UV2=$(curl -s -X POST "${AUTH[@]}" -d '{"url":"ftp://x.test","expectedStatus":200}' $B/api/internal/tools/uptime/add)
echo "$UV2" | grep -q '"error":"URL must start with http(s)://"' && chk "uptime-bad-scheme" y y || chk "uptime-bad-scheme" y n
chk "uptime-nan-status-500" 500 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"url":"https://x.test","expectedStatus":null}' $B/api/internal/tools/uptime/add)"
curl -s -X POST "${AUTH[@]}" -d "{\"id\":$UTID}" $B/api/internal/tools/uptime/delete > /dev/null
UD2=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"id\":$UTID}" $B/api/internal/tools/uptime/delete)
[ "$UD2" = "200" ] && chk "uptime-delete-idempotent" y y || chk "uptime-delete-idempotent" y n

# 24. person-schema save (tool_runs row) + validation parity
PSR=$(curl -s -X POST "${AUTH[@]}" -d '{"name":"Smoke Person","jsonld":"{\"@type\":\"Person\"}"}' $B/api/internal/tools/person-schema/save)
PRID=$(echo "$PSR" | python3 -c "import json,sys;print(json.load(sys.stdin).get('runId',''))" 2>/dev/null)
[ -n "$PRID" ] && chk "person-schema-save" y y || chk "person-schema-save" y n
PDB=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare('SELECT tool_id t, label l, input_json i, result_json r FROM tool_runs WHERE id=?').get(Number('$PRID'));console.log(r.t+'|'+r.l+'|'+r.i+'|'+r.r)" 2>/dev/null)
[ "$PDB" = 'person-schema|Smoke Person|{"name":"Smoke Person"}|{"jsonld":"{\"@type\":\"Person\"}"}' ] && chk "person-schema-db" y y || chk "person-schema-db" y n
PV1=$(curl -s -X POST "${AUTH[@]}" -d '{"name":"","jsonld":"x"}' $B/api/internal/tools/person-schema/save)
echo "$PV1" | grep -q '"error":"Person name is required."' && chk "person-schema-no-name" y y || chk "person-schema-no-name" y n
PV2=$(curl -s -X POST "${AUTH[@]}" -d '{"name":"x","jsonld":""}' $B/api/internal/tools/person-schema/save)
echo "$PV2" | grep -q '"error":"Generate the JSON-LD first."' && chk "person-schema-no-jsonld" y y || chk "person-schema-no-jsonld" y n

# 25. migration-map import (rows over the wire) + empty + NOT NULL failure
OA="/old-a-$(date +%s)"; OB="/old-b-$(date +%s)"
MM=$(curl -s -X POST "${AUTH[@]}" -d "{\"rows\":[{\"sourcePath\":\"$OA\",\"targetUrl\":\"/new-a\",\"note\":\"Auto-imported from migration map (90% confidence)\"},{\"sourcePath\":\"$OB\",\"targetUrl\":\"/new-b\",\"note\":\"Auto-imported from migration map (95% confidence)\"}]}" $B/api/internal/tools/migration-map/import)
echo "$MM" | grep -q '"inserted":2' && chk "migration-import-2" y y || chk "migration-import-2" y n
ME=$(curl -s -X POST "${AUTH[@]}" -d '{"rows":[]}' $B/api/internal/tools/migration-map/import)
echo "$ME" | grep -q '"inserted":0' && chk "migration-import-empty" y y || chk "migration-import-empty" y n
chk "migration-import-notnull-500" 500 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"rows":[{"targetUrl":"/x"}]}' $B/api/internal/tools/migration-map/import)"
MMN=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT COUNT(*) c FROM redirect_rules WHERE source_path IN ('$OA','$OB') AND status_code=301 AND note LIKE 'Auto-imported from migration map%'\").get().c)" 2>/dev/null)
[ "$MMN" = "2" ] && chk "migration-import-db" y y || chk "migration-import-db" y n

# 26. serp-features delete + idempotency (seed a row directly — runCapture stays Next)
SID=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');db.prepare(\"INSERT INTO serp_feature_snapshots (query, country) VALUES ('smoke serp 14.6a','US')\").run();console.log(db.prepare(\"SELECT id FROM serp_feature_snapshots WHERE query='smoke serp 14.6a' ORDER BY id DESC LIMIT 1\").get().id)" 2>/dev/null)
SD1=$(curl -s -X POST "${AUTH[@]}" -d "{\"id\":$SID}" $B/api/internal/tools/serp-features/delete)
echo "$SD1" | grep -q '"ok":true' && chk "serp-delete" y y || chk "serp-delete" y n
SD2=$(curl -s -X POST "${AUTH[@]}" -d "{\"id\":$SID}" $B/api/internal/tools/serp-features/delete)
echo "$SD2" | grep -q '"ok":true' && chk "serp-delete-idempotent" y y || chk "serp-delete-idempotent" y n

# 27. robots-history list: parseHost normalization + invalid host -> []
RHOST="smoke-robots-$(date +%s).test"
node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const ins=db.prepare('INSERT INTO robots_snapshots (hostname, content, content_hash) VALUES (?,?,?)');ins.run('$RHOST','User-agent: *','smokehash1');ins.run('$RHOST','User-agent: *\\nAllow: /','smokehash2')" 2>/dev/null
RL=$(curl -s -X POST "${AUTH[@]}" -d "{\"host\":\"$RHOST\"}" $B/api/internal/tools/robots-history/list)
echo "$RL" | python3 -c "import json,sys,re;d=json.load(sys.stdin);assert len(d)==2 and all(re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$', r['fetchedAt']) for r in d);assert sorted(r['contentHash'] for r in d)==['smokehash1','smokehash2']" 2>/dev/null && chk "robots-list-iso" y y || chk "robots-list-iso" y n
RL2=$(curl -s -X POST "${AUTH[@]}" -d "{\"host\":\"https://$(echo $RHOST | tr a-z A-Z)/some/path\"}" $B/api/internal/tools/robots-history/list)
echo "$RL2" | python3 -c "import json,sys;assert len(json.load(sys.stdin))==2" 2>/dev/null && chk "robots-list-host-norm" y y || chk "robots-list-host-norm" y n
RL3=$(curl -s -X POST "${AUTH[@]}" -d '{"host":"!!!"}' $B/api/internal/tools/robots-history/list)
[ "$RL3" = "[]" ] && chk "robots-list-invalid-host" y y || chk "robots-list-invalid-host" y n

# 28. settings set/delete (bing + youtube keys share the settings-store path)
SS=$(curl -s -X POST "${AUTH[@]}" -d '{"key":"bing.api_key","value":"smoke-key-123"}' $B/api/internal/tools/settings/set)
echo "$SS" | grep -q '"ok":true' && chk "settings-set" y y || chk "settings-set" y n
SV=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT value v FROM workspace_settings WHERE key='bing.api_key'\").get().v)" 2>/dev/null)
[ "$SV" = '"smoke-key-123"' ] && chk "settings-set-json-text" y y || chk "settings-set-json-text" y n
curl -s -X POST "${AUTH[@]}" -d '{"key":"bing.api_key","value":"smoke-key-456"}' $B/api/internal/tools/settings/set > /dev/null
SV2=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT value v FROM workspace_settings WHERE key='bing.api_key'\").get().v)" 2>/dev/null)
[ "$SV2" = '"smoke-key-456"' ] && chk "settings-set-upsert" y y || chk "settings-set-upsert" y n
curl -s -X POST "${AUTH[@]}" -d '{"key":"youtube.api_key","value":"smoke-yt"}' $B/api/internal/tools/settings/set > /dev/null
SY=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT value v FROM workspace_settings WHERE key='youtube.api_key'\").get().v)" 2>/dev/null)
[ "$SY" = '"smoke-yt"' ] && chk "settings-youtube-key" y y || chk "settings-youtube-key" y n
curl -s -X POST "${AUTH[@]}" -d '{"key":"bing.api_key"}' $B/api/internal/tools/settings/delete > /dev/null
curl -s -X POST "${AUTH[@]}" -d '{"key":"youtube.api_key"}' $B/api/internal/tools/settings/delete > /dev/null
SG=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');console.log(db.prepare(\"SELECT COUNT(*) c FROM workspace_settings WHERE key IN ('bing.api_key','youtube.api_key')\").get().c)" 2>/dev/null)
[ "$SG" = "0" ] && chk "settings-delete-gone" y y || chk "settings-delete-gone" y n
SDX=$(curl -s -X POST "${AUTH[@]}" -d '{"key":"bing.api_key"}' $B/api/internal/tools/settings/delete)
echo "$SDX" | grep -q '"ok":true' && chk "settings-delete-idempotent" y y || chk "settings-delete-idempotent" y n

# ---- 14.6b: tools wave 2 (COMPUTE tool actions, backend/src/tools_compute.rs) ----

# 29. token middleware covers the compute family (401 without X-Internal-Token)
chk "compute-401-utm" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/tools/utm-attribution/run)"
chk "compute-401-map" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/tools/migration-map/run)"

# 30. utm-attribution golden path — REAL pasted CSV, outputs hand-traced from
# the original TypeScript action (channels[3]=Direct before Email: the
# last-touch insertion precedes the assisted loop in the source).
UTM_FIX='timestamp,source,medium,campaign,userId,isConversion\r\n2024-01-01T00:00:00.000Z,google,cpc,Brand,u1,1\r\n2024-01-02T00:00:00.000Z,google,organic,Brand,u1,\r\n2024-01-03T00:00:00.000Z,"facebook",paid_social,Spring,u2,1\r\n2024-01-04T00:00:00.000Z,newsletter,email,Launch,u2,\r\n2024-01-05T00:00:00.000Z,,(none),Direct,u2,\r\n'
UTM=$(python3 -c "
import json,urllib.request
req=urllib.request.Request('$B/api/internal/tools/utm-attribution/run',data=json.dumps({'touches':'$UTM_FIX'}).encode(),headers={'X-Internal-Token':'$TOKEN','Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
")
echo "$UTM" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["ok"] is True, d
r=d["result"]
assert (r["totalTouches"],r["totalConversions"],r["uniqueUsers"])==(5,2,2), r
names=[c["channel"] for c in r["channels"]]
assert names==["Paid Search","Organic Search","Paid Social","Direct","Email"], names
assert r["channels"][0]["linearCredit"]==0.5 and r["channels"][0]["positionCredit"]==0.5 and r["channels"][0]["pathInclusion"]==1
assert r["channels"][3]["linearCredit"]==0.33 and r["channels"][3]["positionCredit"]==0.4
assert r["channels"][4]["assistedTouches"]==1 and r["channels"][4]["positionCredit"]==0.2
assert r["topPaths"][0]=={"path":["Paid Search","Organic Search"],"count":1}, r["topPaths"]
assert r["averagePathLength"]==2.5
' 2>/dev/null && chk "utm-golden" y y || chk "utm-golden" y n

# 31. utm validation parity (200 {ok:false} envelopes, direct-caller defense)
UV=$(curl -s -X POST "${AUTH[@]}" -d '{"touches":""}' $B/api/internal/tools/utm-attribution/run)
echo "$UV" | grep -q '"error":"Paste touch data first."' && chk "utm-empty" y y || chk "utm-empty" y n
UV2=$(curl -s -X POST "${AUTH[@]}" -d '{"touches":"just-one-cell"}' $B/api/internal/tools/utm-attribution/run)
echo "$UV2" | grep -q '"error":"Couldn'"'"'t parse any touches."' && chk "utm-unparsable" y y || chk "utm-unparsable" y n

# 32. utm tool_runs write (saveToolRun port: label, input.lineCount, result)
UTMDB=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare(\"SELECT tool_id t, label l, input_json i, result_json r FROM tool_runs WHERE tool_id='utm-attribution' ORDER BY id DESC LIMIT 1\").get();console.log(r?r.t+'|'+r.l+'|'+r.i:'')" 2>/dev/null)
[ "$UTMDB" = "utm-attribution|2 conversions · 2 users|{\"lineCount\":6}" ] && chk "utm-tool-run-db" y y || chk "utm-tool-run-db" y n
echo "$UTMDB" | grep -q '|{"lineCount":6}$' && echo "$UTM" | grep -q '"totalTouches":5' && chk "utm-tool-run-result" y y || chk "utm-tool-run-result" y n

# 33. migration-map golden path — REAL URL lists, expected values verified
# against buildMigrationMap/renderRedirectMap (parity harness 3/3 identical).
MAPR=$(python3 -c "
import json,urllib.request
def shape(u):
    return {'url':u,'pathname':u,'search':'','ok':True}
olds=['/old-blog/my-post.html','/blog/my-post','/contact','/legacy-page','/products/red-shoes']
news=['/blog/my-post','/contact-us','/products/red-shoes-sneakers','/about']
req=urllib.request.Request('$B/api/internal/tools/migration-map/run',data=json.dumps({'olds':[shape(u) for u in olds],'news':[shape(u) for u in news]}).encode(),headers={'X-Internal-Token':'$TOKEN','Content-Type':'application/json'})
print(urllib.request.urlopen(req).read().decode())
")
echo "$MAPR" | python3 -c '
import json,sys
d=json.load(sys.stdin)
assert d["ok"] is True, d
m=d["map"]
assert m["summary"]=={"total":5,"matched":2,"review":1,"avgConfidence":0.61}, m["summary"]
r=m["rows"]
assert r[0]["newUrl"]=="/blog/my-post" and r[0]["confidence"]==0.9125 and r[0]["reason"]=="Shared: blog, my, post (91%)", r[0]
assert r[1]["confidence"]==1 and r[1]["reason"]=="Exact path match", r[1]
assert r[2]["newUrl"] is None and r[2]["confidence"]==0.425 and r[2]["reason"]=="No confident match — pick a category or 410", r[2]
assert r[4]["newUrl"]=="/products/red-shoes-sneakers" and r[4]["confidence"]==0.7125 and r[4]["reason"]=="Shared: products, red, shoes (71%) — review", r[4]
o=d["output"]
assert o["nginx"].split("\n")[0]=="rewrite ^/old-blog/my-post\\.html$ /blog/my-post permanent;", o["nginx"]
assert o["apache"].split("\n")[0]=="Redirect 301 /old-blog/my-post.html /blog/my-post", o["apache"]
assert "{ source: \"/blog/my-post\", destination: \"/blog/my-post\", permanent: true }," in o["nextjs"]
assert o["nextjs"].startswith("module.exports = {") and o["nextjs"].endswith("};")
' 2>/dev/null && chk "migration-golden" y y || chk "migration-golden" y n
# 34. migration validation parity (missing/empty lists, 200 {ok:false})
MV1=$(curl -s -X POST "${AUTH[@]}" -d '{}' $B/api/internal/tools/migration-map/run)
echo "$MV1" | grep -q '"error":"Paste old URLs (one per line)."' && chk "migration-no-olds" y y || chk "migration-no-olds" y n
MV2=$(curl -s -X POST "${AUTH[@]}" -d '{"olds":[{"url":"/a","pathname":"/a","search":"","ok":true}],"news":[]}' $B/api/internal/tools/migration-map/run)
echo "$MV2" | grep -q '"error":"Paste new URLs (one per line)."' && chk "migration-no-news" y y || chk "migration-no-news" y n

# 35. migration tool_runs write (label "N → M URLs · K matched", input counts)
MAPDB=$(node -e "const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');const r=db.prepare(\"SELECT tool_id t, label l, input_json i FROM tool_runs WHERE tool_id='migration-map' ORDER BY id DESC LIMIT 1\").get();console.log(r?r.t+'|'+r.l+'|'+r.i:'')" 2>/dev/null)
[ "$MAPDB" = "migration-map|5 → 4 URLs · 5 matched|{\"oldCount\":5,\"newCount\":4}" ] && chk "migration-tool-run-db" y y || chk "migration-tool-run-db" y n
echo "$MAPR" | grep -q '"matched":2' && chk "migration-tool-run-result" y y || chk "migration-tool-run-result" y n

# ---- 14.7a: query gateway (backend/src/query.rs — drizzle sqlite-proxy read path) ----

# 36. token middleware covers the gateway (401 without X-Internal-Token)
chk "query-401" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"sql":"SELECT 1"}' $B/api/internal/query)"

# 37. SELECT roundtrip incl. params — positional rows, columns, value types
Q1=$(curl -s -X POST "${AUTH[@]}" -d "{\"sql\":\"SELECT id, name FROM clients WHERE id = ?\",\"params\":[$CID]}" $B/api/internal/query)
echo "$Q1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d['ok'] is True, d
assert d['columns']==['id','name'], d['columns']
assert len(d['rows'])==1 and isinstance(d['rows'][0][0],int) and isinstance(d['rows'][0][1],str), d['rows']
assert d['rows'][0][1]=='Seed Client', d['rows']
" 2>/dev/null && chk "query-select-params" y y || chk "query-select-params" y n

# 38. readonly guard (authoritative sqlite3_stmt_readonly) → 403
chk "query-403-insert" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"INSERT INTO clients (name, url) VALUES (''x'',''y'')"}' $B/api/internal/query)"
chk "query-403-update" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"UPDATE clients SET name=''x''"}' $B/api/internal/query)"
chk "query-403-delete" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"DELETE FROM clients"}' $B/api/internal/query)"
chk "query-403-drop" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"DROP TABLE clients"}' $B/api/internal/query)"
chk "query-403-pragma" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"PRAGMA journal_mode"}' $B/api/internal/query)"
# WITH-smuggled write passes the textual guard, is caught by stmt.readonly()
chk "query-403-with-delete" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"WITH x AS (SELECT 1) DELETE FROM clients"}' $B/api/internal/query)"

# 39. multi-statement textual reject → 403
chk "query-403-multistmt" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"SELECT 1; SELECT 2"}' $B/api/internal/query)"
chk "query-403-trailing-junk" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"SELECT 1; DROP TABLE clients"}' $B/api/internal/query)"

# 40. WITH cte allowed (positional rows)
Q2=$(curl -s -X POST "${AUTH[@]}" -d '{"sql":"WITH cte AS (SELECT 1 AS x) SELECT * FROM cte"}' $B/api/internal/query)
echo "$Q2" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d['ok'] is True and d['columns']==['x'] and d['rows']==[[1]], d
" 2>/dev/null && chk "query-with-cte" y y || chk "query-with-cte" y n

# 41. value types: NULL / REAL / INTEGER / TEXT / bool→1 (JSON surface)
Q3=$(curl -s -X POST "${AUTH[@]}" -d '{"sql":"SELECT ? AS n, ? AS r, ? AS t, ? AS i, ? AS b","params":[null,1.5,"txt",7,true]}' $B/api/internal/query)
echo "$Q3" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d['ok'] is True, d
row=d['rows'][0]
assert row[0] is None and isinstance(row[1],float) and row[1]==1.5, row
assert isinstance(row[2],str) and row[2]=='txt', row
assert isinstance(row[3],int) and not isinstance(row[3],bool) and row[3]==7, row
assert row[4]==1 and isinstance(row[4],int), row
" 2>/dev/null && chk "query-value-types" y y || chk "query-value-types" y n

# 42. body contract: non-array params → 400, empty sql → 400
chk "query-400-bad-params" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"SELECT 1","params":"x"}' $B/api/internal/query)"
chk "query-400-empty-sql" 400 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":""}' $B/api/internal/query)"

# 43. prepare failure → 500 ok:false (bare sqlite message, db_error_response envelope)
Q4=$(curl -s -w '|%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"SELECT * FROM missing_table_xyz"}' $B/api/internal/query)
echo "$Q4" | grep -q '|500$' && echo "$Q4" | grep -q '"ok":false,"error":"no such table' && chk "query-500-missing-table" y y || chk "query-500-missing-table" y n

# ---- 14.8a: CSV exports (backend/src/exports.rs + client_scope.rs) ----
# Golden-fixture protocol: seed-14.8.ts re-creates the deterministic FIX148
# rows under fixed ids (9901+) and removes the wall-clock rows the earlier
# sections of THIS run leave behind (Smoke Client/smoke-qa clients,
# smoke-ahrefs backlinks), so each endpoint's output must byte-match the
# fixture captured from the ORIGINAL Next implementation before the port
# (backend/fixtures/14.8/*.csv).

# 44. token middleware covers the exports family
chk "exports-401-clients" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/exports/clients)"
chk "exports-401-backlinks" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/exports/backlinks)"

# 45. re-seed (idempotent: DELETE marker rows by id/prefix, INSERT same ids)
(cd "$ROOT" && bun run backend/tools/seed-14.8.ts) > /dev/null 2>&1

# 46. envelope contract + byte-compare vs golden fixtures (4 endpoints)
for r in clients competitors audits backlinks; do
  curl -s -X POST "${AUTH[@]}" -d '{}' "$B/api/internal/exports/$r" | FIX="$ROOT/backend/fixtures/14.8/$r.csv" R="$r" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
assert d['ok'] is True, d
assert d['filename']==os.environ['R']+'.csv', d['filename']
assert d['contentType']=='text/csv; charset=utf-8', d['contentType']
assert d['disposition']=='attachment; filename=\"%s.csv\"' % os.environ['R'], d['disposition']
open('/tmp/14.8-'+os.environ['R']+'.csv','w').write(d['csv'])
" 2>/dev/null
  if [ -f "/tmp/14.8-$r.csv" ] && cmp -s "/tmp/14.8-$r.csv" "$ROOT/backend/fixtures/14.8/$r.csv"; then
    chk "export-fixture-$r" y y
  else
    chk "export-fixture-$r" y n
  fi
  rm -f "/tmp/14.8-$r.csv"
done

# 47. client scope port (visibleClientIds/exportScope semantics).
# Temp users are created and deleted inside this block — while they exist
# the Next process must NOT be asked to render gated pages (its
# accountsEnabled() cache would flip for the process lifetime).
SCOPE_ENV=$(node -e "
const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');
db.pragma('journal_mode = WAL');
db.prepare('DELETE FROM client_members WHERE user_id BETWEEN 9801 AND 9803').run();
db.prepare('DELETE FROM users WHERE id BETWEEN 9801 AND 9803').run();
const u=db.prepare('INSERT INTO users (id, email, password_hash, role, active, created_at) VALUES (?,?,?,?,1,1700000300)');
u.run(9801,'fix148-smoke-empty@test.local','scrypt:1:aa:bb','member');
u.run(9802,'fix148-smoke-assigned@test.local','scrypt:1:aa:bb','member');
u.run(9803,'fix148-smoke-owner@test.local','scrypt:1:aa:bb','owner');
db.prepare('INSERT INTO client_members (user_id, client_id, created_at) VALUES (9802, 1, 1700000300)').run();
" 2>/dev/null)
# header WITHOUT trailing newline (csv lines join "\n", no trailing byte)
printf '%s' "$(head -n 1 "$ROOT/backend/fixtures/14.8/clients.csv")" > /tmp/14.8-clients-header.csv
# 47a. member with NO assignments → IN(-1) → header-only CSV
curl -s -X POST "${AUTH[@]}" -d '{"userId":9801}' "$B/api/internal/exports/clients" | python3 -c "
import json,sys
d=json.load(sys.stdin)
open('/tmp/14.8-scope-empty.csv','w').write(d['csv'])
" 2>/dev/null
cmp -s /tmp/14.8-scope-empty.csv /tmp/14.8-clients-header.csv && chk "exports-scope-empty-in-minus-1" y y || chk "exports-scope-empty-in-minus-1" y n
# 47b. member assigned client 1 sees exactly the clientId=1 slice (IN(ids))
curl -s -X POST "${AUTH[@]}" -d '{"userId":9802}' "$B/api/internal/exports/audits" | python3 -c "
import json,sys
open('/tmp/14.8-scope-member.csv','w').write(json.load(sys.stdin)['csv'])
" 2>/dev/null
curl -s -X POST "${AUTH[@]}" -d '{"clientId":1}' "$B/api/internal/exports/audits" | python3 -c "
import json,sys
open('/tmp/14.8-scope-c1.csv','w').write(json.load(sys.stdin)['csv'])
" 2>/dev/null
cmp -s /tmp/14.8-scope-member.csv /tmp/14.8-scope-c1.csv && chk "exports-scope-member-in-ids" y y || chk "exports-scope-member-in-ids" y n
# 47c. owner → unrestricted, byte-identical to the anonymous (no userId) call
curl -s -X POST "${AUTH[@]}" -d '{"userId":9803}' "$B/api/internal/exports/clients" | python3 -c "
import json,sys
open('/tmp/14.8-scope-owner.csv','w').write(json.load(sys.stdin)['csv'])
" 2>/dev/null
curl -s -X POST "${AUTH[@]}" -d '{}' "$B/api/internal/exports/clients" | python3 -c "
import json,sys
open('/tmp/14.8-scope-anon.csv','w').write(json.load(sys.stdin)['csv'])
" 2>/dev/null
cmp -s /tmp/14.8-scope-owner.csv /tmp/14.8-scope-anon.csv && chk "exports-scope-owner-unrestricted" y y || chk "exports-scope-owner-unrestricted" y n
# 47d. direct-caller sentinel: clientId -1 (proxy's normalization of any
# unparseable raw param) → always-false filter → header-only
curl -s -X POST "${AUTH[@]}" -d '{"clientId":-1}' "$B/api/internal/exports/clients" | python3 -c "
import json,sys
open('/tmp/14.8-scope-sentinel.csv','w').write(json.load(sys.stdin)['csv'])
" 2>/dev/null
cmp -s /tmp/14.8-scope-sentinel.csv /tmp/14.8-clients-header.csv && chk "exports-sentinel-header-only" y y || chk "exports-sentinel-header-only" y n
node -e "
const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');
db.prepare('DELETE FROM client_members WHERE user_id BETWEEN 9801 AND 9803').run();
db.prepare('DELETE FROM users WHERE id BETWEEN 9801 AND 9803').run();
console.log(db.prepare('SELECT COUNT(*) n FROM users').get().n);
" > /tmp/14.8-users-left.txt 2>/dev/null
[ "$(cat /tmp/14.8-users-left.txt 2>/dev/null)" = "0" ] && chk "exports-scope-users-cleaned" y y || chk "exports-scope-users-cleaned" y n
rm -f /tmp/14.8-scope-*.csv /tmp/14.8-clients-header.csv /tmp/14.8-users-left.txt

# 48. disallowed writes on the query gateway still 403 (14.8 didn't touch it)
chk "exports-query-gateway-403-still" 403 "$(curl -s -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"sql":"INSERT INTO clients (name, url) VALUES (''x'',''y'')"}' $B/api/internal/query)"

# ---- 14.8b: CSV exports wave 2 (tasks/outreach/reports/monitor/keywords/disavow) ----
# Same golden-fixture protocol as 14.8a: seed-14.8.ts's FIX148B wave
# (tasks 9911+, outreach 9921+, reports 9931+, pages 9941+/changes 9951+,
# keywords 9961+/rankings 9971+, disavow backlinks 9981+) is deterministic
# and the fixtures were captured from the ORIGINAL Next implementations
# BEFORE the swap. The disavow body embeds a wall-clock `# Generated:` line
# on BOTH sides — the compare normalizes that one line (format parity is
# asserted separately via the 24-char ISO shape).

# 49. token middleware covers the wave-2 exports family
chk "exports-401-tasks" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/exports/tasks)"
chk "exports-401-disavow" 401 "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{}' $B/api/internal/exports/disavow)"

# 50. re-seed (idempotent FIX148 + FIX148B waves; also removes this run's
# wall-clock "smoke task" from section 3 so tasks.csv stays deterministic)
(cd "$ROOT" && bun run backend/tools/seed-14.8.ts) > /dev/null 2>&1

# 51. envelope contract + byte-compare vs golden fixtures (4 plain CSV routes;
# monitor's envelope filename is page-changes.csv — fixture file monitor.csv)
for r in tasks outreach reports monitor; do
  case "$r" in monitor) FNAME=page-changes.csv ;; *) FNAME="$r.csv" ;; esac
  curl -s -X POST "${AUTH[@]}" -d '{}' "$B/api/internal/exports/$r" | FIX="$ROOT/backend/fixtures/14.8/$r.csv" R="$r" FNAME="$FNAME" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
assert d['ok'] is True, d
assert d['filename']==os.environ['FNAME'], d['filename']
assert d['contentType']=='text/csv; charset=utf-8', d['contentType']
assert d['disposition']=='attachment; filename=\"%s\"' % os.environ['FNAME'], d['disposition']
open('/tmp/14.8b-'+os.environ['R']+'.csv','w').write(d['csv'])
" 2>/dev/null
  if [ -f "/tmp/14.8b-$r.csv" ] && cmp -s "/tmp/14.8b-$r.csv" "$ROOT/backend/fixtures/14.8/$r.csv"; then
    chk "export-fixture-$r" y y
  else
    chk "export-fixture-$r" y n
  fi
done

# 52. keywords: envelope (filename carries the CURRENT UTC date) + byte-compare
KWDATE=$(date -u +%F)
curl -s -X POST "${AUTH[@]}" -d '{}' "$B/api/internal/exports/keywords" | KWDATE="$KWDATE" python3 -c "
import json,sys,os
d=json.load(sys.stdin)
assert d['ok'] is True, d
expect='keywords-'+os.environ['KWDATE']+'.csv'
assert d['filename']==expect, (d['filename'], expect)
assert d['contentType']=='text/csv; charset=utf-8', d['contentType']
assert d['disposition']=='attachment; filename=\"%s\"' % expect, d['disposition']
open('/tmp/14.8b-keywords.csv','w').write(d['csv'])
" 2>/dev/null
KWOK=$([ -f /tmp/14.8b-keywords.csv ] && cmp -s /tmp/14.8b-keywords.csv "$ROOT/backend/fixtures/14.8/keywords.csv" && echo y || echo n)
chk "export-fixture-keywords" y "$KWOK"

# 53. keywords latest-row fold: the DB really has two rankings for keyword
# 9962 with ascending checked_at, and the CSV fold picked the LATER row
# (position 3, https://rank.test/new — not 12/old).
FOLD_DB=$(node -e "
const db=require('$ROOT/node_modules/better-sqlite3')('$ROOT/data.db');
const a=db.prepare('SELECT checked_at FROM keyword_rankings WHERE id=9971').get();
const b=db.prepare('SELECT checked_at FROM keyword_rankings WHERE id=9972').get();
console.log(b.checked_at > a.checked_at ? 'y' : 'n');
" 2>/dev/null)
FOLD_CSV=$(grep -c 'Seed Client,https://seed.test,"FIX148 ""quoted"", comma query",US,mobile,3,https://rank.test/new' /tmp/14.8b-keywords.csv 2>/dev/null || true)
[ "$FOLD_DB" = "y" ] && [ "$FOLD_CSV" = "1" ] && chk "keywords-fold-latest-row" y y || chk "keywords-fold-latest-row" y n

# 54. bespoke-escape \r semantics: the keywords route's local csvEscape has
# trigger class [",\n] — a LONE \r must NOT quote (canonical routes DO).
BESPOKE=$(grep -cF $'FIX148 pure CR\rquery,' /tmp/14.8b-keywords.csv 2>/dev/null || true)
CANON=$(grep -cF $'"FIX148 title with CR\ronly"' /tmp/14.8b-tasks.csv 2>/dev/null || true)
grep -cF $'"FIX148 pure CR' /tmp/14.8b-keywords.csv > /dev/null 2>&1 && BESPOKE_UNQUOTED_ONLY=0 || BESPOKE_UNQUOTED_ONLY=1
[ "$BESPOKE" = "1" ] && [ "$CANON" = "1" ] && [ "$BESPOKE_UNQUOTED_ONLY" = "1" ] \
  && chk "bespoke-escape-cr-unquoted-canonical-quoted" y y || chk "bespoke-escape-cr-unquoted-canonical-quoted" y n
rm -f /tmp/14.8b-tasks.csv /tmp/14.8b-outreach.csv /tmp/14.8b-reports.csv /tmp/14.8b-monitor.csv /tmp/14.8b-keywords.csv

# 55. disavow: envelope + both variants byte-compared (Generated normalized)
curl -s -X POST "${AUTH[@]}" -d '{}' "$B/api/internal/exports/disavow" > /tmp/14.8b-disavow-all.json
curl -s -X POST "${AUTH[@]}" -d '{"clientId":1,"filename":"disavow-client-1.txt"}' "$B/api/internal/exports/disavow" > /tmp/14.8b-disavow-c1.json
python3 - <<'PYEOF' 2>/dev/null
import json
d=json.load(open('/tmp/14.8b-disavow-all.json'))
assert d['ok'] is True and d['filename']=='disavow-all.txt', d['filename']
assert d['contentType']=='text/plain; charset=utf-8', d['contentType']
assert d['disposition']=='attachment; filename="disavow-all.txt"', d['disposition']
body=d['csv']
assert body.split('\n')[1].startswith('# Generated: ') and len(body.split('\n')[1])==37, body.split('\n')[1]
assert body.endswith('\n') and not body.endswith('\n\n'), repr(body[-3:])
open('/tmp/14.8b-disavow.txt','w').write(body)
d=json.load(open('/tmp/14.8b-disavow-c1.json'))
assert d['ok'] is True and d['filename']=='disavow-client-1.txt', d['filename']
open('/tmp/14.8b-disavow-client-1.txt','w').write(d['csv'])
PYEOF
for v in "disavow:disavow-all" "disavow-client-1:disavow-client-1"; do
  file="${v%%:*}"; name="${v##*:}"
  if [ -f "/tmp/14.8b-$file.txt" ]; then
    sed -E 's/^# Generated: .*$/# Generated: X/' "/tmp/14.8b-$file.txt" > "/tmp/14.8b-$file.norm"
    sed -E 's/^# Generated: .*$/# Generated: X/' "$ROOT/backend/fixtures/14.8/$file.txt" > "/tmp/14.8b-$file.fixture.norm"
    cmp -s "/tmp/14.8b-$file.norm" "/tmp/14.8b-$file.fixture.norm" && chk "export-fixture-$name" y y || chk "export-fixture-$name" y n
  else
    chk "export-fixture-$name" y n
  fi
done

# 56. disavow grouping: the duplicate source_domain rows collapse — the
# preamble must count 6 disavow entries across 5 domains, AAA-first first
# (localeCompare fold: byte order would put Spam-A before fix148), the
# multi-line notes collapsed to ONE space, and the 'active' row excluded.
GROUP=$(grep -cF '# 6 entries across 5 domains' "/tmp/14.8b-disavow.txt" 2>/dev/null || true)
FOLD=$(grep -cF 'domain:AAA-first.test' "/tmp/14.8b-disavow.txt" 2>/dev/null || true)
NOTES=$(grep -cF '# Spam ring, "bad" second line =lead' "/tmp/14.8b-disavow.txt" 2>/dev/null || true)
ACTIVE=$(grep -cF 'domain:keep.test' "/tmp/14.8b-disavow.txt" 2>/dev/null || true)
[ "$GROUP" = "1" ] && [ "$FOLD" = "1" ] && [ "$NOTES" = "1" ] && [ "$ACTIVE" = "0" ] \
  && chk "disavow-grouping-fold-filter" y y || chk "disavow-grouping-fold-filter" y n

# 57. disavow scope slice: clientId=9901 → exactly that client's disavowed
# backlinks (1 entry / 1 domain — spam-b.test; 14.8a's fix148 row belongs
# to client 9902).
curl -s -X POST "${AUTH[@]}" -d '{"clientId":9901,"filename":"disavow-client-9901.txt"}' "$B/api/internal/exports/disavow" | python3 -c "
import json,sys
d=json.load(sys.stdin)
assert d['filename']=='disavow-client-9901.txt', d['filename']
open('/tmp/14.8b-disavow-9901.txt','w').write(d['csv'])
" 2>/dev/null
S1=$(grep -cF '# 1 entries across 1 domains' /tmp/14.8b-disavow-9901.txt 2>/dev/null || true)
S2=$(grep -cF 'domain:spam-b.test' /tmp/14.8b-disavow-9901.txt 2>/dev/null || true)
[ "$S1" = "1" ] && [ "$S2" = "1" ] && chk "disavow-scope-client-slice" y y || chk "disavow-scope-client-slice" y n
rm -f /tmp/14.8b-disavow*.json /tmp/14.8b-disavow*.txt /tmp/14.8b-*.norm /tmp/14.8b-*.fixture.norm

echo "----"
echo "PASS=$pass FAIL=$fail"
[ $fail -eq 0 ]
