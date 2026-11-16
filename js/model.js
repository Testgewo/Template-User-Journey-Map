/*
 * Datenmodell, Versionierung und Status-Ablauf der Journey Map.
 * Ohne Zugriff auf die Oberfläche, damit die Logik auch in Tests (Node.js) läuft.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.JMModell = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA = 'journey-map-vorlage';
  const SCHEMA_VERSION = 1;

  const STATUS = {
    entwurf: { label: 'Entwurf', bearbeitbar: true },
    in_pruefung: { label: 'In fachlicher Prüfung', bearbeitbar: false },
    in_ueberarbeitung: { label: 'In Überarbeitung', bearbeitbar: true },
    freigegeben: { label: 'Freigegeben', bearbeitbar: false },
  };
  const STATUS_REIHENFOLGE = ['entwurf', 'in_pruefung', 'in_ueberarbeitung', 'freigegeben'];

  const EMOTIONEN = [
    { wert: 2, label: 'sehr positiv', symbol: '😀' },
    { wert: 1, label: 'positiv', symbol: '🙂' },
    { wert: 0, label: 'neutral', symbol: '😐' },
    { wert: -1, label: 'negativ', symbol: '🙁' },
    { wert: -2, label: 'sehr negativ', symbol: '😣' },
  ];

  const SICHTEN = {
    kunde: 'Kundensicht',
    prozess: 'Prozesssicht',
    daten: 'Daten und Kennzahlen',
  };

  const QUELLEN_ARTEN = [
    { id: 'interview', label: 'Interview', sicht: 'kunde' },
    { id: 'umfrage', label: 'Umfrage', sicht: 'kunde' },
    { id: 'beobachtung', label: 'Beobachtung oder Nutzertest', sicht: 'kunde' },
    { id: 'workshop', label: 'Workshop', sicht: 'prozess' },
    { id: 'prozessdoku', label: 'Prozessdokumentation', sicht: 'prozess' },
    { id: 'fachbereich', label: 'Prozesswissen Fachbereich', sicht: 'prozess' },
    { id: 'auswertung', label: 'Auswertung oder Kennzahlen (aggregiert)', sicht: 'daten' },
    { id: 'sonstiges', label: 'Sonstiges', sicht: null },
  ];

  const RUECKMELDUNG_STATUS = {
    offen: 'offen',
    uebernommen: 'übernommen',
    abgelehnt: 'nicht übernommen',
  };

  const KANAELE = ['Direkt erfasst', 'E-Mail', 'Teams', 'Termin', 'Telefon', 'Sonstiges'];

  const EREIGNISSE = {
    angelegt: 'Angelegt',
    zur_pruefung: 'Zur fachlichen Prüfung gegeben',
    ueberarbeitung: 'Rückmeldungen werden eingearbeitet',
    freigegeben: 'Freigegeben',
    neue_fassung: 'Neue Fassung begonnen',
    export: 'Exportiert',
  };

  const AKTIONEN = {
    zurPruefung: {
      label: 'Zur fachlichen Prüfung geben',
      von: ['entwurf', 'in_ueberarbeitung'],
      nach: 'in_pruefung',
      ereignis: 'zur_pruefung',
      version: null,
    },
    ueberarbeiten: {
      label: 'Rückmeldungen einarbeiten',
      von: ['in_pruefung'],
      nach: 'in_ueberarbeitung',
      ereignis: 'ueberarbeitung',
      version: 'neben',
    },
    freigeben: {
      label: 'Freigeben',
      von: ['in_pruefung', 'in_ueberarbeitung'],
      nach: 'freigegeben',
      ereignis: 'freigegeben',
      version: 'haupt',
    },
    neueFassung: {
      label: 'Neue Fassung beginnen',
      von: ['freigegeben'],
      nach: 'entwurf',
      ereignis: 'neue_fassung',
      version: 'neben',
    },
  };

  /* ---------- Hilfsfunktionen ---------- */

  function heute(datum) {
    const d = datum || new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  let zaehler = 0;
  function neueId(praefix) {
    zaehler += 1;
    return (
      praefix + '-' + Date.now().toString(36) + zaehler.toString(36) + Math.random().toString(36).slice(2, 6)
    );
  }

  function neuePhase(name) {
    return { id: neueId('ph'), name: name || '' };
  }

  function neuerSchritt(phaseId) {
    return {
      id: neueId('s'),
      phaseId: phaseId || '',
      aktion: '',
      touchpoint: '',
      emotion: null,
      gedanken: '',
      zitat: '',
      painPoints: [],
      quelleId: '',
      intern: '',
    };
  }

  function neuerPainPoint() {
    return { id: neueId('pp'), text: '', quelleId: '' };
  }

  function neueQuelle() {
    return { id: neueId('q'), bezeichnung: '', art: '', stand: '', anonymisiert: false };
  }

  function neueRueckmeldung() {
    return {
      id: neueId('rm'),
      bezug: 'allgemein',
      von: '',
      kanal: '',
      datum: heute(),
      text: '',
      status: 'offen',
      antwort: '',
    };
  }

  function leereMap() {
    const datum = heute();
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      rahmen: {
        titel: '',
        anlass: '',
        nutzergruppe: '',
        startpunkt: '',
        endpunkt: '',
        erfasstVon: '',
        fachbereich: '',
      },
      version: { nummer: '0.1', status: 'entwurf', stand: datum, freigabe: null, letzterExport: null },
      phasen: [neuePhase('')],
      schritte: [],
      quellen: [],
      rueckmeldungen: [],
      historie: [{ datum, version: '0.1', ereignis: 'angelegt', notiz: '', durch: '' }],
    };
  }

  /** Schritte in Map-Reihenfolge: nach Phasen sortiert, innerhalb der Phase in Erfassungsreihenfolge. */
  function geordneteSchritte(map) {
    const ergebnis = [];
    const phasenIds = new Set(map.phasen.map((p) => p.id));
    for (const phase of map.phasen) {
      for (const s of map.schritte) if (s.phaseId === phase.id) ergebnis.push(s);
    }
    for (const s of map.schritte) if (!phasenIds.has(s.phaseId)) ergebnis.push(s);
    return ergebnis;
  }

  /* ---------- Schritte aus einer Liste ---------- */

  /** Höchstzahl der Schritte, die auf einmal aus einer Liste angelegt werden. */
  const MAX_LISTENSCHRITTE = 50;

  /*
   * Aufzählungszeichen und Nummerierungen am Zeilenanfang: „- “, „• “, „1. “, „1) “, „(1) “, „1.2 “, „a) “.
   * Eine Zahl ohne Satzzeichen („24 Stunden …“) bleibt stehen.
   */
  const LISTENPRAEFIX = /^(?:[-*•–·>▪◦]+|\(?\d{1,3}(?:\.\d{1,3})*[.):]|\d{1,3}(?:\.\d{1,3})+|[a-z]\))\s+/;

  /** Zerlegt eingefügten Text in Einträge: eine Zeile je Schritt, ohne Aufzählungszeichen und Leerzeilen. */
  function zeilenZuEintraegen(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map((zeile) =>
        zeile
          .replace(/\t+/g, ' ')
          .trim()
          .replace(LISTENPRAEFIX, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .filter(Boolean);
  }

  /**
   * Legt aus einer Liste neue Schritte in einer Phase an.
   * o: text, als ('aktion' | 'intern'), phaseId, quelleId (optional). Liefert die neuen Schritte.
   */
  function schritteAusListe(map, o) {
    const neu = zeilenZuEintraegen(o.text)
      .slice(0, MAX_LISTENSCHRITTE)
      .map((eintrag) => {
        const schritt = neuerSchritt(o.phaseId);
        if (o.als === 'intern') schritt.intern = eintrag;
        else schritt.aktion = eintrag;
        schritt.quelleId = o.quelleId || '';
        return schritt;
      });
    map.schritte.push(...neu);
    return neu;
  }

  function quellenKuerzel(map, quelleId) {
    const i = map.quellen.findIndex((q) => q.id === quelleId);
    return i < 0 ? '' : 'Q' + (i + 1);
  }

  function artInfo(artId) {
    return QUELLEN_ARTEN.find((a) => a.id === artId) || null;
  }

  /* ---------- Versionen und Status ---------- */

  function parseVersion(nummer) {
    const m = /^(\d+)\.(\d+)$/.exec(String(nummer || ''));
    return m ? [Number(m[1]), Number(m[2])] : [0, 1];
  }

  function naechsteNebenversion(nummer) {
    const [haupt, neben] = parseVersion(nummer);
    return haupt + '.' + (neben + 1);
  }

  function naechsteHauptversion(nummer) {
    const [haupt] = parseVersion(nummer);
    return haupt + 1 + '.0';
  }

  function bearbeitbar(map) {
    return STATUS[map.version.status].bearbeitbar;
  }

  function verfuegbareAktionen(map) {
    return Object.keys(AKTIONEN).filter((k) => AKTIONEN[k].von.includes(map.version.status));
  }

  /**
   * Gründe, warum eine Aktion gerade nicht möglich ist. Leere Liste = möglich.
   * `pruefung` ist das Ergebnis von JMPruefung.pruefen(map).
   */
  function hindernisse(map, aktionKey, pruefung, eingaben) {
    const aktion = AKTIONEN[aktionKey];
    if (!aktion) return ['Unbekannte Aktion.'];
    const gruende = [];
    if (!aktion.von.includes(map.version.status)) {
      gruende.push('Im Status „' + STATUS[map.version.status].label + '“ nicht möglich.');
    }
    if ((aktionKey === 'zurPruefung' || aktionKey === 'freigeben') && pruefung && !pruefung.vollstaendig) {
      const n = pruefung.zaehler.fehlt + pruefung.zaehler.rueckfrage;
      gruende.push(
        n === 1
          ? 'Ein Prüfpunkt ist noch offen (fehlende Angabe oder Rückfrage).'
          : n + ' Prüfpunkte sind noch offen (fehlende Angaben oder Rückfragen).'
      );
    }
    if (aktionKey === 'freigeben') {
      const offen = map.rueckmeldungen.filter((r) => r.status === 'offen').length;
      if (offen === 1) gruende.push('Eine Rückmeldung ist noch offen.');
      if (offen > 1) gruende.push(offen + ' Rückmeldungen sind noch offen.');
      if (!eingaben || !String(eingaben.durch || '').trim()) {
        gruende.push('Bitte angeben, wer freigibt (Rolle oder Gremium).');
      }
    }
    return gruende;
  }

  function aktionAusfuehren(map, aktionKey, eingaben) {
    const aktion = AKTIONEN[aktionKey];
    const datum = heute();
    const durch = String((eingaben && eingaben.durch) || '').trim();
    if (aktion.version === 'neben') map.version.nummer = naechsteNebenversion(map.version.nummer);
    if (aktion.version === 'haupt') map.version.nummer = naechsteHauptversion(map.version.nummer);
    map.version.status = aktion.nach;
    if (aktionKey === 'freigeben') {
      map.version.freigabe = { durch, datum, version: map.version.nummer };
    }
    if (aktionKey === 'neueFassung') {
      map.version.freigabe = null;
      map.version.stand = datum;
    }
    map.historie.push({
      datum,
      version: map.version.nummer,
      ereignis: aktion.ereignis,
      notiz: String((eingaben && eingaben.notiz) || '').trim(),
      durch: aktionKey === 'freigeben' ? durch : '',
    });
    return map;
  }

  function exportVermerken(map) {
    const datum = heute();
    map.version.letzterExport = { version: map.version.nummer, status: map.version.status, datum };
    map.historie.push({
      datum,
      version: map.version.nummer,
      ereignis: 'export',
      notiz: 'PDF-Export im Status „' + STATUS[map.version.status].label + '“',
      durch: '',
    });
  }

  /** Einträge der Historie seit Beginn der aktuellen Fassung. */
  function aktuelleFassung(map) {
    let start = 0;
    map.historie.forEach((e, i) => {
      if (e.ereignis === 'neue_fassung') start = i;
    });
    return map.historie.slice(start);
  }

  /** Checkliste „Erledigt“ laut Rahmendaten: geprüft, freigegeben, Export mit Versionsstand. */
  function erledigtStand(map, pruefung) {
    const fassung = aktuelleFassung(map);
    const status = map.version.status;
    const exp = map.version.letzterExport;
    const punkte = [
      { text: 'Alle Pflichtangaben vollständig, keine offenen Rückfragen', ok: !!(pruefung && pruefung.vollstaendig) },
      {
        text: 'Fachlich geprüft',
        ok: fassung.some((e) => e.ereignis === 'zur_pruefung') && (status === 'in_ueberarbeitung' || status === 'freigegeben'),
      },
      { text: 'Alle Rückmeldungen bearbeitet', ok: !map.rueckmeldungen.some((r) => r.status === 'offen') },
      { text: 'Freigegeben', ok: status === 'freigegeben' },
      {
        text: 'Export mit Versionsstand der freigegebenen Fassung erstellt',
        ok: !!exp && exp.status === 'freigegeben' && exp.version === map.version.nummer,
      },
    ];
    return { punkte, erledigt: punkte.every((p) => p.ok) };
  }

  /* ---------- Dateien ---------- */

  function slug(text) {
    const t = String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (t.length <= 50) return t;
    // auf 50 Zeichen kürzen, möglichst an einer Wortgrenze
    const gekuerzt = t.slice(0, 50);
    const grenze = gekuerzt.lastIndexOf('-');
    return grenze > 20 ? gekuerzt.slice(0, grenze) : gekuerzt;
  }

  function dateiname(map, endung) {
    return (
      'journey-map_' +
      (slug(map.rahmen.titel) || 'ohne-titel') +
      '_v' +
      map.version.nummer +
      '_' +
      map.version.stand +
      '.' +
      endung
    );
  }

  function zuJson(map) {
    return JSON.stringify(map, null, 2);
  }

  const ID_MUSTER = /^[A-Za-z0-9_-]{1,64}$/;
  const DATUM_MUSTER = /^\d{4}-\d{2}-\d{2}$/;

  function obj(v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  }
  function arr(v) {
    return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
  }
  function str(v) {
    return typeof v === 'string' ? v : v == null ? '' : String(v);
  }
  function datum(v, ersatz) {
    return typeof v === 'string' && DATUM_MUSTER.test(v) ? v : ersatz;
  }

  /** Bringt eingelesene Daten in die erwartete Form. Unbekannte Felder werden verworfen. */
  function normalisieren(roh) {
    const vergeben = new Set();
    const id = (v, praefix) => {
      let wert = typeof v === 'string' && ID_MUSTER.test(v) ? v : neueId(praefix);
      if (vergeben.has(wert)) wert = neueId(praefix);
      vergeben.add(wert);
      return wert;
    };
    const r = obj(roh.rahmen);
    const v = obj(roh.version);
    const status = Object.prototype.hasOwnProperty.call(STATUS, v.status) ? v.status : 'entwurf';
    const nummer = /^\d+\.\d+$/.test(str(v.nummer)) ? str(v.nummer) : '0.1';
    const freigabe = v.freigabe && typeof v.freigabe === 'object' ? obj(v.freigabe) : null;
    const exp = v.letzterExport && typeof v.letzterExport === 'object' ? obj(v.letzterExport) : null;

    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      rahmen: {
        titel: str(r.titel),
        anlass: str(r.anlass),
        nutzergruppe: str(r.nutzergruppe),
        startpunkt: str(r.startpunkt),
        endpunkt: str(r.endpunkt),
        erfasstVon: str(r.erfasstVon),
        fachbereich: str(r.fachbereich),
      },
      version: {
        nummer,
        status,
        stand: datum(v.stand, heute()),
        freigabe: freigabe
          ? { durch: str(freigabe.durch), datum: datum(freigabe.datum, ''), version: str(freigabe.version) }
          : null,
        letzterExport: exp
          ? {
              version: str(exp.version),
              status: Object.prototype.hasOwnProperty.call(STATUS, exp.status) ? exp.status : 'entwurf',
              datum: datum(exp.datum, ''),
            }
          : null,
      },
      phasen: arr(roh.phasen).map((p) => ({ id: id(p.id, 'ph'), name: str(p.name) })),
      schritte: arr(roh.schritte).map((s) => ({
        id: id(s.id, 's'),
        phaseId: str(s.phaseId),
        aktion: str(s.aktion),
        touchpoint: str(s.touchpoint),
        emotion: Number.isInteger(s.emotion) && s.emotion >= -2 && s.emotion <= 2 ? s.emotion : null,
        gedanken: str(s.gedanken),
        zitat: str(s.zitat),
        painPoints: arr(s.painPoints).map((pp) => ({
          id: id(pp.id, 'pp'),
          text: str(pp.text),
          quelleId: str(pp.quelleId),
        })),
        quelleId: str(s.quelleId),
        intern: str(s.intern),
      })),
      quellen: arr(roh.quellen).map((q) => ({
        id: id(q.id, 'q'),
        bezeichnung: str(q.bezeichnung),
        art: artInfo(q.art) ? q.art : '',
        stand: str(q.stand),
        anonymisiert: q.anonymisiert === true,
      })),
      rueckmeldungen: arr(roh.rueckmeldungen).map((rm) => ({
        id: id(rm.id, 'rm'),
        bezug: str(rm.bezug) || 'allgemein',
        von: str(rm.von),
        kanal: str(rm.kanal),
        datum: datum(rm.datum, ''),
        text: str(rm.text),
        status: Object.prototype.hasOwnProperty.call(RUECKMELDUNG_STATUS, rm.status) ? rm.status : 'offen',
        antwort: str(rm.antwort),
      })),
      historie: arr(roh.historie).map((e) => ({
        datum: datum(e.datum, ''),
        version: str(e.version),
        ereignis: Object.prototype.hasOwnProperty.call(EREIGNISSE, e.ereignis) ? e.ereignis : 'angelegt',
        notiz: str(e.notiz),
        durch: str(e.durch),
      })),
    };
  }

  function ausJson(inhalt) {
    let roh;
    try {
      roh = JSON.parse(inhalt);
    } catch (e) {
      return { ok: false, fehler: 'Die Datei ist keine gültige JSON-Datei.' };
    }
    if (!roh || typeof roh !== 'object' || roh.schema !== SCHEMA) {
      return { ok: false, fehler: 'Die Datei ist keine Journey Map aus dieser Vorlage.' };
    }
    if (typeof roh.schemaVersion !== 'number' || roh.schemaVersion > SCHEMA_VERSION) {
      return { ok: false, fehler: 'Die Datei stammt aus einer neueren Version der Vorlage.' };
    }
    return { ok: true, map: normalisieren(roh) };
  }

  return {
    SCHEMA,
    SCHEMA_VERSION,
    STATUS,
    STATUS_REIHENFOLGE,
    EMOTIONEN,
    SICHTEN,
    QUELLEN_ARTEN,
    RUECKMELDUNG_STATUS,
    KANAELE,
    EREIGNISSE,
    AKTIONEN,
    heute,
    neueId,
    neuePhase,
    neuerSchritt,
    neuerPainPoint,
    neueQuelle,
    neueRueckmeldung,
    leereMap,
    geordneteSchritte,
    MAX_LISTENSCHRITTE,
    zeilenZuEintraegen,
    schritteAusListe,
    quellenKuerzel,
    artInfo,
    naechsteNebenversion,
    naechsteHauptversion,
    bearbeitbar,
    verfuegbareAktionen,
    hindernisse,
    aktionAusfuehren,
    exportVermerken,
    erledigtStand,
    slug,
    dateiname,
    zuJson,
    ausJson,
  };
});
