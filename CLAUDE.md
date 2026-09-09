@AGENTS.md

Antworte auf Deutsch. Dies ist das eigenständige Projekt **trimosa-platform** (eigener
GitHub-Account) — niemals mit dem Repo `jgg` vermischen. Aktueller Arbeitsstand, Analyse,
Sicherheits-Findings und Fahrplan stehen in HANDOFF.md — vor dem Loslegen lesen.

## HANDOFF.md richtig lesen (wichtig für das Kontextfenster)

HANDOFF.md ist über 1 MB groß (rund 600.000 Tokens). Sie darf deshalb NICHT per `@HANDOFF.md`
importiert und nie komplett ausgegeben werden (kein `cat`, kein Read ohne Zeilenbereich) —
sonst ist das Kontextfenster sofort voll und /compact kann nichts mehr retten (Vorfall 9.9.2026).
Stattdessen gezielt lesen:

- `grep -n "^## " HANDOFF.md | tail -12` → die letzten Abschnitte finden
- `grep -n "GESAMT-OFFEN-LISTE" HANDOFF.md` → die Offen-Liste am Ende finden
- danach nur die relevanten Bereiche mit `sed -n 'START,ENDp' HANDOFF.md` lesen

Neue Abschnitte weiterhin unten anhängen (vor der GESAMT-OFFEN-LISTE), aber knapp halten.
