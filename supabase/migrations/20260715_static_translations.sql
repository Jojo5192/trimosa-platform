-- Phase 3 Mehrsprachigkeit: KI-Übersetzungs-Cache für redaktionelle Inhalte
-- (Reiseführer-Texte, Kulinarik, Über-uns, Gäste-Zusammenfassungen, Bewertungen,
-- Grundriss-Labels, Zimmer-Stichwörter). Jeder deutsche Text wird einmal übersetzt
-- und hier dauerhaft gecacht (Schlüssel: Hash des deutschen Texts + Sprache).
CREATE TABLE IF NOT EXISTS public.static_translations (
  de_hash text NOT NULL,
  lang text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (de_hash, lang)
);
-- RLS aktiv ohne Policies = nur die Service-Role (Server) liest/schreibt.
ALTER TABLE public.static_translations ENABLE ROW LEVEL SECURITY;
