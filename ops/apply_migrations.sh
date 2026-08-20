#!/bin/bash
set -e
cd /opt/shishka
source /root/shishka-local-db.env
PROD_URL=$(echo "$LOCAL_URL" | sed 's|/shishka$|/shishka_prod|')

for f in db/migration_rls_extended.sql db/migration_fk_indexes.sql db/migration_cleanup.sql \
         db/migration_daily_tasks.sql db/migration_sync_tasks_daily.sql \
         db/migration_deepseek_catchup.sql db/migration_card_unseen.sql \
         db/migration_auth.sql db/migration_referrals.sql db/migration_referral_levels.sql \
         db/migration_referral_l3.sql          db/migration_album_trade_gifts.sql \
         db/migration_friendships.sql \
         db/migration_cross_circle_friends.sql \
         db/migration_friend_cards.sql \
         db/migration_forest_mail.sql; do
  echo "=== $f ==="
  psql "$PROD_URL" -v ON_ERROR_STOP=1 -f "$f"
  echo "OK"
done
echo "ALL MIGRATIONS DONE"
