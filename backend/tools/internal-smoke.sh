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

echo "----"
echo "PASS=$pass FAIL=$fail"
[ $fail -eq 0 ]
