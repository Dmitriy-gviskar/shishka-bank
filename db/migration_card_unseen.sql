-- Плашки «новинка» в альбоме: seen_at is null = ещё не открывали в детали.
-- Уже собранное при первом прогоне помечаем просмотренным.

alter table user_cards add column if not exists seen_at timestamptz;

do $$
begin
  -- первый прогон: колонка пустая у всех → засеять; повторный — не трогать реальные новинки
  if not exists (select 1 from user_cards where seen_at is not null) then
    update user_cards set seen_at = coalesce(first_at, now());
  end if;
end $$;
