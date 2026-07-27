#!/bin/bash
set -e
cd /opt/shishka
source /root/shishka-local-db.env
PROD_URL=$(echo "$LOCAL_URL" | sed 's|/shishka$|/shishka_prod|')

for f in db/migration_rls_extended.sql db/migration_fk_indexes.sql db/migration_cleanup.sql; do
  echo "=== $f ==="
  psql "$PROD_URL" -v ON_ERROR_STOP=1 -f "$f"
  echo "OK"
done
echo "ALL MIGRATIONS DONE"
