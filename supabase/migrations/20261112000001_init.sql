-- Музей обычных вещей — начальная схема.
-- Принцип: браузер (anon/authenticated) не имеет прямого доступа ни к таблицам, ни к файлам.
-- Всё идёт через Edge Functions, которые сами проверяют входные данные и полномочия.

-- ─────────────────────────────────────────────────────────────
-- Экспонаты
-- ─────────────────────────────────────────────────────────────
create type public.exhibit_status as enum ('pending', 'approved', 'rejected');

-- Номер выдаётся только при одобрении, поэтому по номерам нельзя
-- оценить, сколько записей ждёт проверки. Пропуски допустимы.
create sequence public.exhibit_inventory_seq start 1;

create table public.exhibits (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null unique,          -- ключ идемпотентности от формы
  inventory_number integer unique,                -- «№ 0042», только у одобренных
  title            text not null check (char_length(title) between 2 and 80),
  story            text not null check (char_length(story) between 20 and 1500),
  author_name      text check (author_name is null or char_length(author_name) between 1 and 50),
  kept_since       text check (kept_since is null or char_length(kept_since) between 1 and 80),
  image_alt        text not null check (char_length(image_alt) between 1 and 200),
  -- Путь генерирует сервер. Формат жёстко ограничен: никаких пользовательских имён файлов.
  image_path       text check (
                     image_path is null
                     or image_path ~ '^pending/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(-[a-z0-9]{8,32})?\.jpg$'
                   ),
  image_width      integer check (image_width is null or image_width between 1 and 20000),
  image_height     integer check (image_height is null or image_height between 1 and 20000),
  status           public.exhibit_status not null default 'pending',
  created_at       timestamptz not null default now(),
  approved_at      timestamptz,
  consent_at       timestamptz not null default now(),
  consent_version  text not null check (char_length(consent_version) between 1 and 40),

  constraint exhibits_image_unless_rejected check (status = 'rejected' or image_path is not null),
  constraint exhibits_approved_complete check (
    status <> 'approved' or (inventory_number is not null and approved_at is not null)
  )
);

comment on table public.exhibits is 'Экспонаты. Доступ только через Edge Functions (service role).';

create index exhibits_status_created_idx on public.exhibits (status, created_at desc);
create index exhibits_approved_idx on public.exhibits (approved_at) where status = 'approved';

-- Доверенные значения при создании: статус, даты, номер задаёт база, а не запрос.
create function public.exhibits_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.status := 'pending';
  new.created_at := now();
  new.consent_at := now();
  new.approved_at := null;
  new.inventory_number := null;
  return new;
end;
$$;

create trigger exhibits_before_insert
before insert on public.exhibits
for each row execute function public.exhibits_before_insert();

-- Содержимое экспоната неизменяемо (MVP: модератор принимает или отклоняет, но не редактирует).
create function public.exhibits_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.submission_id is distinct from old.submission_id
     or new.title is distinct from old.title
     or new.story is distinct from old.story
     or new.author_name is distinct from old.author_name
     or new.kept_since is distinct from old.kept_since
     or new.image_alt is distinct from old.image_alt
     or new.created_at is distinct from old.created_at
     or new.consent_at is distinct from old.consent_at
     or new.consent_version is distinct from old.consent_version then
    raise exception 'exhibit content is immutable';
  end if;
  if old.inventory_number is not null and new.inventory_number is distinct from old.inventory_number then
    raise exception 'inventory number is permanent';
  end if;
  if new.status <> 'approved' then
    new.approved_at := null;
  end if;
  return new;
end;
$$;

create trigger exhibits_before_update
before update on public.exhibits
for each row execute function public.exhibits_before_update();

-- ─────────────────────────────────────────────────────────────
-- Администраторы (назначаются вручную через SQL Editor)
-- ─────────────────────────────────────────────────────────────
create table public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  note       text check (note is null or char_length(note) <= 200)
);

comment on table public.admins is 'Кто может модерировать. Роль не берётся из user_metadata.';

-- ─────────────────────────────────────────────────────────────
-- Ограничение частоты отправки
-- Ключ — HMAC(секрет, IP), сырой IP не хранится. Записи старше 2 суток удаляются.
-- ─────────────────────────────────────────────────────────────
create table public.submission_rate_limits (
  bucket       text not null check (char_length(bucket) <= 100),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

create index submission_rate_limits_window_idx on public.submission_rate_limits (window_start);

-- Атомарно увеличивает три счётчика (час/сутки на ключ, сутки общий).
-- Если любой лимит превышен — увеличение откатывается, возвращается причина.
-- Параллельные запросы сериализуются блокировкой строки в ON CONFLICT DO UPDATE.
create function public.consume_submission_quota(
  p_key text,
  p_per_hour integer,
  p_per_day integer,
  p_global_per_day integer
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_hour timestamptz := date_trunc('hour', now());
  v_day  timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  h integer;
  d integer;
  g integer;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid rate limit key';
  end if;

  begin
    insert into public.submission_rate_limits as r (bucket, window_start, hits)
    values ('global', v_day, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning r.hits into g;

    insert into public.submission_rate_limits as r (bucket, window_start, hits)
    values ('h:' || p_key, v_hour, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning r.hits into h;

    insert into public.submission_rate_limits as r (bucket, window_start, hits)
    values ('d:' || p_key, v_day, 1)
    on conflict (bucket, window_start) do update set hits = r.hits + 1
    returning r.hits into d;

    if g > p_global_per_day then
      raise exception using errcode = 'MOT01', message = 'global_day';
    end if;
    if h > p_per_hour then
      raise exception using errcode = 'MOT01', message = 'per_hour';
    end if;
    if d > p_per_day then
      raise exception using errcode = 'MOT01', message = 'per_day';
    end if;
    return 'ok';
  exception
    when sqlstate 'MOT01' then
      return sqlerrm;
  end;
end;
$$;

create function public.cleanup_submission_rate_limits()
returns integer
language sql
set search_path = ''
as $$
  with del as (
    delete from public.submission_rate_limits
    where window_start < now() - interval '2 days'
    returning 1
  )
  select count(*)::integer from del;
$$;

-- ─────────────────────────────────────────────────────────────
-- Чтение и одобрение (вызываются только из Edge Functions)
-- ─────────────────────────────────────────────────────────────
create function public.get_random_approved_exhibit(p_exclude uuid default null)
returns table (
  id uuid,
  inventory_number integer,
  title text,
  story text,
  author_name text,
  kept_since text,
  image_alt text,
  image_path text,
  image_width integer,
  image_height integer,
  others_exist boolean
)
language sql
stable
set search_path = ''
as $$
  with pool as (
    select e.* from public.exhibits e where e.status = 'approved' and e.image_path is not null
  ),
  pick as (
    select * from pool where p_exclude is null or pool.id <> p_exclude order by random() limit 1
  ),
  fallback as (
    select * from pool where not exists (select 1 from pick) order by random() limit 1
  ),
  chosen as (
    select * from pick
    union all
    select * from fallback
  )
  select c.id, c.inventory_number, c.title, c.story, c.author_name, c.kept_since,
         c.image_alt, c.image_path, c.image_width, c.image_height,
         (select count(*) from pool) > 1 as others_exist
  from chosen c
  limit 1;
$$;

create function public.approve_exhibit(p_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.exhibits
     set status = 'approved',
         approved_at = now(),
         inventory_number = coalesce(inventory_number, nextval('public.exhibit_inventory_seq')::integer)
   where id = p_id
     and status = 'pending'
     and image_path is not null;
  get diagnostics n = row_count;
  return n = 1;
end;
$$;

-- ─────────────────────────────────────────────────────────────
-- Права: RLS включён, политик для anon/authenticated нет → всё запрещено.
-- Дополнительно снимаем табличные GRANT, которые Supabase выдаёт по умолчанию.
-- ─────────────────────────────────────────────────────────────
alter table public.exhibits enable row level security;
alter table public.admins enable row level security;
alter table public.submission_rate_limits enable row level security;

alter table public.exhibits force row level security;
alter table public.admins force row level security;
alter table public.submission_rate_limits force row level security;

revoke all on table public.exhibits, public.admins, public.submission_rate_limits from public, anon, authenticated;
revoke all on sequence public.exhibit_inventory_seq from public, anon, authenticated;

revoke execute on function
  public.consume_submission_quota(text, integer, integer, integer),
  public.cleanup_submission_rate_limits(),
  public.get_random_approved_exhibit(uuid),
  public.approve_exhibit(uuid),
  public.exhibits_before_insert(),
  public.exhibits_before_update()
from public, anon, authenticated;

grant select, insert, update, delete on table public.exhibits, public.admins, public.submission_rate_limits to service_role;
grant usage, select on sequence public.exhibit_inventory_seq to service_role;
grant execute on function
  public.consume_submission_quota(text, integer, integer, integer),
  public.cleanup_submission_rate_limits(),
  public.get_random_approved_exhibit(uuid),
  public.approve_exhibit(uuid)
to service_role;

-- service_role в Supabase обходит RLS (BYPASSRLS), поэтому force RLS ему не мешает.

-- ─────────────────────────────────────────────────────────────
-- Приватное хранилище фотографий
-- Политик на storage.objects для этого bucket нет → anon/authenticated
-- не могут ни загрузить, ни прочитать, ни подписать ссылку.
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('exhibit-images', 'exhibit-images', false, 2097152, array['image/jpeg'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
