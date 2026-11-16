/*
 * Tests für Datenmodell und Prüfregeln. Laufen mit dem eingebauten Test-Runner von Node.js,
 * ohne zusätzliche Pakete:  node --test tests/
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../js/model.js');
const P = require('../js/checks.js');
const B = require('../js/beispiel.js');

function vollstaendigeMap() {
  const r = M.ausJson(JSON.stringify(B.beispielMap()));
  assert.ok(r.ok);
  return r.map;
}

function texte(pruefung, typ) {
  return pruefung.probleme.filter((p) => !typ || p.typ === typ).map((p) => p.text);
}

test('leere Map ist nicht vollständig und nennt die Pflichtangaben', () => {
  const pr = P.pruefen(M.leereMap());
  assert.equal(pr.vollstaendig, false);
  const fehlt = texte(pr, 'fehlt');
  for (const erwartet of ['Titel fehlt', 'Anlass und Rahmen fehlt', 'Nutzergruppe fehlt', 'Startpunkt fehlt', 'Endpunkt fehlt', 'Noch kein Schritt']) {
    assert.ok(fehlt.some((t) => t.includes(erwartet)), 'erwartet: ' + erwartet);
  }
});

test('das fiktive Beispiel ist vollständig und ohne Personenbezug', () => {
  const pr = P.pruefen(vollstaendigeMap());
  assert.equal(pr.vollstaendig, true, texte(pr).join('\n'));
  assert.equal(pr.zaehler.rueckfrage, 0);
});

test('Schritt ohne Touchpoint ist eine Rückfrage und blockiert', () => {
  const m = vollstaendigeMap();
  m.schritte[0].touchpoint = '  ';
  const pr = P.pruefen(m);
  assert.equal(pr.vollstaendig, false);
  assert.ok(texte(pr, 'rueckfrage').some((t) => t.includes('Touchpoint fehlt')));
});

test('Pain Point ohne Beleg oder mit gelöschter Quelle ist eine Rückfrage', () => {
  const m = vollstaendigeMap();
  m.schritte[0].painPoints[0].quelleId = '';
  m.schritte[2].painPoints[0].quelleId = 'q-gibtsnicht';
  const rueck = texte(P.pruefen(m), 'rueckfrage');
  assert.ok(rueck.some((t) => t.includes('Beleg fehlt')));
  assert.ok(rueck.some((t) => t.includes('Quelle gibt es nicht mehr')));
});

test('nicht bestätigte Anonymisierung einer Quelle ist eine Rückfrage', () => {
  const m = vollstaendigeMap();
  m.quellen[0].anonymisiert = false;
  assert.ok(texte(P.pruefen(m), 'rueckfrage').some((t) => t.includes('Anonymisierung')));
});

test('widersprüchliche Angaben werden gemeldet', () => {
  const m = vollstaendigeMap();
  m.rahmen.endpunkt = m.rahmen.startpunkt;
  m.phasen[1].name = m.phasen[0].name.toUpperCase();
  const pr = P.pruefen(m);
  assert.ok(texte(pr, 'rueckfrage').some((t) => t.includes('Start- und Endpunkt sind gleich')));
  assert.ok(texte(pr, 'rueckfrage').some((t) => t.includes('doppelt')));
});

test('Hinweise auf Personendaten werden erkannt', () => {
  const faelle = {
    'Mail an max.muster@example.org': 'E-Mail-Adresse',
    'IBAN DE89 3704 0044 0532 0130 00': 'IBAN',
    'Rückruf unter 030 1234567': 'Telefonnummer',
    'Hotline +49 30 12345678': 'Telefonnummer',
    'wohnt Musterstraße 12': 'Anschrift',
    'Frau Schulz rief an': 'Anrede mit Namen',
    'Kundennummer: 4711': 'Kunden-, Vertrags- oder Mieternummer',
    'Vertrag 12345678': 'Kunden-, Vertrags- oder Mieternummer',
    'geb. 01.02.1980': 'Geburtsdatum',
  };
  for (const [text, art] of Object.entries(faelle)) {
    assert.deepEqual(P.personenbezugFinden(text), [art], text);
  }
});

test('übliche Angaben lösen keinen Personenbezug aus', () => {
  for (const text of ['Stand 2026-11-16', '01.10.2026', 'Schritt 3 von 7', '1.200 Anrufe pro Monat', 'Q3', 'Frau oder Mann', 'drückt die 0', 'Service-Hotline']) {
    assert.deepEqual(P.personenbezugFinden(text), [], text);
  }
});

test('Personenbezug in einem Freitext macht die Map unvollständig', () => {
  const m = vollstaendigeMap();
  m.schritte[1].gedanken = 'Herr Meier hat angerufen';
  const pr = P.pruefen(m);
  assert.equal(pr.vollstaendig, false);
  assert.ok(texte(pr, 'rueckfrage').some((t) => t.startsWith('Schritt 2, Gedanken') && t.includes('Personenbezug')));
});

test('sehr lange Texte und Zitate werden als mögliche Rohdaten gemeldet', () => {
  const m = vollstaendigeMap();
  m.schritte[0].zitat = 'x'.repeat(P.GRENZE_ZITAT + 1);
  m.schritte[1].gedanken = 'y'.repeat(P.GRENZE_ROHTEXT + 1);
  const rueck = texte(P.pruefen(m), 'rueckfrage');
  assert.ok(rueck.some((t) => t.includes('Zitat ist sehr lang')));
  assert.ok(rueck.some((t) => t.includes('Sehr langer Text')));
});

test('Lückencheck meldet fehlende Sichten als Hinweis', () => {
  const m = vollstaendigeMap();
  m.quellen = m.quellen.filter((q) => q.art !== 'interview');
  for (const s of m.schritte) {
    if (s.quelleId === 'q-interviews') s.quelleId = 'q-workshop';
    for (const pp of s.painPoints) if (pp.quelleId === 'q-interviews') pp.quelleId = 'q-workshop';
  }
  const pr = P.pruefen(m);
  assert.equal(pr.vollstaendig, true);
  assert.ok(texte(pr, 'hinweis').some((t) => t.includes('Kundensicht')));
});

test('Status-Ablauf: Prüfung, Überarbeitung, Freigabe, neue Fassung mit Versionsnummern', () => {
  const m = vollstaendigeMap();
  // Beispiel steht in Überarbeitung 0.2 mit einer offenen Rückmeldung
  const pr = P.pruefen(m);
  assert.deepEqual(M.verfuegbareAktionen(m), ['zurPruefung', 'freigeben']);
  const gruende = M.hindernisse(m, 'freigeben', pr, { durch: '' });
  assert.ok(gruende.some((g) => g.includes('Rückmeldung ist noch offen')));
  assert.ok(gruende.some((g) => g.includes('wer freigibt')));

  M.aktionAusfuehren(m, 'zurPruefung', { notiz: 'zweite Runde' });
  assert.equal(m.version.status, 'in_pruefung');
  assert.equal(m.version.nummer, '0.2');
  assert.equal(M.bearbeitbar(m), false);

  m.rueckmeldungen.forEach((r) => {
    r.status = 'uebernommen';
  });
  assert.deepEqual(M.hindernisse(m, 'freigeben', P.pruefen(m), { durch: 'Fachbereich Kundenservice' }), []);
  M.aktionAusfuehren(m, 'freigeben', { durch: 'Fachbereich Kundenservice' });
  assert.equal(m.version.status, 'freigegeben');
  assert.equal(m.version.nummer, '1.0');
  assert.equal(m.version.freigabe.durch, 'Fachbereich Kundenservice');

  let erledigt = M.erledigtStand(m, P.pruefen(m));
  assert.equal(erledigt.erledigt, false, 'ohne Export noch nicht erledigt');
  M.exportVermerken(m);
  erledigt = M.erledigtStand(m, P.pruefen(m));
  assert.equal(erledigt.erledigt, true);

  M.aktionAusfuehren(m, 'neueFassung', {});
  assert.equal(m.version.status, 'entwurf');
  assert.equal(m.version.nummer, '1.1');
  assert.equal(M.erledigtStand(m, P.pruefen(m)).erledigt, false);
});

test('Zur Prüfung geben ist bei unvollständiger Map nicht möglich', () => {
  const m = M.leereMap();
  const gruende = M.hindernisse(m, 'zurPruefung', P.pruefen(m), {});
  assert.ok(gruende.length > 0);
});

test('Datei laden: falsches Format wird abgelehnt, fehlende Felder werden ergänzt', () => {
  assert.equal(M.ausJson('kein json').ok, false);
  assert.equal(M.ausJson('{"schema":"etwas-anderes"}').ok, false);
  assert.equal(M.ausJson(JSON.stringify({ schema: M.SCHEMA, schemaVersion: 99 })).ok, false);

  const r = M.ausJson(
    JSON.stringify({
      schema: M.SCHEMA,
      schemaVersion: 1,
      rahmen: { titel: 'Nur Titel' },
      version: { status: 'unbekannt', nummer: 'abc' },
      schritte: [{ id: 'x y', emotion: 7, painPoints: [{}] }],
    })
  );
  assert.ok(r.ok);
  assert.equal(r.map.rahmen.titel, 'Nur Titel');
  assert.equal(r.map.rahmen.anlass, '');
  assert.equal(r.map.version.status, 'entwurf');
  assert.equal(r.map.version.nummer, '0.1');
  assert.equal(r.map.schritte[0].emotion, null);
  assert.match(r.map.schritte[0].id, /^[A-Za-z0-9_-]+$/);
  assert.equal(r.map.schritte[0].painPoints.length, 1);
});

test('Speichern und Laden ergibt dieselbe Map', () => {
  const m = vollstaendigeMap();
  const r = M.ausJson(M.zuJson(m));
  assert.ok(r.ok);
  assert.deepEqual(r.map, m);
});

test('Dateiname enthält Titel, Version und Stand', () => {
  const m = vollstaendigeMap();
  assert.equal(
    M.dateiname(m, 'json'),
    'journey-map_beispiel-fiktiv-schaden-telefonisch-melden-ueber_v0.2_2026-11-12.json'
  );
  assert.equal(M.dateiname(M.leereMap(), 'pdf').startsWith('journey-map_ohne-titel_v0.1_'), true);
});

test('Liste: Aufzählungszeichen, Nummern und Leerzeilen werden entfernt', () => {
  const text = '- Anruf annehmen\n• Anliegen erfassen\n\n1. Kunde ruft an\n2) Weiterleitung\n(3) Ticket\n1.2 Vorgang anlegen\na) Prüfung\n24 Stunden warten\n   \n\tmit\tTabs';
  assert.deepEqual(M.zeilenZuEintraegen(text), [
    'Anruf annehmen',
    'Anliegen erfassen',
    'Kunde ruft an',
    'Weiterleitung',
    'Ticket',
    'Vorgang anlegen',
    'Prüfung',
    '24 Stunden warten',
    'mit Tabs',
  ]);
});

test('Liste: Schritte werden als Aktion oder interner Ablauf mit Phase und Quelle angelegt', () => {
  const m = vollstaendigeMap();
  const vorher = m.schritte.length;
  const alsAktion = M.schritteAusListe(m, { text: 'Ruft an\nNennt Anliegen', als: 'aktion', phaseId: 'ph-kontakt', quelleId: 'q-workshop' });
  assert.equal(alsAktion.length, 2);
  assert.equal(alsAktion[0].aktion, 'Ruft an');
  assert.equal(alsAktion[0].intern, '');
  assert.equal(alsAktion[0].phaseId, 'ph-kontakt');
  assert.equal(alsAktion[0].quelleId, 'q-workshop');

  const alsIntern = M.schritteAusListe(m, { text: 'Vorgang anlegen', als: 'intern', phaseId: 'ph-abschluss' });
  assert.equal(alsIntern[0].intern, 'Vorgang anlegen');
  assert.equal(alsIntern[0].aktion, '');
  assert.equal(m.schritte.length, vorher + 3);

  // neu angelegte Schritte sind noch unvollständig: Touchpoint, Emotion und ggf. Aktion fehlen
  const fehlt = texte(P.pruefen(m));
  assert.ok(fehlt.some((t) => t.includes('Aktion fehlt')));
  assert.ok(fehlt.some((t) => t.includes('Touchpoint fehlt')));
  assert.ok(fehlt.some((t) => t.includes('Emotion fehlt')));
});

test('Liste: höchstens 50 Schritte auf einmal', () => {
  const m = M.leereMap();
  const text = Array.from({ length: 60 }, (_, i) => 'Schritt ' + (i + 1)).join('\n');
  assert.equal(M.schritteAusListe(m, { text, als: 'aktion', phaseId: m.phasen[0].id }).length, M.MAX_LISTENSCHRITTE);
});

test('Quelle eines Schritts zählt als Nutzung, eine gelöschte Quelle ist eine Rückfrage', () => {
  const m = vollstaendigeMap();
  // Q1 belegt nur noch einen Schritt, keinen Pain Point mehr
  m.schritte[0].painPoints[0].quelleId = 'q-workshop';
  assert.equal(m.schritte[0].quelleId, 'q-interviews');
  assert.ok(!texte(P.pruefen(m), 'hinweis').some((t) => t.startsWith('Quelle Q1')));

  m.schritte[0].quelleId = 'q-gibtsnicht';
  assert.ok(texte(P.pruefen(m), 'rueckfrage').some((t) => t.includes('Quelle des Schritts gibt es nicht mehr')));
});

test('interner Ablauf wird auf Personenbezug geprüft', () => {
  const m = vollstaendigeMap();
  m.schritte[1].intern = 'Rückruf durch Frau Meier unter 030 1234567';
  assert.ok(texte(P.pruefen(m), 'rueckfrage').some((t) => t.startsWith('Schritt 2, Interner Ablauf') && t.includes('Personenbezug')));
});

test('ältere Dateien ohne Quelle und internen Ablauf je Schritt lassen sich laden', () => {
  const alt = B.beispielMap();
  for (const s of alt.schritte) {
    delete s.quelleId;
    delete s.intern;
  }
  const r = M.ausJson(JSON.stringify(alt));
  assert.ok(r.ok);
  assert.equal(r.map.schritte[0].quelleId, '');
  assert.equal(r.map.schritte[0].intern, '');
  assert.equal(P.pruefen(r.map).vollstaendig, true);
});
