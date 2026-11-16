/*
 * Tests für den Datei-Import (Excel, Word, CSV, Text). Testdateien in tests/fixtures (fiktive Inhalte).
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const M = require('../js/model.js');
const P = require('../js/checks.js');
const I = require('../js/import.js');

function puffer(inhalt) {
  const b = Buffer.isBuffer(inhalt) ? inhalt : Buffer.from(inhalt);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
}

function testdatei(name) {
  return puffer(fs.readFileSync(path.join(__dirname, 'fixtures', name)));
}

test('CSV: Anführungszeichen, Trennzeichen und Zeilenumbrüche im Feld, BOM', () => {
  const text = '﻿Phase;Aktion;Pain Points\r\nKontakt;"Ruft an; wartet";"Erstens\nZweitens"\r\n;"Sagt ""Hallo""";\r\n';
  assert.deepEqual(I.csvZeilen(text), [
    ['Phase', 'Aktion', 'Pain Points'],
    ['Kontakt', 'Ruft an; wartet', 'Erstens\nZweitens'],
    ['', 'Sagt "Hallo"', ''],
  ]);
  assert.deepEqual(I.csvZeilen('a,b\n1,2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(I.csvZeilen('sep=,\na;b,c'), [['a;b', 'c']]);
});

test('Spaltenüberschriften werden auch mit Zusätzen erkannt, Nummern-Spalten nicht', () => {
  assert.equal(I.spalteErkennen('Prozessschritt'), 'aktion');
  assert.equal(I.spalteErkennen('Aktion (Kundensicht)'), 'aktion');
  assert.equal(I.spalteErkennen('Touchpoint / Kanal'), 'touchpoint');
  assert.equal(I.spalteErkennen('Quelle Pain Points'), 'quellePainPoints');
  assert.equal(I.spalteErkennen('Quelle'), 'quelle');
  assert.equal(I.spalteErkennen('Interner Ablauf'), 'intern');
  assert.equal(I.spalteErkennen('Schritt-Nr.'), null);
  assert.equal(I.spalteErkennen('Verantwortlich'), null);
});

test('Emotion aus Zahl, Wort oder Symbol', () => {
  assert.equal(I.emotionAusText('-1'), -1);
  assert.equal(I.emotionAusText('+2'), 2);
  assert.equal(I.emotionAusText('0'), 0);
  assert.equal(I.emotionAusText('Sehr negativ'), -2);
  assert.equal(I.emotionAusText('neutral'), 0);
  assert.equal(I.emotionAusText('🙂'), 1);
  assert.equal(I.emotionAusText('5'), null);
  assert.equal(I.emotionAusText('weiß nicht'), null);
  assert.equal(I.emotionAusText(''), null);
});

test('Excel: Kopfzeile unter einer Titelzeile, unbekannte Spalten werden nicht übernommen', async () => {
  const a = await I.dateiAuswerten('schritte.xlsx', testdatei('schritte.xlsx'));
  assert.equal(a.art, 'tabelle');
  assert.deepEqual(a.ignoriert, ['Nr.', 'Verantwortlich']);
  assert.equal(a.datensaetze.length, 4);
  assert.equal(a.datensaetze[1].aktion, 'Hört die Begrüßung');
  assert.equal(a.datensaetze[1].emotion, '-1');
  assert.equal(a.datensaetze[1].painPoints, 'Erwartet eine Person\nLegt während der Ansage auf');
  assert.ok(!JSON.stringify(a.datensaetze).includes('Team A'), 'Spalte „Verantwortlich“ darf nicht übernommen werden');
});

test('Excel: Schritte, Phasen und Quellen werden angelegt', async () => {
  const a = await I.dateiAuswerten('schritte.xlsx', testdatei('schritte.xlsx'));
  const m = M.leereMap();
  const q1 = M.neueQuelle();
  q1.bezeichnung = 'Kurzinterviews';
  m.quellen.push(q1);
  const erg = I.schritteAusTabelle(m, a.datensaetze, {});

  assert.equal(erg.schritte.length, 4);
  // leere Startphase wird zur ersten Phase aus der Datei, Zeilen ohne Phase erben die Phase davor
  assert.equal(m.phasen.length, 2);
  assert.deepEqual(m.phasen.map((p) => p.name), ['Kontakt aufnehmen', 'Mit dem Voicebot sprechen']);
  assert.equal(erg.schritte[1].phaseId, m.phasen[0].id);
  assert.equal(erg.schritte[3].phaseId, m.phasen[1].id);
  // Emotion
  assert.deepEqual(erg.schritte.map((s) => s.emotion), [0, -1, -1, null]);
  assert.equal(erg.emotionUnklar, 1);
  // Quellen: „Q1“ wird gefunden, eine unbekannte Bezeichnung als neue Quelle angelegt
  assert.equal(erg.schritte[0].quelleId, q1.id);
  assert.deepEqual(erg.neueQuellen, ['Workshop Kundenservice']);
  const neu = m.quellen[1];
  assert.equal(erg.schritte[1].quelleId, neu.id);
  // Pain Points: je Zeile in der Zelle einer, mit der Quelle der Zeile
  assert.deepEqual(erg.schritte[1].painPoints.map((pp) => pp.text), ['Erwartet eine Person', 'Legt während der Ansage auf']);
  assert.equal(erg.schritte[1].painPoints[0].quelleId, neu.id);

  // neue Quelle muss noch geprüft werden (Art, Anonymisierung)
  const rueck = P.pruefen(m).probleme.map((p) => p.text);
  assert.ok(rueck.some((t) => t.startsWith('Quelle Q2') && t.includes('Anonymisierung')));
});

test('Word: Aufzählung wird zur Liste, Überschrift und Fließtext bleiben draußen', async () => {
  const a = await I.dateiAuswerten('prozess-liste.docx', testdatei('prozess-liste.docx'));
  assert.equal(a.art, 'liste');
  assert.deepEqual(a.zeilen, ['Anruf geht beim Voicebot ein', 'Voicebot erkennt das Anliegen', 'Vorgang wird angelegt', 'Bestätigung wird verschickt']);
});

test('Word: Tabelle mit Spalte „Prozessschritt“ wird zur Tabelle', async () => {
  const a = await I.dateiAuswerten('prozess-tabelle.docx', testdatei('prozess-tabelle.docx'));
  assert.equal(a.art, 'tabelle');
  assert.equal(a.herkunft, 'Word-Tabelle');
  assert.equal(a.datensaetze.length, 3);
  assert.equal(a.datensaetze[0].aktion, 'Kund*in ruft an');
  assert.equal(a.datensaetze[0].intern, 'Anruf wird zum Voicebot geleitet');
  assert.equal(a.datensaetze[0].touchpoint, 'Telefon');
});

test('CSV aus Excel in Windows-1252 wird richtig gelesen', async () => {
  const text = 'Phase;Aktion\r\nKontakt;Hört die Begrüßung\r\n';
  const bytes = Buffer.from(Array.from(text, (z) => z.charCodeAt(0)));
  const a = await I.dateiAuswerten('schritte.csv', puffer(bytes));
  assert.equal(a.art, 'tabelle');
  assert.equal(a.datensaetze[0].aktion, 'Hört die Begrüßung');
});

test('CSV ohne bekannte Überschriften: erste Spalte wird zur Liste', async () => {
  const a = await I.dateiAuswerten('liste.csv', puffer('Anruf annehmen;Team A\nAnliegen erfassen;Team B\n'));
  assert.equal(a.art, 'liste');
  assert.deepEqual(a.zeilen, ['Anruf annehmen', 'Anliegen erfassen']);
  assert.ok(a.hinweis.includes('erste Spalte'));
});

test('Textdatei: ein Schritt pro Zeile, auch mit Kommas', async () => {
  const a = await I.dateiAuswerten('schritte.txt', puffer('1. Kunde ruft an, wartet\n\n2. Voicebot meldet sich\n'));
  assert.equal(a.art, 'liste');
  assert.deepEqual(a.zeilen, ['Kunde ruft an, wartet', 'Voicebot meldet sich']);
});

test('nicht unterstützte oder kaputte Dateien geben eine verständliche Meldung', async () => {
  await assert.rejects(I.dateiAuswerten('prozess.pdf', puffer('%PDF')), (f) => f.nutzer && f.message.includes('PDF'));
  await assert.rejects(I.dateiAuswerten('alt.xls', puffer('x')), (f) => f.nutzer && f.message.includes('.xlsx'));
  await assert.rejects(I.dateiAuswerten('kaputt.xlsx', puffer('kein zip')), (f) => f.nutzer && f.message.includes('beschädigt'));
  await assert.rejects(I.dateiAuswerten('bild.png', puffer('x')), (f) => f.nutzer);
});

test('Tabellenvorlage enthält alle Spalten und wird selbst wieder erkannt', async () => {
  const csv = I.vorlageCsv();
  assert.ok(csv.startsWith('﻿'));
  const zeilen = I.csvZeilen(csv);
  assert.deepEqual(zeilen[0], I.VORLAGE_SPALTEN);
  for (const spalte of I.VORLAGE_SPALTEN) assert.ok(I.spalteErkennen(spalte), spalte);
  const a = await I.dateiAuswerten('vorlage.csv', puffer(csv + 'Kontakt;Ruft an;Telefon;negativ;Wartet lange;Q1;Anruf landet beim Voicebot;Q1;;\r\n'));
  assert.equal(a.art, 'tabelle');
  assert.equal(a.datensaetze[0].intern, 'Anruf landet beim Voicebot');
  assert.equal(a.datensaetze[0].quellePainPoints, 'Q1');
});
