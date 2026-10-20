-- FRENZO Ledger — database schema
-- One table holds every collection the app uses (catalog, movements, invoices, events,
-- purchases, expenses, eventLogs, station, supplies). Documents are JSON, like today.

create extension if not exists pgcrypto;

-- ---------- documents ----------
create table if not exists public.docs (
  collection  text not null,
  id          text not null,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (collection, id)
);
create index if not exists docs_collection_idx on public.docs (collection);
create index if not exists docs_event_idx on public.docs ((data->>'eventId')) where collection = 'eventLogs';

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

-- Deep merge used by "update": nested objects merge, arrays and scalars replace,
-- {"__delete__": true} removes a key.
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb) returns jsonb language plpgsql immutable as $$
declare k text; v jsonb; out jsonb := coalesce(a, '{}'::jsonb);
begin
  if jsonb_typeof(out) <> 'object' then out := '{}'::jsonb; end if;
  for k, v in select * from jsonb_each(coalesce(b, '{}'::jsonb)) loop
    if jsonb_typeof(v) = 'object' and v ? '__delete__' and (v->>'__delete__')::boolean then
      out := out - k;
    elsif jsonb_typeof(v) = 'object' and jsonb_typeof(out->k) = 'object' then
      out := jsonb_set(out, array[k], public.jsonb_deep_merge(out->k, v), true);
    else
      out := jsonb_set(out, array[k], v, true);
    end if;
  end loop;
  return out;
end $$;

-- Atomic merge (what the app calls doc.update). Creates the doc if missing.
create or replace function public.merge_doc(p_collection text, p_id text, p_patch jsonb) returns jsonb
language plpgsql security invoker as $$
declare result jsonb;
begin
  insert into public.docs (collection, id, data) values (p_collection, p_id, public.jsonb_deep_merge('{}'::jsonb, p_patch))
  on conflict (collection, id) do update set data = public.jsonb_deep_merge(public.docs.data, excluded.data)
  returning data into result;
  return result;
end $$;

-- ---------- people and roles ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  name        text,
  role        text not null default 'crew' check (role in ('owner', 'crew')),
  created_at  timestamptz not null default now()
);

-- The first account to sign up becomes the owner; everyone after that is crew
-- (the owner can promote people in Supabase → Table editor → profiles).
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
          case when exists (select 1 from public.profiles where role = 'owner') then 'crew' else 'owner' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ---------- security ----------
alter table public.docs enable row level security;
alter table public.profiles enable row level security;

drop policy if exists "owner full access" on public.docs;
create policy "owner full access" on public.docs
  for all to authenticated using (public.my_role() = 'owner') with check (public.my_role() = 'owner');

-- Crew (event day helpers) see the live station and the bag log, and can log bags.
drop policy if exists "crew read station and logs" on public.docs;
create policy "crew read station and logs" on public.docs
  for select to authenticated using (public.my_role() = 'crew' and collection in ('station', 'eventLogs'));
drop policy if exists "crew write logs" on public.docs;
create policy "crew write logs" on public.docs
  for insert to authenticated with check (public.my_role() = 'crew' and collection = 'eventLogs');
drop policy if exists "crew update logs" on public.docs;
create policy "crew update logs" on public.docs
  for update to authenticated using (public.my_role() = 'crew' and collection = 'eventLogs')
  with check (public.my_role() = 'crew' and collection = 'eventLogs');
drop policy if exists "crew delete logs" on public.docs;
create policy "crew delete logs" on public.docs
  for delete to authenticated using (public.my_role() = 'crew' and collection = 'eventLogs');

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles for select to authenticated using (id = auth.uid());
drop policy if exists "owner reads all profiles" on public.profiles;
create policy "owner reads all profiles" on public.profiles for select to authenticated using (public.my_role() = 'owner');
drop policy if exists "owner updates roles" on public.profiles;
create policy "owner updates roles" on public.profiles for update to authenticated using (public.my_role() = 'owner');

-- ---------- live updates ----------
alter table public.docs replica identity full;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
