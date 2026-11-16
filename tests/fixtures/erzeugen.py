"""
Erzeugt die Testdateien für den Import (fiktive Inhalte).
Nur nötig, wenn sich die Testdateien ändern sollen: python3 tests/fixtures/erzeugen.py
Braucht openpyxl und python-docx.
"""
from pathlib import Path

from docx import Document
from openpyxl import Workbook

ORDNER = Path(__file__).parent

# Excel: Titelzeile, Kopfzeile mit bekannten und unbekannten Spalten, Phase nur in der ersten Zeile je Phase
mappe = Workbook()
blatt = mappe.active
blatt.title = "Prozess"
blatt.append(["Prozess Schadensmeldung (fiktives Beispiel)"])
blatt.append(["Nr.", "Phase", "Prozessschritt", "Touchpoint / Kanal", "Emotion", "Pain Points", "Quelle", "Verantwortlich"])
blatt.append([1, "Kontakt aufnehmen", "Ruft die Service-Hotline an", "Telefon", "neutral", None, "Q1", "Team A"])
blatt.append([2, None, "Hört die Begrüßung", "Voicebot", -1, "Erwartet eine Person\nLegt während der Ansage auf", "Workshop Kundenservice", "Team B"])
blatt.append([3, "Mit dem Voicebot sprechen", "Nennt das Anliegen", "Voicebot", "🙁", "Anliegen wird nicht erkannt", None, "Team B"])
blatt.append([None, None, None, None, None, None, None, None])
blatt.append([4, None, "Erhält eine Bestätigung", "SMS", "unklar", None, None, "Team A"])
mappe.save(ORDNER / "schritte.xlsx")

# Word mit Überschrift, Fließtext und nummerierter Liste
dok = Document()
dok.add_heading("Prozess Schadensmeldung (fiktives Beispiel)", level=1)
dok.add_paragraph("Dieser Ablauf beschreibt die telefonische Schadensmeldung.")
for schritt in ["Anruf geht beim Voicebot ein", "Voicebot erkennt das Anliegen", "Vorgang wird angelegt", "Bestätigung wird verschickt"]:
    dok.add_paragraph(schritt, style="List Number")
dok.add_paragraph("Stand: Oktober 2026")
dok.save(ORDNER / "prozess-liste.docx")

# Word mit Tabelle
dok = Document()
dok.add_paragraph("Prozessbeschreibung (fiktives Beispiel)")
tabelle = dok.add_table(rows=1, cols=4)
for zelle, text in zip(tabelle.rows[0].cells, ["Nr.", "Prozessschritt", "Interner Ablauf", "Kanal"]):
    zelle.text = text
for zeile in [
    ["1", "Kund*in ruft an", "Anruf wird zum Voicebot geleitet", "Telefon"],
    ["2", "Nennt das Anliegen", "Spracherkennung ordnet das Anliegen zu", "Voicebot"],
    ["3", "Wird weitergeleitet", "Gespräch geht ohne Zusammenfassung an das Service-Team", "Telefon"],
]:
    zellen = tabelle.add_row().cells
    for zelle, text in zip(zellen, zeile):
        zelle.text = text
dok.save(ORDNER / "prozess-tabelle.docx")
print("Testdateien erzeugt")
