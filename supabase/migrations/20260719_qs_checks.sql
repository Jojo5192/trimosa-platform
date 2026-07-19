-- ============================================================
-- Qualitätssicherung (HANDOFF §100): halbjährliche QS-Termine
-- je Wohnung mit strukturiertem Protokoll, Fotos und PDF-Ablage.
-- Zugriff ausschließlich über Service-Role-APIs (RLS deny-all).
-- ============================================================

create table if not exists public.qs_checks (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date not null,
  status text not null default 'geplant' check (status in ('geplant', 'erledigt')),
  -- Protokoll: { items: { <itemId>: { s: 'ok'|'mangel'|'na', note, count } }, note }
  report jsonb,
  -- [{ url, by, at }] — Fotos im listing-images-Bucket unter qs/<id>/…
  photos jsonb not null default '[]'::jsonb,
  pdf_url text,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists qs_checks_listing_idx on public.qs_checks (listing_id, status);
create index if not exists qs_checks_assignee_idx on public.qs_checks (assignee_id, status);

-- Keine Policies = deny-all für anon/authenticated; nur Service-Role greift zu
alter table public.qs_checks enable row level security;
