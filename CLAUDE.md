# Journey-Map-Vorlage

## Zweck
Browser-Vorlage zum Erfassen, Prüfen und Freigeben von User Journey Maps (zuerst: IST-Aufnahme Voicebot-Kontakt). Nutzt nur eine Person (UX), der Fachbereich bekommt den PDF-Export.
Status: Prototyp. Nur fiktive oder anonymisierte Inhalte.

Anforderungen: `docs/rahmendaten.md` (Canvas mit Auslöser, Rollen, Schritten, Übergaben, Daten, Regeln, Schwachstellen, Nicht-Zielen).

## Befehle
- Starten: `index.html` im Browser öffnen (kein Build, kein Server)
- Tests: `node --test` (eingebauter Test-Runner, keine Pakete)
- Sicherheits-Audit: entfällt, es gibt keine Abhängigkeiten. Vor dem Hinzufügen von Paketen Sicherheitsprüfung durchführen.

## Architektur
- Stack: HTML, CSS, JavaScript ohne Framework und ohne Build. Klassische `<script>`-Dateien, damit es auch über `file://` läuft (ES-Module gehen dort nicht).
- `js/model.js`: Datenmodell, Versionen, Status-Ablauf, JSON laden/speichern. Ohne DOM, auch in Node nutzbar.
- `js/checks.js`: Prüfregeln (fehlt / Rückfrage / Hinweis), Erkennung möglicher Personendaten.
- `js/beispiel.js`: fiktives Voicebot-Beispiel und Ausfüllhilfe.
- `js/app.js`: Oberfläche (Reiter, Formulare, Map, Druck).
- `css/app.css`: Design-Tokens, Hell/Dunkel, Druckansicht (A3 quer).
- Daten: nur als JSON-Datei beim Nutzer, Format `schema: "journey-map-vorlage"`, `schemaVersion: 1`. Kein localStorage, keine Netzwerkzugriffe.

## Konventionen
- Texte in der Oberfläche auf Deutsch, Du-Form, gendern mit *.
- DOM nur über `h()`/`s()` und `textContent` aufbauen, nie `innerHTML` (Eingaben dürfen nicht als HTML laufen).
- Keine Inline-Styles als Attribut (CSP `style-src 'self'`); Werte bei Bedarf über `el.style.x` setzen.
- Prüfregeln gehören in `checks.js`, nicht in die Oberfläche; zu jeder neuen Regel einen Test in `tests/logik.test.js`.
- Neue Felder: in `leereMap`, `normalisieren` und ggf. `pruefen` ergänzen; bei inkompatiblen Änderungen `SCHEMA_VERSION` erhöhen.

## Stolperfallen
- Pflichtfeld-Hinweise erscheinen erst nach Besuch des Reiters „Prüfung“ oder beim Laden einer Datei (`zustand.alleZeigen`). Hinweise beim Verlassen eines Feldes haben die Seite verschoben und Klicks ins Leere laufen lassen.
- Feld-IDs (`f-schritt-<id>-aktion` usw.) werden in `checks.js` erzeugt und in `app.js` verwendet; beide Seiten gemeinsam ändern.
- Nicht-Ziele: keine Rohdaten oder Transkripte speichern, keine personenbezogenen Daten, keine Echtzeit-Zusammenarbeit.
