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
- `index.html`: lokale Fassung (Doppelklick, eigene CSP). `artifact.html`: Fassung für claude.ai ohne Seitenrahmen (doctype/head/body ergänzt claude.ai), startet mit dem Beispiel (`data-start="beispiel"`). Seitengerüst in beiden Dateien gleich halten.
- GitHub Pages: Branch-Root, `_config.yml` schließt alles außer `index.html`, `css/`, `js/` aus. Relative Pfade beibehalten (Seite läuft unter `/Template-User-Journey-Map/`).
- Veröffentlichen: Artifact mit `artifact.html` als Seite, `css/app.css` und `js/*.js` als `files`, Fähigkeit `downloads`.
- Daten: nur als JSON-Datei beim Nutzer, Format `schema: "journey-map-vorlage"`, `schemaVersion: 1`. Kein localStorage, keine Netzwerkzugriffe.

## Konventionen
- Texte in der Oberfläche auf Deutsch, Du-Form, gendern mit *.
- DOM nur über `h()`/`s()` und `textContent` aufbauen, nie `innerHTML` zuweisen (Eingaben dürfen nicht als HTML laufen). Lesen von `innerHTML` für den Export ist in Ordnung.
- Keine Inline-Styles als Attribut (CSP `style-src 'self'`); Werte bei Bedarf über `el.style.x` setzen.
- Prüfregeln gehören in `checks.js`, nicht in die Oberfläche; zu jeder neuen Regel einen Test in `tests/logik.test.js`.
- Neue Felder: in `leereMap`, `normalisieren` und ggf. `pruefen` ergänzen; bei inkompatiblen Änderungen `SCHEMA_VERSION` erhöhen.

## Stolperfallen
- In claude.ai gibt es `window.claude` (`IM_VIEWER`): dort zeigen `confirm()`/`alert()` nichts, `window.print()` und Download-Links tun nichts. Deshalb eigener Dialog `bestaetigen()`, Speichern über `dateiAnbieten()` (Fähigkeit `downloads`) und Export als druckfertige HTML-Datei statt Druckdialog. Nie `window.confirm` verwenden.
- Pflichtfeld-Hinweise erscheinen erst nach Besuch des Reiters „Prüfung“ oder beim Laden einer Datei (`zustand.alleZeigen`). Hinweise beim Verlassen eines Feldes haben die Seite verschoben und Klicks ins Leere laufen lassen.
- Feld-IDs (`f-schritt-<id>-aktion` usw.) werden in `checks.js` erzeugt und in `app.js` verwendet; beide Seiten gemeinsam ändern.
- Nicht-Ziele: keine Rohdaten oder Transkripte speichern, keine personenbezogenen Daten, keine Echtzeit-Zusammenarbeit.
