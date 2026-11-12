-- Минимальная имитация окружения Supabase для тестов миграций в PGlite.
-- Не используется в реальном проекте.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
grant usage on schema public to anon, authenticated, service_role;
-- Supabase по умолчанию выдаёт эти права на всё новое в public — имитируем это,
-- чтобы проверить, что миграция их действительно снимает.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
