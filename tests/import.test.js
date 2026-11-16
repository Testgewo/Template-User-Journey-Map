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

test('Word: Aufzählung wird zu Text, Dokumenttitel und Fließtext bleiben draußen', async () => {
  const a = await I.dateiAuswerten('prozess-liste.docx', testdatei('prozess-liste.docx'));
  assert.equal(a.art, 'text');
  assert.equal(a.text, '- Anruf geht beim Voicebot ein\n- Voicebot erkennt das Anliegen\n- Vorgang wird angelegt\n- Bestätigung wird verschickt');
  const v = I.textZuVorschlag(a.text);
  assert.equal(v.anzahl, 4);
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

test('CSV ohne bekannte Überschriften: erste Spalte wird zu Text', async () => {
  const a = await I.dateiAuswerten('liste.csv', puffer('Anruf annehmen;Team A\nAnliegen erfassen;Team B\n'));
  assert.equal(a.art, 'text');
  assert.equal(a.text, 'Anruf annehmen\nAnliegen erfassen');
  assert.ok(a.hinweis.includes('erste Spalte'));
});

test('Textdatei wird als Text übernommen und dann getrennt', async () => {
  const a = await I.dateiAuswerten('schritte.txt', puffer('1. Kunde ruft an, wartet\n\n2. Voicebot meldet sich\n'));
  assert.equal(a.art, 'text');
  const v = I.textZuVorschlag(a.text);
  assert.deepEqual(v.gruppen[0].schritte.map((s) => s.aktion), ['Ruft an, wartet', 'Voicebot meldet sich']);
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

/* ---------- Text in Schritte trennen ---------- */

function aktionen(v) {
  return v.gruppen.flatMap((g) => g.schritte.map((s) => s.aktion));
}

test('Fließtext wird in Sätze und Schritte aus Sicht der Person getrennt', () => {
  const v = I.textZuVorschlag(
    'Die Kundin bemerkt einen Wasserschaden. Dann ruft sie die Hotline an. Der Voicebot begrüßt sie, sie nennt ihr Anliegen. ' +
      'Leider wird das Anliegen erst beim zweiten Versuch erkannt. Danach wird sie an das Service-Team weitergeleitet. ' +
      'Zum Schluss erhält sie eine SMS und ist erleichtert.'
  );
  assert.deepEqual(aktionen(v), [
    'Bemerkt einen Wasserschaden',
    'Ruft die Hotline an',
    'Der Voicebot begrüßt sie',
    'Nennt ihr Anliegen',
    'Wird an das Service-Team weitergeleitet',
    'Erhält eine SMS und ist erleichtert',
  ]);
  const s = v.gruppen[0].schritte;
  assert.deepEqual(s[3].painPoints, ['Leider wird das Anliegen erst beim zweiten Versuch erkannt']);
  assert.equal(s[3].emotion, -1);
  assert.equal(s[1].touchpoint, 'Telefon');
  assert.equal(s[1].touchpointVorschlag, true);
  assert.equal(s[4].touchpoint, 'Service-Team');
  assert.equal(s[5].touchpoint, 'SMS');
  assert.equal(s[5].emotion, 1);
});

test('Überschriften werden Phasen, Zusätze gehören zum Schritt davor', () => {
  const v = I.textZuVorschlag(
    'Anliegen erkennen:\n- Bemerkt Schaden\n- Sucht Nummer auf der Website\nProblem: Nummer schwer zu finden\n\n' +
      '## Kontakt aufnehmen\n1. Ruft Hotline an\n2. Hört Begrüßung vom Voicebot\nGedanke: Ist das ein Anrufbeantworter?\n' +
      'Zitat: Ich dachte, ich bin falsch verbunden\nIntern: Anruf wird zum Voicebot geleitet\nTouchpoint: Voicebot\nEmotion: negativ'
  );
  assert.deepEqual(v.gruppen.map((g) => g.phase), ['Anliegen erkennen', 'Kontakt aufnehmen']);
  assert.deepEqual(aktionen(v), ['Bemerkt Schaden', 'Sucht Nummer auf der Website', 'Ruft Hotline an', 'Hört Begrüßung vom Voicebot']);
  const s = v.gruppen[1].schritte[1];
  assert.equal(s.gedanken, 'Ist das ein Anrufbeantworter?');
  assert.equal(s.zitat, 'Ich dachte, ich bin falsch verbunden');
  assert.equal(s.intern, 'Anruf wird zum Voicebot geleitet');
  assert.equal(s.touchpoint, 'Voicebot');
  assert.equal(s.touchpointVorschlag, false);
  assert.equal(s.emotion, -1);
  assert.deepEqual(v.gruppen[0].schritte[1].painPoints, ['Nummer schwer zu finden']);
});

test('Pfeile, Semikolons und Nummern in einer Zeile trennen Schritte', () => {
  assert.deepEqual(aktionen(I.textZuVorschlag('Ruft an → hört Ansage -> nennt Anliegen; erhält SMS')), [
    'Ruft an',
    'Hört Ansage',
    'Nennt Anliegen',
    'Erhält SMS',
  ]);
  assert.deepEqual(aktionen(I.textZuVorschlag('1. Anruf 2. Ansage 3. Anliegen nennen')), ['Anruf', 'Ansage', 'Anliegen nennen']);
});

test('Ordnungszahlen und Abkürzungen beenden keinen Satz', () => {
  assert.deepEqual(aktionen(I.textZuVorschlag('Am 3. Tag ruft sie an. Sie nennt z. B. die Wohnung.')), ['Am 3. Tag ruft sie an', 'Nennt z. B. die Wohnung']);
});

test('Gefühlssätze werden Emotion und Pain Point des Schritts davor', () => {
  const v = I.textZuVorschlag('Der Mieter meldet sich telefonisch. Er ist genervt, weil er lange warten muss. Danach nennt er sein Anliegen.');
  const s = v.gruppen[0].schritte;
  assert.equal(s.length, 2);
  assert.equal(s[0].emotion, -1);
  assert.deepEqual(s[0].painPoints, ['Lange warten muss']);
});

test('Nur nach Zeilen trennen, wenn gewünscht', () => {
  const text = 'Ruft an. Wartet.\nNennt Anliegen';
  assert.equal(I.textZuVorschlag(text).anzahl, 3);
  assert.equal(I.textZuVorschlag(text, { saetze: false }).anzahl, 2);
});

test('Umbrochene Zeilen aus PDF werden wieder zusammengefügt', () => {
  const v = I.textZuVorschlag('Die Kundin sucht auf der Website nach der Telefonnummer für\nSchadensmeldungen und findet sie nicht.');
  assert.equal(v.anzahl, 1);
});

test('Vorschlag übernehmen: Phasen, Felder, abgewählte Schritte und interner Ablauf', () => {
  const m = M.leereMap();
  const v = I.textZuVorschlag('Kontakt aufnehmen:\n- Ruft Hotline an\nProblem: Lange Warteschleife\n- Hört Ansage\n\nAbschluss:\n- Erhält SMS');
  v.gruppen[0].schritte[1].aktiv = false;
  const erg = I.vorschlagUebernehmen(m, v, {});
  assert.deepEqual(m.phasen.map((p) => p.name), ['Kontakt aufnehmen', 'Abschluss']);
  assert.equal(erg.schritte.length, 2);
  assert.equal(m.schritte[0].aktion, 'Ruft Hotline an');
  assert.equal(m.schritte[0].touchpoint, 'Telefon');
  assert.deepEqual(m.schritte[0].painPoints.map((pp) => pp.text), ['Lange Warteschleife']);
  assert.equal(m.schritte[1].phaseId, m.phasen[1].id);

  const m2 = M.leereMap();
  I.vorschlagUebernehmen(m2, I.textZuVorschlag('Vorgang wird angelegt'), { als: 'intern' });
  assert.equal(m2.schritte[0].aktion, '');
  assert.equal(m2.schritte[0].intern, 'Vorgang wird angelegt');
});
