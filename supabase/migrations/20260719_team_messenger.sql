-- 💼 Interner Team-Messenger (Etappe B, Pascal-Feedback §97):
-- Gruppen-Chats fürs Team (z. B. Geschäftsführung, Handwerker) mit Anhängen —
-- strikt getrennt von der Gäste-Kommunikation (eigener Intern-Bereich).

create table if not exists public.team_chats (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  emoji text not null default '💬',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.team_chat_members (
  chat_id uuid not null references public.team_chats(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- Lesestand fürs Unread-Zählen: alles NACH diesem Zeitpunkt ist ungelesen
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.team_chats(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  content text not null default '',
  attachment_url text,
  attachment_type text check (attachment_type in ('image', 'video', 'pdf')),
  attachment_name text,
  created_at timestamptz not null default now()
);

create index if not exists team_messages_chat_idx
  on public.team_messages (chat_id, created_at desc);

-- Push-Präferenzen je Nutzer: Gäste-Chats stumm schaltbar, interne separat
alter table public.profiles
  add column if not exists push_guest_chats boolean not null default true;
alter table public.profiles
  add column if not exists push_team_chats boolean not null default true;

-- RLS aktiv ohne Policies = deny-all; Zugriff läuft über die Service-Role-APIs
alter table public.team_chats enable row level security;
alter table public.team_chat_members enable row level security;
alter table public.team_messages enable row level security;
