/*
 * Prüfregeln aus den Rahmendaten:
 *  - Vollständig: alle Pflichtangaben je Schritt, jeder Pain Point hat eine Quelle.
 *  - Rückfrage: Schritt ohne Touchpoint, Pain Point ohne Beleg, widersprüchliche Angaben,
 *    Hinweis auf personenbezogene Daten.
 *
 * Jeder Prüfpunkt hat einen Typ:
 *  - "fehlt"      Pflichtangabe fehlt (blockiert Prüfung und Freigabe)
 *  - "rueckfrage" muss geklärt werden (blockiert Prüfung und Freigabe)
 *  - "hinweis"    bitte ansehen (blockiert nicht)
 * und eine Art:
 *  - "pflicht"    erst anzeigen, wenn alles geprüft wird (Reiter „Prüfung“ oder geladene Datei)
 *  - "inhalt"     sofort anzeigen (betrifft das, was eingegeben wurde)
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.JMPruefung = factory(root.JMModell);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Modell) {
  'use strict';

  const RAHMEN_FELDER = {
    titel: 'Titel',
    anlass: 'Anlass und Rahmen',
    nutzergruppe: 'Nutzergruppe',
    startpunkt: 'Startpunkt',
    endpunkt: 'Endpunkt',
    erfasstVon: 'Erfasst von',
    fachbereich: 'Prüfender Fachbereich',
  };
  const RAHMEN_PFLICHT = ['titel', 'anlass', 'nutzergruppe', 'startpunkt', 'endpunkt'];

  /** Ab dieser Länge wirkt ein Feld wie Rohtext oder Transkript. */
  const GRENZE_ROHTEXT = 500;
  /** Zitate sollen kurz sein. */
  const GRENZE_ZITAT = 200;

  /*
   * Muster für mögliche Personendaten. Bewusst eher vorsichtig: Ein Treffer ist eine Rückfrage,
   * kein Beweis. Reihenfolge ist wichtig, weil Treffer vor dem nächsten Muster entfernt werden
   * (eine Telefonnummer soll nicht zusätzlich als „lange Nummer“ zählen).
   */
  const PERSONEN_MUSTER = [
    { art: 'E-Mail-Adresse', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { art: 'IBAN', re: /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/g },
    {
      art: 'Telefonnummer',
      re: /(?:\+|\b00)\d{2}[\s/.-]?\(?\d{1,5}\)?(?:[\s/.-]?\d{2,})+|\b0\d{2,5}(?:[\s/-]?\d{2,}){2,}/g,
    },
    { art: 'Geburtsdatum', re: /\b(?:geb\.|geboren(?:\s+am)?)\s*\d{1,2}\.\s?\d{1,2}\.\s?\d{2,4}/gi },
    {
      art: 'Anschrift',
      re: /\b[A-ZÄÖÜ][a-zäöüß-]+(?:straße|strasse|str\.|weg|allee|platz|damm|ring|ufer|chaussee|gasse|steig|pfad)\s*\d+\s?[a-zA-Z]?\b/g,
    },
    { art: 'Anrede mit Namen', re: /\b(?:Herr|Herrn|Frau|Hr\.|Fr\.)\s+(?:Dr\.\s+)?[A-ZÄÖÜ][a-zäöüß]+/g },
    {
      art: 'Kunden-, Vertrags- oder Mieternummer',
      re: /\b(?:Kunden|Vertrags|Mieter|Objekt|Konto|Personal|Akten)[\s-]?(?:nr\.?|nummer)\s*[:#]?\s*[A-Z0-9/-]*\d|\b\d{6,}\b/gi,
    },
  ];

  function leer(v) {
    return !String(v || '').trim();
  }

  function norm(v) {
    return String(v || '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  }

  /** Liefert die Arten möglicher Personendaten in einem Text (ohne die Fundstellen selbst). */
  function personenbezugFinden(text) {
    let rest = String(text || '');
    const arten = [];
    for (const muster of PERSONEN_MUSTER) {
      muster.re.lastIndex = 0;
      if (muster.re.test(rest)) {
        arten.push(muster.art);
        muster.re.lastIndex = 0;
        rest = rest.replace(muster.re, ' ');
      }
      muster.re.lastIndex = 0;
    }
    return arten;
  }

  function bezugGueltig(map, bezug) {
    if (bezug === 'allgemein' || bezug === 'rahmen') return true;
    const [art, id] = String(bezug || '').split(':');
    if (art === 'phase') return map.phasen.some((p) => p.id === id);
    if (art === 'schritt') return map.schritte.some((s) => s.id === id);
    return false;
  }

  function pruefen(map) {
    const probleme = [];
    const add = (typ, tab, feldId, ort, kurz, art) =>
      probleme.push({ typ, tab, feldId, ort, kurz, text: ort ? ort + ': ' + kurz : kurz, art: art || 'pflicht' });

    /* --- Rahmen --- */
    for (const k of RAHMEN_PFLICHT) {
      if (leer(map.rahmen[k])) add('fehlt', 'rahmen', 'f-rahmen-' + k, 'Rahmen', RAHMEN_FELDER[k] + ' fehlt.');
    }
    if (!leer(map.rahmen.startpunkt) && norm(map.rahmen.startpunkt) === norm(map.rahmen.endpunkt)) {
      add('rueckfrage', 'rahmen', 'f-rahmen-endpunkt', 'Rahmen', 'Start- und Endpunkt sind gleich. Bitte prüfen.', 'inhalt');
    }

    /* --- Phasen --- */
    if (!map.phasen.length) add('fehlt', 'schritte', 'f-phase-neu', 'Phasen', 'Mindestens eine Phase anlegen.');
    const phasenNamen = new Set();
    map.phasen.forEach((p, i) => {
      const ort = 'Phase ' + (i + 1);
      const feldId = 'f-phase-' + p.id + '-name';
      if (leer(p.name)) {
        add('fehlt', 'schritte', feldId, ort, 'Name fehlt.');
      } else {
        if (phasenNamen.has(norm(p.name))) {
          add('rueckfrage', 'schritte', feldId, ort, 'Diesen Phasennamen gibt es doppelt.', 'inhalt');
        }
        phasenNamen.add(norm(p.name));
      }
      if (!map.schritte.some((s) => s.phaseId === p.id)) {
        add('hinweis', 'schritte', feldId, ort, 'Enthält noch keine Schritte.');
      }
    });

    /* --- Schritte und Pain Points --- */
    if (!map.schritte.length) add('fehlt', 'schritte', 'f-schritt-neu', 'Schritte', 'Noch kein Schritt erfasst.');
    const phasenIds = new Set(map.phasen.map((p) => p.id));
    const quellenIds = new Set(map.quellen.map((q) => q.id));
    const genutzteQuellen = new Set();
    const aktionen = new Map();

    Modell.geordneteSchritte(map).forEach((s, i) => {
      const ort = 'Schritt ' + (i + 1);
      const f = (feld) => 'f-schritt-' + s.id + '-' + feld;

      if (!phasenIds.has(s.phaseId)) add('fehlt', 'schritte', f('phase'), ort, 'Keiner Phase zugeordnet.');
      if (leer(s.aktion)) {
        add('fehlt', 'schritte', f('aktion'), ort, 'Aktion fehlt.');
      } else {
        const schluessel = norm(s.aktion);
        if (aktionen.has(schluessel)) {
          add('hinweis', 'schritte', f('aktion'), ort, 'Gleiche Aktion wie ' + aktionen.get(schluessel) + '. Doppelt erfasst?', 'inhalt');
        } else {
          aktionen.set(schluessel, ort);
        }
      }
      if (leer(s.touchpoint)) {
        add('rueckfrage', 'schritte', f('touchpoint'), ort, 'Touchpoint fehlt. Über welchen Kanal oder Kontaktpunkt läuft der Schritt?');
      }
      if (s.emotion === null) add('fehlt', 'schritte', f('emotion'), ort, 'Emotion fehlt.');

      s.painPoints.forEach((pp, j) => {
        const ppOrt = ort + ', Pain Point ' + (j + 1);
        if (leer(pp.text)) add('fehlt', 'schritte', 'f-pp-' + pp.id + '-text', ppOrt, 'Beschreibung fehlt.');
        if (leer(pp.quelleId)) {
          add('rueckfrage', 'schritte', 'f-pp-' + pp.id + '-quelle', ppOrt, 'Beleg fehlt. Bitte eine Quelle zuordnen.');
        } else if (!quellenIds.has(pp.quelleId)) {
          add('rueckfrage', 'schritte', 'f-pp-' + pp.id + '-quelle', ppOrt, 'Die zugeordnete Quelle gibt es nicht mehr.', 'inhalt');
        } else {
          genutzteQuellen.add(pp.quelleId);
        }
      });

      if (s.emotion !== null && s.emotion >= 1 && s.painPoints.length) {
        add('hinweis', 'schritte', f('emotion'), ort, 'Positive Emotion, aber Pain Points erfasst. Passt das zusammen?', 'inhalt');
      }
      if (s.emotion !== null && s.emotion <= -1 && !s.painPoints.length) {
        add('hinweis', 'schritte', f('emotion'), ort, 'Negative Emotion ohne Pain Point. Was löst sie aus?', 'inhalt');
      }
      if (s.zitat.trim().length > GRENZE_ZITAT) {
        add(
          'rueckfrage',
          'schritte',
          f('zitat'),
          ort,
          'Zitat ist sehr lang (über ' + GRENZE_ZITAT + ' Zeichen). Bitte nur kurze, anonymisierte Zitate, keine Transkript-Auszüge.',
          'inhalt'
        );
      }
    });

    /* --- Quellen (Material) --- */
    if (!map.quellen.length) {
      add('hinweis', 'material', 'f-quelle-neu', 'Material', 'Noch keine Quellen erfasst. Ohne Quellen lassen sich Pain Points nicht belegen.');
    }
    map.quellen.forEach((q, i) => {
      const ort = 'Quelle Q' + (i + 1);
      const f = (feld) => 'f-quelle-' + q.id + '-' + feld;
      if (leer(q.bezeichnung)) add('fehlt', 'material', f('bezeichnung'), ort, 'Bezeichnung fehlt.');
      if (leer(q.art)) add('fehlt', 'material', f('art'), ort, 'Art der Quelle fehlt.');
      if (!q.anonymisiert) add('rueckfrage', 'material', f('anonymisiert'), ort, 'Anonymisierung ist noch nicht bestätigt.');
      if (!genutzteQuellen.has(q.id)) add('hinweis', 'material', f('bezeichnung'), ort, 'Wird von keinem Pain Point genutzt.');
    });
    if (map.quellen.length) {
      const sichten = new Set(map.quellen.map((q) => (Modell.artInfo(q.art) || {}).sicht).filter(Boolean));
      for (const [sicht, label] of Object.entries(Modell.SICHTEN)) {
        if (!sichten.has(sicht)) {
          add('hinweis', 'material', 'f-quelle-neu', 'Lückencheck', 'Keine Quelle aus „' + label + '“. Fehlt hier Material?');
        }
      }
    }

    /* --- Rückmeldungen --- */
    map.rueckmeldungen.forEach((rm, i) => {
      const ort = 'Rückmeldung ' + (i + 1);
      const f = (feld) => 'f-rm-' + rm.id + '-' + feld;
      if (leer(rm.text)) add('fehlt', 'pruefung', f('text'), ort, 'Text der Rückmeldung fehlt.');
      if (rm.status === 'abgelehnt' && leer(rm.antwort)) {
        add('rueckfrage', 'pruefung', f('antwort'), ort, 'Nicht übernommen, aber ohne Begründung.');
      }
      if (!bezugGueltig(map, rm.bezug)) {
        add('hinweis', 'pruefung', f('bezug'), ort, 'Der Bezug (Phase oder Schritt) existiert nicht mehr.', 'inhalt');
      }
    });
    if (map.version.status === 'freigegeben' && map.rueckmeldungen.some((r) => r.status === 'offen')) {
      add(
        'hinweis',
        'pruefung',
        'f-rm-neu',
        'Status',
        'Die Fassung ist freigegeben, aber es gibt offene Rückmeldungen. Für Änderungen eine neue Fassung beginnen.',
        'inhalt'
      );
    }

    /* --- Personenbezug und Rohtext in allen Freitexten --- */
    const textfelder = [];
    for (const [k, label] of Object.entries(RAHMEN_FELDER)) {
      textfelder.push({ tab: 'rahmen', feldId: 'f-rahmen-' + k, ort: 'Rahmen, ' + label, wert: map.rahmen[k] });
    }
    map.phasen.forEach((p, i) =>
      textfelder.push({ tab: 'schritte', feldId: 'f-phase-' + p.id + '-name', ort: 'Phase ' + (i + 1), wert: p.name })
    );
    Modell.geordneteSchritte(map).forEach((s, i) => {
      const ort = 'Schritt ' + (i + 1);
      const felder = { aktion: 'Aktion', touchpoint: 'Touchpoint', gedanken: 'Gedanken', zitat: 'Zitat' };
      for (const [k, label] of Object.entries(felder)) {
        textfelder.push({ tab: 'schritte', feldId: 'f-schritt-' + s.id + '-' + k, ort: ort + ', ' + label, wert: s[k] });
      }
      s.painPoints.forEach((pp, j) =>
        textfelder.push({
          tab: 'schritte',
          feldId: 'f-pp-' + pp.id + '-text',
          ort: ort + ', Pain Point ' + (j + 1),
          wert: pp.text,
        })
      );
    });
    map.quellen.forEach((q, i) =>
      textfelder.push({ tab: 'material', feldId: 'f-quelle-' + q.id + '-bezeichnung', ort: 'Quelle Q' + (i + 1), wert: q.bezeichnung })
    );
    map.rueckmeldungen.forEach((rm, i) => {
      const ort = 'Rückmeldung ' + (i + 1);
      textfelder.push({ tab: 'pruefung', feldId: 'f-rm-' + rm.id + '-von', ort: ort + ', von', wert: rm.von });
      textfelder.push({ tab: 'pruefung', feldId: 'f-rm-' + rm.id + '-text', ort: ort, wert: rm.text });
      textfelder.push({ tab: 'pruefung', feldId: 'f-rm-' + rm.id + '-antwort', ort: ort + ', Antwort', wert: rm.antwort });
    });
    if (map.version.freigabe) {
      textfelder.push({ tab: 'pruefung', feldId: null, ort: 'Freigabe', wert: map.version.freigabe.durch });
    }
    map.historie.forEach((e, i) => {
      textfelder.push({ tab: 'pruefung', feldId: null, ort: 'Versionshistorie, Eintrag ' + (i + 1), wert: e.notiz + ' ' + e.durch });
    });

    for (const t of textfelder) {
      const arten = personenbezugFinden(t.wert);
      if (arten.length) {
        add(
          'rueckfrage',
          t.tab,
          t.feldId,
          t.ort,
          'Möglicher Personenbezug (' + arten.join(', ') + '). Bitte entfernen oder durch einen Platzhalter ersetzen.',
          'inhalt'
        );
      }
      if (!t.feldId || !t.feldId.endsWith('-zitat')) {
        if (String(t.wert || '').trim().length > GRENZE_ROHTEXT) {
          add(
            'rueckfrage',
            t.tab,
            t.feldId,
            t.ort,
            'Sehr langer Text (über ' + GRENZE_ROHTEXT + ' Zeichen). Bitte zusammenfassen, keine Rohdaten oder Transkripte.',
            'inhalt'
          );
        }
      }
    }

    const zaehler = { fehlt: 0, rueckfrage: 0, hinweis: 0 };
    for (const p of probleme) zaehler[p.typ] += 1;
    return { probleme, zaehler, vollstaendig: zaehler.fehlt + zaehler.rueckfrage === 0 };
  }

  return { pruefen, personenbezugFinden, GRENZE_ROHTEXT, GRENZE_ZITAT, RAHMEN_FELDER };
});
