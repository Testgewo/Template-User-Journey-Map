# Journey-Map-Vorlage

Vorlage zum Erfassen, Prüfen und Freigeben von User Journey Maps, zuerst für die IST-Aufnahme, wie Kund*innen mit dem Voicebot in Kontakt kommen. Die Vorlage führt durch die sieben Schritte vom Rahmen bis zur Freigabe. Sie prüft die Angaben nach festen Regeln und erzeugt eine druckbare Map mit Versionsstand.

> **Prototyp.** Nur mit fiktiven oder anonymisierten Inhalten nutzen. Nicht für den Betrieb.
> Keine Rohdaten, Transkripte oder personenbezogenen Daten eintragen.

## Starten

1. Repository herunterladen oder klonen.
2. `index.html` per Doppelklick im Browser öffnen (aktueller Chrome, Edge oder Firefox).

Es gibt keine Installation, keinen Server und keine fremden Pakete. Die App lädt nichts aus dem Internet.

Zum Ausprobieren oben auf **Beispiel laden** klicken. Es lädt eine frei erfundene Voicebot-Journey.

### Im Netz über GitHub Pages

Die Vorlage läuft auch als normale Webseite unter
`https://testgewo.github.io/Template-User-Journey-Map/`, sobald GitHub Pages eingeschaltet ist:

1. Im Repository auf GitHub **Settings → Pages** öffnen.
2. Unter **Build and deployment** bei **Source** „Deploy from a branch“ wählen.
3. Als **Branch** den Standardbranch und den Ordner `/ (root)` wählen, dann **Save**.

Nach ein bis zwei Minuten ist die Seite erreichbar. Jeder Push auf diesen Branch aktualisiert sie. `_config.yml` sorgt dafür, dass nur `index.html`, `css/` und `js/` ausgeliefert werden.

Die Seite ist öffentlich erreichbar. Sie speichert nichts auf einem Server: Eingaben bleiben im Browser, gespeichert wird nur als Datei auf dem eigenen Rechner. GitHub protokolliert beim Aufruf, wie jeder Webserver, die IP-Adresse der Besucher*innen.

### Als Seite in claude.ai

`artifact.html` ist dieselbe Vorlage als private Seite (Artifact) in claude.ai. Sie nutzt dieselben Dateien unter `css/` und `js/` und unterscheidet sich in drei Punkten:

- Sie startet mit dem fiktiven Beispiel.
- „Speichern“ und der Export laufen über die Download-Funktion von claude.ai. Jeder Download wird bestätigt.
- Der Druckdialog lässt sich dort nicht öffnen. Statt des PDF-Exports sicherst du eine druckfertige HTML-Datei. Die öffnest du im Browser und speicherst sie mit Strg+P als PDF (A3 quer).

Eingaben bleiben im Browser und werden nicht auf einem Server gespeichert. Ohne „Speichern“ sind sie beim Neuladen weg.

## So funktioniert es

| Reiter | Was passiert dort | Schritte aus den Rahmendaten |
|---|---|---|
| 1 Rahmen | Titel, Anlass, Nutzergruppe, Start- und Endpunkt | 1 Anlass und Rahmen klären |
| 2 Material | Quellenverzeichnis: welche Unterlagen und Gespräche der Map zugrunde liegen (nur Kurzbezeichnung, kein Inhalt), Anonymisierung je Quelle bestätigen, Lückencheck nach Sichten | 2 Material sammeln, 3 anonymisieren |
| 3 Schritte | Oben „Neuer Schritt“: Phase wählen, eintippen, Enter. „Mehrere Schritte auf einmal übernehmen“: Text einfügen oder Datei hineinziehen, die Vorlage trennt ihn in Schritte und zeigt einen bearbeitbaren Vorschlag. Darunter eine Zeile je Schritt mit dem, was noch fehlt; per Klick aufklappen und Details ergänzen. Mehrere Schritte auswählen und löschen, „Rückgängig“ nach Import und Löschen. | 4 Schritte erfassen |
| 4 Map | Grafische Journey Map: Kopf mit Szenario, Nutzergruppe, Start und Ziel sowie Überblick (Schritte, Touchpoints, Pain Points, Tiefpunkt). Darunter Phasenband, Schrittkarten, Touchpoints mit Symbolen, Gedanken als Sprechblasen, durchgehende Emotionskurve mit Gesichtern und markiertem Tief- und Höhepunkt, Pain Points, Zitate und unter der Sichtbarkeitslinie der interne Ablauf. Quellen als Q1, Q2 … Export als PDF über den Druckdialog (A3 quer) | 5 Map erzeugen |
| 5 Prüfung & Freigabe | Prüfpunkte, Rückmeldungen aus allen Kanälen, Status und Version, Versionshistorie, Checkliste „Erledigt“ | 6 prüfen lassen, 7 überarbeiten und freigeben |

**Speichern:** „Speichern“ (oder Strg+S) lädt die Map als JSON-Datei herunter. Der Dateiname enthält Titel, Version und Stand, z. B. `journey-map_kontakt-voicebot_v0.2_2026-11-16.json`. Mit „Öffnen …“ lädst du sie wieder. Im Browser wird nichts gespeichert.

**Status und Version:**

```
Entwurf 0.1 → In fachlicher Prüfung 0.1 → In Überarbeitung 0.2 → … → Freigegeben 1.0 → (neue Fassung 1.1)
```

Während der Prüfung und nach der Freigabe ist der Inhalt gesperrt. Rückmeldungen lassen sich jederzeit erfassen.

**Prüfregeln** (aus den Rahmendaten, Details in [`docs/rahmendaten.md`](docs/rahmendaten.md)):

- *Fehlt:* Pflichtangabe fehlt.
- *Rückfrage:* Schritt ohne Touchpoint, Pain Point ohne Beleg, widersprüchliche Angaben, möglicher Personenbezug (z. B. E-Mail, Telefonnummer, IBAN, Anschrift, Kundennummer), sehr lange Texte (Verdacht auf Rohdaten), nicht bestätigte Anonymisierung.
- *Hinweis:* blockiert nicht, z. B. fehlende Sicht im Lückencheck oder negative Emotion ohne Pain Point.

Zur Prüfung und zur Freigabe darf nichts mehr fehlen und keine Rückfrage offen sein. Für die Freigabe müssen außerdem alle Rückmeldungen bearbeitet sein.

## Viele Schritte auf einmal übernehmen

Im Reiter „Schritte“ unter „Mehrere Schritte auf einmal übernehmen“: Text einfügen oder eine Datei in das Feld ziehen. Die Vorlage trennt den Text in Schritte und zeigt einen **Vorschlag**, den du vor dem Anlegen bearbeitest (Text ändern, Schritte zusammenführen, abwählen, entfernen, Phasen umbenennen). Danach gibt es „Rückgängig“.

So wird getrennt:

- Jede Zeile, jeder Aufzählungspunkt und jeder Satz wird ein Schritt (umschaltbar auf „nur Zeilen“). Auch „→“, „;“, „1. … 2. …“ in einer Zeile und „…, dann …“ trennen. Ordnungszahlen („am 3. Tag“) und Abkürzungen („z. B.“) beenden keinen Satz. Beim Kopieren aus PDF umbrochene Zeilen werden wieder zusammengefügt.
- Überschriften werden Phasen: kurze Zeile mit Doppelpunkt am Ende, „# Überschrift“ oder Überschriften aus Word.
- Zeilen mit „Problem:“, „Touchpoint:“, „Gedanke:“, „Zitat:“, „Emotion:“ oder „Intern:“ gehören zum Schritt davor. Sätze mit „Leider …“ werden Pain Points, „Sie ist genervt, weil …“ wird Emotion und Pain Point des Schritts davor.
- Formuliert aus Sicht der Person: „Die Kundin ruft an“ → „Ruft an“, „Dann ruft sie die Hotline an“ → „Ruft die Hotline an“.
- Touchpoint und Emotion werden anhand von Wörtern vorgeschlagen und hellblau markiert.

| Datei | Was passiert |
|---|---|
| Excel (.xlsx) oder CSV mit Spaltenüberschriften | Eine Zeile je Schritt mit allen Feldern (Tabellenvorlage zum Herunterladen). Andere Spalten (z. B. „Verantwortlich“) werden nicht übernommen. Eigene Vorschau. |
| Word (.docx) | Tabelle mit Spalte „Aktion“ oder „Prozessschritt“ wie Excel; sonst Überschriften und Aufzählungspunkte als Text in den Vorschlag |
| Text (.txt) | als Text in den Vorschlag |
| PDF | Text kopieren und einfügen |

Höchstens 100 Schritte auf einmal. Alles läuft nur im Browser; die Datei wird nicht hochgeladen und nicht gespeichert.

## Tests

Die Prüfregeln und der Status-Ablauf haben automatische Tests. Dafür braucht es nur Node.js (unterstützte LTS-Version), keine Pakete:

```bash
node --test
```

## Datenschutz

- Die App sendet keine Daten an Dritte und lädt keine externen Schriften oder Skripte (Content-Security-Policy in `index.html`).
- Material, Rohdaten und Transkripte bleiben in eurer freigegebenen Ablage. In der Map steht nur die Kurzbezeichnung der Quelle.
- Die Erkennung möglicher Personendaten ist eine Hilfe, keine Garantie. Die Verantwortung für die Anonymisierung liegt bei der Person, die die Map erfasst.

## Offene Punkte

- [TODO: Farben und Schrift aus dem Gewobag-Corporate-Design übernehmen (`css/app.css`, Design-Tokens oben).]
- [TODO: Verantwortliche Person bzw. Team eintragen.]
- Die Seite in claude.ai ist privat. Teilst du den Link mit Kolleg*innen, nutzen andere die Vorlage. Dann gilt der nächste Punkt.
- Sollen später andere die Vorlage nutzen (UX-Team, Fachbereich), wird aus dem Prototyp eine Anwendung für andere. Dann kommen dazu: Ablage in Azure DevOps, vollständige Sicherheitsprüfung, TypeScript mit Build und Tests, installierbar als App (PWA) und Betrieb auf einem internen Server statt Datei-Austausch.
