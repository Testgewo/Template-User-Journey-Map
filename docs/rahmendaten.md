# Rahmendaten (Canvas) und Umsetzung

Stand: 16.11.2026. Die linke Spalte ist der Canvas „erste Schritte“, die rechte zeigt, wo das in der Vorlage steckt.

| Feld | Ist heute (Canvas) | Umsetzung in der Vorlage |
|---|---|---|
| **1 Auslöser** | Projektkontext erfordert IST-Aufnahme, wie unsere Kunden mit dem Voicebot in Verbindung kommen. | Reiter „Rahmen“: Anlass und Rahmen. Das fiktive Beispiel zeigt eine Voicebot-Journey. |
| **2 Rollen** | Erfassen: UXer. Prüfer und Entscheider: Fachbereich mit Prozesswissen, Stakeholder aus Fachbereich. | Felder „Erfasst von“ und „Prüfender Fachbereich“ (Rolle statt Name). Freigabe nur mit Angabe „Freigegeben durch“. |
| **3 Schritte** | 1 Anlass und Rahmen klären · 2 Material sammeln · 3 Material anonymisieren · 4 Schritte erfassen · 5 Map erzeugen · 6 Fachlich prüfen lassen · 7 Überarbeiten und freigeben lassen | Reiter 1–5 folgen diesen Schritten. Übersicht „So läuft die Erstellung ab“ im Reiter „Rahmen“. |
| **4 Übergaben** | Fachbereich → UX: Material und Prozesswissen (nach 2). UX → Fachbereich: Entwurf zur Prüfung (nach 5). Fachbereich → UX: Rückmeldungen (nach 6). | Übergaben stehen in der Ablauf-Übersicht. „Zur fachlichen Prüfung geben“ sperrt den Inhalt, der PDF-Export geht an den Fachbereich. Rückmeldungen werden zentral erfasst. |
| **5 Daten** | Pflicht: Titel und Rahmen, Nutzergruppe, Start- und Endpunkt, Phasen, je Schritt Aktion und Touchpoint, Emotion, Pain Points mit Quelle, Stand bzw. Version; Ausfüllhilfe (Beispiel ausgefüllter Schritt). Optional: Gedanken, anonymisierte Zitate. | Alle Pflichtfelder mit * markiert und geprüft. Stand und Version werden automatisch geführt. Ausfüllhilfe im Reiter „Schritte“. Gedanken und Zitate optional, Zitate höchstens 200 Zeichen. Zusätzlich optional je Schritt: interner Ablauf (eigene Zeile in der Map) und Quelle des Schritts. Schritte lassen sich als Liste einfügen, z. B. Prozessschritte aus der Dokumentation des Fachbereichs. |
| **6 Regeln** | Vollständig: alle Pflichtangaben je Schritt, jeder Pain Point hat eine Quelle. Rückfrage: Schritt ohne Touchpoint, Pain Point ohne Beleg, widersprüchliche Angaben, Hinweis auf personenbezogene Daten. Erledigt: fachlich geprüft, freigegeben, Export mit Versionsstand erstellt. | `js/checks.js`. Widersprüche: gleicher Start- und Endpunkt, doppelte Phasennamen, Verweis auf gelöschte Quelle, positive Emotion mit Pain Points (Hinweis). Personendaten: Muster für E-Mail, Telefon, IBAN, Anschrift, Anrede mit Namen, Kunden-/Vertragsnummer, Geburtsdatum. Checkliste „Erledigt?“ im Reiter „Prüfung & Freigabe“. |
| **7 Schwachstellen** | Materialsammlung kann Lücken haben, Rückmeldungen verstreut auf verschiedenen Kanälen, verschiedene Versionierungen der Prozesse. | Lückencheck nach Kundensicht, Prozesssicht und Daten. Rückmeldungen mit Kanal, Bezug und Bearbeitungsstatus an einer Stelle. Eine Versionsnummer pro Fassung, Status-Ablauf, Versionshistorie, Version im Dateinamen und auf dem Export. |
| **8 Nicht-Ziele** | Keine Rohdaten oder Transkripte speichern, keine personenbezogenen Daten. Keine Echtzeit-Zusammenarbeit. | Quellen nur als Kurzbezeichnung. Lange Texte lösen eine Rückfrage aus. Keine Speicherung im Browser, kein Server, keine Netzwerkzugriffe. Bearbeitung durch eine Person, Austausch per Datei bzw. PDF. |

## Prüfregeln im Überblick

| Typ | Wirkung | Beispiele |
|---|---|---|
| Fehlt | blockiert Prüfung und Freigabe | Titel, Anlass, Nutzergruppe, Start- oder Endpunkt fehlt; Phase ohne Namen; Schritt ohne Aktion oder Emotion; Pain Point ohne Beschreibung; Quelle ohne Bezeichnung oder Art |
| Rückfrage | blockiert Prüfung und Freigabe | Schritt ohne Touchpoint; Pain Point ohne Beleg; Schritt oder Pain Point verweist auf gelöschte Quelle; Anonymisierung einer Quelle nicht bestätigt; möglicher Personenbezug; sehr langer Text (über 500 Zeichen) oder langes Zitat (über 200 Zeichen); Widersprüche; Rückmeldung abgelehnt ohne Begründung |
| Hinweis | blockiert nicht | Phase ohne Schritte; Quelle wird nirgends als Beleg genutzt; fehlende Sicht im Lückencheck; negative Emotion ohne Pain Point; gleiche Aktion doppelt |

Für die Freigabe gilt zusätzlich: Alle Rückmeldungen sind bearbeitet, und es ist angegeben, wer freigibt.
