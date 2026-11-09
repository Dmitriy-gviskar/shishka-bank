-- Шишка Банк — недостающие FK-индексы.
-- Все индексы частичные (where col is not null) — экономят место,
-- не индексируя NULL (from_user = NULL для эмиссии).

-- transactions: ~80% запросов фильтруют по from_user/to_user (история, метрики, расследования)
create index if not exists idx_tx_from on transactions(from_user) where from_user is not null;
create index if not exists idx_tx_to   on transactions(to_user)   where to_user is not null;

-- safes: redeem_safe(), check_achievements, метрики deposits_count/deposits_closed
create index if not exists idx_safes_user on safes(user_id);

-- badges: award_badge upsert + любой список бейджей
create index if not exists idx_badges_user on badges(user_id);

-- orders: on delete restrict требует сканирования при удалении shop_lot
create index if not exists idx_orders_lot on orders(lot_id);

-- user_achievements: проверка при награждении
create index if not exists idx_uach_code on user_achievements(code);

-- card_listings: P2P-рынок — фильтры по продавцу и покупателю
create index if not exists idx_cl_seller on card_listings(seller_id) where seller_id is not null;
create index if not exists idx_cl_buyer  on card_listings(buyer_id)  where buyer_id is not null;

-- daily_quests / daily_horoscopes: unique уже есть, но явный индекс на child_id
-- помогает join'ам, не полагаясь на порядок столбцов в unique
create index if not exists idx_dq_child  on daily_quests(child_id);
create index if not exists idx_dh_child  on daily_horoscopes(child_id);

-- shops: фильтр по owner_id для проверки «моя лавка»
create index if not exists idx_shops_owner on shops(owner_id);

-- shop_lots: список лотов конкретной лавки
create index if not exists idx_lots_shop on shop_lots(shop_id) where is_active;

-- guild_members: проверка членства
create index if not exists idx_gm_user on guild_members(user_id);
