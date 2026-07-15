-- Wohnungs-Gruppierung: Inserate am selben Standort (z. B. Sirzenich-Trio)
-- können zu einer Gruppe gehören. Die Suche schlägt dann für große Gruppen
-- Kombinationen mehrerer Wohnungen dieser Gruppe vor.
ALTER TABLE public.listings ADD COLUMN IF NOT EXISTS location_group text;
