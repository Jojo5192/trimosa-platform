-- Web-Push-Abos des Teams (Chat-PWA, Etappe 3). RLS ohne Policies = nur
-- Service-Role; Anlage/Löschung über /api/push (team-gated).
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
