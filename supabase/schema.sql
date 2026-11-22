-- Blourr : schéma complet
create extension if not exists pgcrypto;

-- Profils (1 par compte)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'member' check (role in ('admin','member')),
  color text,
  created_at timestamptz not null default now()
);

-- Réglages privés (identifiants R2, code famille) : accessibles seulement par les fonctions serveur
create table public.app_private (
  key text primary key,
  value text not null
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid());
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- ===== Galerie familiale =====
create table public.albums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references public.profiles(id) on delete set null,
  album_id uuid references public.albums(id) on delete set null,
  kind text not null check (kind in ('photo','video','file')),
  key text not null,
  thumb_key text,
  name text,
  mime text,
  size bigint not null default 0,
  width int,
  height int,
  duration real,
  taken_at timestamptz,
  created_at timestamptz not null default now()
);
create index media_created_idx on public.media (created_at desc);
create index media_album_idx on public.media (album_id);
create index media_owner_idx on public.media (owner_id);
create index albums_created_by_idx on public.albums (created_by);

-- ===== Ciné =====
create table public.sagas (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  backdrop_key text,
  created_at timestamptz not null default now()
);

create table public.titles (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('movie','series')),
  name text not null,
  description text,
  year int,
  rating text,
  genres text[] not null default '{}',
  poster_key text,
  backdrop_key text,
  video_key text,
  subtitle_key text,
  video_size bigint not null default 0,
  duration real,
  intro_start real,
  intro_end real,
  saga_id uuid references public.sagas(id) on delete set null,
  saga_order int,
  featured boolean not null default false,
  created_at timestamptz not null default now()
);
create index titles_saga_idx on public.titles (saga_id);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  title_id uuid not null references public.titles(id) on delete cascade,
  season int not null default 1,
  number int not null default 1,
  name text,
  description text,
  video_key text,
  subtitle_key text,
  thumb_key text,
  video_size bigint not null default 0,
  duration real,
  intro_start real,
  intro_end real,
  created_at timestamptz not null default now()
);
create index episodes_title_idx on public.episodes (title_id, season, number);

create table public.watch_progress (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  item_id uuid not null,
  title_id uuid not null references public.titles(id) on delete cascade,
  episode_id uuid references public.episodes(id) on delete cascade,
  position real not null default 0,
  duration real not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, item_id)
);
create index watch_progress_title_idx on public.watch_progress (title_id);
create index watch_progress_episode_idx on public.watch_progress (episode_id);

create table public.my_list (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title_id uuid not null references public.titles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, title_id)
);
create index my_list_title_idx on public.my_list (title_id);

-- Espace utilisé
create or replace function public.storage_usage() returns json
language sql stable security definer set search_path = public as $$
  select case when public.is_member() then json_build_object(
    'gallery', coalesce((select sum(size) from public.media), 0),
    'cine', coalesce((select sum(video_size) from public.titles), 0) + coalesce((select sum(video_size) from public.episodes), 0)
  ) else null end;
$$;

-- ===== Sécurité (RLS) =====
alter table public.profiles enable row level security;
alter table public.app_private enable row level security;
alter table public.albums enable row level security;
alter table public.media enable row level security;
alter table public.sagas enable row level security;
alter table public.titles enable row level security;
alter table public.episodes enable row level security;
alter table public.watch_progress enable row level security;
alter table public.my_list enable row level security;

create policy "profils visibles par la famille" on public.profiles for select to authenticated using ((select public.is_member()));
create policy "modifier son profil" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke update on public.profiles from authenticated, anon;
grant update (display_name, color) on public.profiles to authenticated;

create policy "albums lecture" on public.albums for select to authenticated using ((select public.is_member()));
create policy "albums ajout" on public.albums for insert to authenticated with check ((select public.is_member()) and created_by = (select auth.uid()));
create policy "albums modif" on public.albums for update to authenticated using (created_by = (select auth.uid()) or (select public.is_admin()));
create policy "albums suppr" on public.albums for delete to authenticated using (created_by = (select auth.uid()) or (select public.is_admin()));

create policy "media lecture" on public.media for select to authenticated using ((select public.is_member()));
create policy "media ajout" on public.media for insert to authenticated with check ((select public.is_member()) and owner_id = (select auth.uid()));
create policy "media modif" on public.media for update to authenticated using ((select public.is_member()));
create policy "media suppr" on public.media for delete to authenticated using (owner_id = (select auth.uid()) or (select public.is_admin()));

create policy "sagas lecture" on public.sagas for select to authenticated using ((select public.is_member()));
create policy "sagas admin" on public.sagas for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "titles lecture" on public.titles for select to authenticated using ((select public.is_member()));
create policy "titles admin" on public.titles for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "episodes lecture" on public.episodes for select to authenticated using ((select public.is_member()));
create policy "episodes admin" on public.episodes for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "progression perso" on public.watch_progress for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "liste perso" on public.my_list for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke execute on function public.storage_usage() from anon;
