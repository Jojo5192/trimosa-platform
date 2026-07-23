-- 📨 Auto-Nachrichten Phase B (§148): Kurzfristig-Weiche.
-- lead_filter je Vorlage: 'alle' | 'kurzfristig' (Anreise ≤ 3 Tage nach
-- Buchung) | 'normal' (Anreise > 3 Tage nach Buchung). Steuert, welche
-- Vorlagen für welche Buchungen greifen — kurzfristige Bucher bekommen
-- eine kompakte Nachricht statt der ganzen Sequenz (Anti-Spam-Doktrin).
alter table public.auto_messages
  add column if not exists lead_filter text not null default 'alle';
