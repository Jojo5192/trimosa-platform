-- ☎️✅ §247: Lösungs-Erfassung direkt am Telefonat.
--
-- Bisher konnte das Team nur über eine ☎️-AUFGABE dokumentieren, wie ein
-- Anruf gelöst wurde („✅ Lösung (Telefonat): …" als Task-Kommentar). Seit
-- §246g entsteht bei BEKANNTEM Gast aber keine Aufgabe mehr — genau die
-- lehrreichsten Fälle hatten damit keinen Lernkanal. Jetzt hängt die Lösung
-- direkt am Anruf und fließt über lib/voice-learn in die Wissensbasis.
alter table public.voice_calls add column if not exists solution     text;
alter table public.voice_calls add column if not exists solution_by  uuid references public.profiles(id) on delete set null;
alter table public.voice_calls add column if not exists solution_at  timestamptz;

-- Der Lernlauf holt nachgetragene Lösungen auch dann, wenn das Transkript
-- längst gelernt wurde (learned_at gesetzt) — Sortierung/Filter über solution_at.
create index if not exists voice_calls_solution_at_idx
  on public.voice_calls (solution_at desc nulls last);
