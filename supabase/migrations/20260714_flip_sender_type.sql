-- Korrektur: Smoobus numerische type-Semantik war invertiert interpretiert.
-- Richtig ist: type 2 = Nachricht AN DEN GAST (von uns), type 1 = VOM Gast.
-- Diese Migration dreht die bereits importierten Daten:

-- 1) Nachrichten-Archiv (8.780 Zeilen): host<->guest tauschen
update public.smoobu_message_archive
  set sender_type = case when sender_type = 'host' then 'guest' else 'host' end;

-- 2) Bereits gesyncte Buchungs-Chat-Nachrichten löschen — sie werden beim
--    nächsten Öffnen des Threads automatisch frisch (und korrekt) neu gesynct.
--    Über die Plattform GESENDETE Nachrichten (smoobu_message_id null) bleiben.
delete from public.messages
  where booking_id is not null and smoobu_message_id is not null;

-- 3) Wissensbasis leeren — sie wurde aus den invertierten Daten destilliert
--    und wird nach dem nächsten Aufbau (Button/Cron) korrekt neu erzeugt.
delete from public.chat_knowledge;
