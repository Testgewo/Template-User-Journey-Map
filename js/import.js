/*
 * Schritte aus Dateien übernehmen: Excel (.xlsx), CSV, Word (.docx) und Text (.txt).
 *
 * Die Datei wird nur im Browser gelesen, nichts wird gespeichert oder verschickt.
 * Bewusst ohne Fremdbibliothek, damit die Vorlage ohne Pakete auskommt:
 * .xlsx und .docx sind ZIP-Archive mit XML. Das ZIP wird mit der eingebauten
 * DecompressionStream entpackt, die wenigen benötigten XML-Teile werden per Muster gelesen
 * (kein DOMParser, damit es auch in Node-Tests läuft).
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.JMImport = factory(root.JMModell);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Modell) {
  'use strict';

  /** Größte Datei, die gelesen wird. */
  const MAX_DATEI = 10 * 1024 * 1024;
  /** Größte entpackte Datei innerhalb eines Office-Dokuments (Schutz vor „ZIP-Bomben“). */
  const MAX_ENTPACKT = 30 * 1024 * 1024;

  /** Spalten der Tabellenvorlage, in dieser Reihenfolge. */
  const VORLAGE_SPALTEN = [
    'Phase',
    'Aktion',
    'Touchpoint',
    'Emotion',
    'Pain Points',
    'Quelle Pain Points',
    'Interner Ablauf',
    'Quelle Schritt',
    'Gedanken',
    'Zitat',
  ];

  /*
   * Erkannte Spaltenüberschriften (klein, ohne Umlaute und Satzzeichen).
   * Eine Überschrift passt, wenn sie genau so lautet oder mit dem Begriff und einem Leerzeichen beginnt,
   * z. B. „Aktion (Kundensicht)“.
   */
  const SPALTEN = {
    phase: { label: 'Phase', begriffe: ['phase', 'phasen', 'abschnitt'] },
    aktion: {
      label: 'Aktion',
      begriffe: ['aktion', 'aktionen', 'schritt', 'schritte', 'prozessschritt', 'prozessschritte', 'kundenaktion', 'aktivitaet', 'taetigkeit', 'handlung'],
    },
    touchpoint: { label: 'Touchpoint', begriffe: ['touchpoint', 'touchpoints', 'touch point', 'kanal', 'kontaktpunkt'] },
    emotion: { label: 'Emotion', begriffe: ['emotion', 'gefuehl', 'stimmung'] },
    painPoints: { label: 'Pain Points', begriffe: ['pain points', 'pain point', 'painpoints', 'painpoint', 'probleme', 'problem'] },
    quellePainPoints: {
      label: 'Quelle Pain Points',
      begriffe: ['quelle pain points', 'quelle pain point', 'quelle painpoints', 'beleg', 'beleg pain points'],
    },
    intern: {
      label: 'Interner Ablauf',
      begriffe: ['interner ablauf', 'interne ablaeufe', 'intern', 'backstage', 'hintergrund', 'interner prozess', 'systemschritt'],
    },
    quelleSchritt: { label: 'Quelle Schritt', begriffe: ['quelle schritt', 'quelle des schritts', 'quelle schritte'] },
    quelle: { label: 'Quelle', begriffe: ['quelle', 'quellen'] },
    gedanken: { label: 'Gedanken', begriffe: ['gedanken', 'gedanke'] },
    zitat: { label: 'Zitat', begriffe: ['zitat', 'zitate'] },
  };

  /* ---------- Hilfen ---------- */

  function fehler(text) {
    const f = new Error(text);
    f.nutzer = true;
    return f;
  }

  function norm(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function xmlText(text) {
    return String(text).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      const n = k[1] === 'x' ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch (err) {
        return '';
      }
    });
  }

  /** Text als UTF-8 lesen; Excel speichert CSV oft als Windows-1252, dann damit. */
  function textDekodieren(puffer) {
    const bytes = new Uint8Array(puffer);
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return new TextDecoder('windows-1252').decode(bytes);
    }
  }

  /* ---------- ZIP (Grundlage von .xlsx und .docx) ---------- */

  async function entpacken(roh) {
    if (typeof DecompressionStream === 'undefined') {
      throw fehler('Dieser Browser kann Office-Dateien nicht lesen. Bitte einen aktuellen Browser nutzen oder die Tabelle als CSV speichern.');
    }
    const leser = new Blob([roh]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const teile = [];
    let laenge = 0;
    for (;;) {
      const { done, value } = await leser.read();
      if (done) break;
      laenge += value.length;
      if (laenge > MAX_ENTPACKT) {
        await leser.cancel();
        throw fehler('Die Datei ist zu groß.');
      }
      teile.push(value);
    }
    const ergebnis = new Uint8Array(laenge);
    let pos = 0;
    for (const teil of teile) {
      ergebnis.set(teil, pos);
      pos += teil.length;
    }
    return ergebnis;
  }

  function zipOeffnen(puffer) {
    const daten = new Uint8Array(puffer);
    const dv = new DataView(daten.buffer, daten.byteOffset, daten.byteLength);
    const kaputt = () => fehler('Die Datei ist beschädigt oder kein Office-Dokument.');
    let ende = -1;
    for (let i = daten.length - 22; i >= Math.max(0, daten.length - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        ende = i;
        break;
      }
    }
    if (ende < 0) throw kaputt();
    const anzahl = dv.getUint16(ende + 10, true);
    let pos = dv.getUint32(ende + 16, true);
    const eintraege = new Map();
    for (let n = 0; n < anzahl; n++) {
      if (pos + 46 > daten.length || dv.getUint32(pos, true) !== 0x02014b50) throw kaputt();
      const nameLaenge = dv.getUint16(pos + 28, true);
      const name = new TextDecoder().decode(daten.subarray(pos + 46, pos + 46 + nameLaenge));
      eintraege.set(name, {
        flags: dv.getUint16(pos + 8, true),
        methode: dv.getUint16(pos + 10, true),
        gepackt: dv.getUint32(pos + 20, true),
        entpackt: dv.getUint32(pos + 24, true),
        lokal: dv.getUint32(pos + 42, true),
      });
      pos += 46 + nameLaenge + dv.getUint16(pos + 30, true) + dv.getUint16(pos + 32, true);
    }
    return {
      namen: () => Array.from(eintraege.keys()),
      async text(name) {
        const e = eintraege.get(name);
        if (!e) return null;
        if (e.flags & 1) throw fehler('Die Datei ist mit einem Passwort geschützt. Bitte ohne Passwort speichern.');
        if (e.entpackt > MAX_ENTPACKT) throw fehler('Die Datei ist zu groß.');
        if (e.lokal + 30 > daten.length || dv.getUint32(e.lokal, true) !== 0x04034b50) throw kaputt();
        const start = e.lokal + 30 + dv.getUint16(e.lokal + 26, true) + dv.getUint16(e.lokal + 28, true);
        const roh = daten.subarray(start, start + e.gepackt);
        let bytes;
        if (e.methode === 0) bytes = roh;
        else if (e.methode === 8) bytes = await entpacken(roh);
        else throw fehler('Die Datei verwendet ein nicht unterstütztes Packformat.');
        return new TextDecoder('utf-8').decode(bytes);
      },
    };
  }

  /* ---------- Excel (.xlsx) ---------- */

  /** Text aller <t>-Elemente eines XML-Ausschnitts (Excel-Textläufe). */
  function textAusLaeufen(xml) {
    let text = '';
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) text += xmlText(m[1]);
    return text;
  }

  function spaltenIndex(buchstaben) {
    let n = 0;
    for (const z of buchstaben) n = n * 26 + (z.charCodeAt(0) - 64);
    return n - 1;
  }

  function attribut(attrs, name) {
    const m = new RegExp('(?:^|\\s)' + name + '="([^"]*)"').exec(attrs);
    return m ? xmlText(m[1]) : null;
  }

  async function ersterBlattPfad(zip) {
    const ersatz = 'xl/worksheets/sheet1.xml';
    const mappe = await zip.text('xl/workbook.xml');
    const bezuege = await zip.text('xl/_rels/workbook.xml.rels');
    if (!mappe || !bezuege) return ersatz;
    const blatt = /<sheet\b([^>]*)\/?>/.exec(mappe);
    const rid = blatt ? attribut(blatt[1], 'r:id') : null;
    if (!rid) return ersatz;
    for (const b of bezuege.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      if (attribut(b[1], 'Id') === rid) {
        const ziel = attribut(b[1], 'Target') || '';
        return ziel.startsWith('/') ? ziel.slice(1) : 'xl/' + ziel;
      }
    }
    return ersatz;
  }

  async function xlsxZeilen(zip) {
    const geteilt = [];
    const ss = await zip.text('xl/sharedStrings.xml');
    if (ss) {
      for (const m of ss.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
        geteilt.push(textAusLaeufen(m[1]));
      }
    }
    const blatt = await zip.text(await ersterBlattPfad(zip));
    if (!blatt) throw fehler('In der Excel-Datei wurde kein Tabellenblatt gefunden.');
    const zeilen = [];
    for (const z of blatt.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const zeile = [];
      for (const c of z[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1];
        const inhalt = c[2] || '';
        const ref = /^([A-Z]+)/.exec(attribut(attrs, 'r') || '');
        const typ = attribut(attrs, 't') || 'n';
        const v = /<v>([\s\S]*?)<\/v>/.exec(inhalt);
        let wert = '';
        if (typ === 's') wert = v ? geteilt[parseInt(v[1], 10)] || '' : '';
        else if (typ === 'inlineStr') wert = textAusLaeufen(inhalt);
        else wert = v ? xmlText(v[1]) : '';
        zeile[ref ? spaltenIndex(ref[1]) : zeile.length] = wert;
      }
      zeilen.push(Array.from(zeile, (w) => w || ''));
    }
    return zeilen;
  }

  /* ---------- Word (.docx) ---------- */

  function absatzText(xml) {
    let text = '';
    for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g)) {
      text += m[1] !== undefined ? xmlText(m[1]) : ' ';
    }
    return text.replace(/\s+/g, ' ').trim();
  }

  function docxAbsaetze(xml) {
    const absaetze = [];
    for (const p of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
      const text = absatzText(p[1]);
      if (!text) continue;
      const stil = (/<w:pStyle w:val="([^"]*)"/.exec(p[1]) || [])[1] || '';
      absaetze.push({
        text,
        liste: /<w:numPr>/.test(p[1]) || /list|liste|aufz/i.test(stil),
        ueberschrift: /heading|berschrift|title|titel/i.test(stil),
      });
    }
    return absaetze;
  }

  function docxTabellen(xml) {
    const tabellen = [];
    for (const t of xml.matchAll(/<w:tbl\b[^>]*>([\s\S]*?)<\/w:tbl>/g)) {
      const zeilen = [];
      for (const z of t[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
        const zellen = [];
        for (const c of z[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
          zellen.push(
            docxAbsaetze(c[1])
              .map((a) => a.text)
              .join('\n')
          );
        }
        zeilen.push(zellen);
      }
      tabellen.push(zeilen);
    }
    return tabellen;
  }

  /* ---------- CSV ---------- */

  /** Liest CSV nach RFC 4180; Trennzeichen (; , Tab) wird aus der ersten Zeile erkannt. */
  function csvZeilen(text, trennzeichen) {
    let t = String(text).replace(/^﻿/, '');
    let trenner = trennzeichen || null;
    const sep = /^sep=(.)\r?\n/i.exec(t);
    if (sep) {
      trenner = sep[1];
      t = t.slice(sep[0].length);
    }
    if (!trenner) {
      const erste = t.split(/\r?\n/, 1)[0].replace(/"[^"]*"/g, '');
      const zaehlen = (z) => erste.split(z).length - 1;
      trenner = [';', '\t', ','].reduce((best, z) => (zaehlen(z) > zaehlen(best) ? z : best), ';');
    }
    const zeilen = [];
    let zeile = [];
    let feld = '';
    let inAnfuehrung = false;
    for (let i = 0; i < t.length; i++) {
      const z = t[i];
      if (inAnfuehrung) {
        if (z === '"') {
          if (t[i + 1] === '"') {
            feld += '"';
            i++;
          } else {
            inAnfuehrung = false;
          }
        } else {
          feld += z;
        }
      } else if (z === '"') {
        inAnfuehrung = true;
      } else if (z === trenner) {
        zeile.push(feld);
        feld = '';
      } else if (z === '\n' || z === '\r') {
        if (z === '\r' && t[i + 1] === '\n') i++;
        zeile.push(feld);
        zeilen.push(zeile);
        zeile = [];
        feld = '';
      } else {
        feld += z;
      }
    }
    if (feld !== '' || zeile.length) {
      zeile.push(feld);
      zeilen.push(zeile);
    }
    return zeilen;
  }

  /* ---------- Tabelle auswerten ---------- */

  function spalteErkennen(ueberschrift) {
    const k = norm(ueberschrift);
    if (!k) return null;
    // Nummern-Spalten („Schritt-Nr.“, „lfd. Nr.“) sind keine Inhalte
    if (/(^| )(nr|nummer|no|id|lfd)( |$)/.test(k)) return null;
    for (const [key, s] of Object.entries(SPALTEN)) if (s.begriffe.includes(k)) return key;
    // Beginnt mit einem Begriff („Aktion (Kundensicht)“); längster Begriff zuerst
    let treffer = null;
    let laenge = 0;
    for (const [key, s] of Object.entries(SPALTEN)) {
      for (const b of s.begriffe) {
        if (k.startsWith(b + ' ') && b.length > laenge) {
          treffer = key;
          laenge = b.length;
        }
      }
    }
    return treffer;
  }

  /** Sucht in den ersten Zeilen die Kopfzeile. Sie braucht mindestens eine Spalte „Aktion“ oder „Interner Ablauf“. */
  function kopfzeileFinden(zeilen) {
    for (let i = 0; i < Math.min(zeilen.length, 10); i++) {
      const zuordnung = {};
      const ignoriert = [];
      zeilen[i].forEach((zelle, spalte) => {
        const key = spalteErkennen(zelle);
        if (key && zuordnung[key] === undefined) zuordnung[key] = spalte;
        else if (String(zelle).trim()) ignoriert.push(String(zelle).trim());
      });
      if (zuordnung.aktion !== undefined || zuordnung.intern !== undefined) return { index: i, zuordnung, ignoriert };
    }
    return null;
  }

  function alsTabelle(zeilen, kopf, herkunft) {
    const wert = (zeile, key) => (kopf.zuordnung[key] === undefined ? '' : String(zeile[kopf.zuordnung[key]] || '').trim());
    const datensaetze = [];
    for (const zeile of zeilen.slice(kopf.index + 1)) {
      const d = {};
      for (const key of Object.keys(SPALTEN)) d[key] = wert(zeile, key);
      if (Object.values(d).some(Boolean)) datensaetze.push(d);
    }
    const spalten = Object.keys(SPALTEN)
      .filter((k) => kopf.zuordnung[k] !== undefined)
      .map((k) => SPALTEN[k].label);
    return { art: 'tabelle', herkunft, spalten, ignoriert: kopf.ignoriert, datensaetze };
  }

  function alsListe(eintraege, hinweis) {
    return { art: 'liste', zeilen: Modell.zeilenZuEintraegen(eintraege.join('\n')), hinweis: hinweis || '' };
  }

  /** Tabelle mit Kopfzeile, sonst die erste Spalte als Liste. */
  function tabelleOderListe(zeilen, herkunft) {
    const kopf = kopfzeileFinden(zeilen);
    if (kopf) return alsTabelle(zeilen, kopf, herkunft);
    const mehrspaltig = zeilen.some((z) => z.slice(1).some((w) => String(w).trim()));
    return alsListe(
      zeilen.map((z) => String(z[0] || '')),
      mehrspaltig ? 'Keine bekannten Spaltenüberschriften gefunden, übernommen wurde die erste Spalte' : ''
    );
  }

  /**
   * Liest eine Datei und liefert entweder eine Tabelle (eine Zeile je Schritt, mit Spalten)
   * oder eine Liste von Zeilen (für das Listen-Formular).
   */
  async function dateiAuswerten(dateiname, puffer) {
    if (puffer.byteLength > MAX_DATEI) throw fehler('Die Datei ist zu groß (über 10 MB).');
    const endung = String(dateiname).toLowerCase().split('.').pop();
    if (endung === 'xlsx' || endung === 'xlsm') {
      return tabelleOderListe(await xlsxZeilen(zipOeffnen(puffer)), 'Excel');
    }
    if (endung === 'docx') {
      const xml = await zipOeffnen(puffer).text('word/document.xml');
      if (!xml) throw fehler('Im Word-Dokument wurde kein Text gefunden.');
      for (const tabelle of docxTabellen(xml)) {
        const kopf = kopfzeileFinden(tabelle);
        if (kopf) return alsTabelle(tabelle, kopf, 'Word-Tabelle');
      }
      const absaetze = docxAbsaetze(xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, ''));
      const listenpunkte = absaetze.filter((a) => a.liste);
      if (listenpunkte.length >= 2) {
        return alsListe(
          listenpunkte.map((a) => a.text),
          'Übernommen wurden die Aufzählungspunkte'
        );
      }
      return alsListe(
        absaetze.filter((a) => !a.ueberschrift).map((a) => a.text),
        'Übernommen wurden alle Absätze'
      );
    }
    if (endung === 'csv') return tabelleOderListe(csvZeilen(textDekodieren(puffer)), 'CSV');
    if (endung === 'txt') {
      const text = textDekodieren(puffer);
      if (text.includes('\t')) {
        const zeilen = csvZeilen(text, '\t');
        const kopf = kopfzeileFinden(zeilen);
        if (kopf) return alsTabelle(zeilen, kopf, 'Text');
      }
      return alsListe(text.split(/\r?\n/));
    }
    if (endung === 'xls') throw fehler('Ältere Excel-Dateien (.xls) bitte als .xlsx oder CSV speichern.');
    if (endung === 'doc') throw fehler('Ältere Word-Dateien (.doc) bitte als .docx speichern.');
    if (endung === 'pdf') throw fehler('PDF lässt sich nicht direkt lesen. Bitte den Text kopieren und als Liste einfügen.');
    throw fehler('Dieses Dateiformat wird nicht unterstützt. Möglich sind .xlsx, .csv, .docx und .txt.');
  }

  /* ---------- Schritte anlegen ---------- */

  const EMOTION_WOERTER = {
    'sehr positiv': 2,
    'sehr gut': 2,
    positiv: 1,
    gut: 1,
    neutral: 0,
    negativ: -1,
    schlecht: -1,
    'sehr negativ': -2,
    'sehr schlecht': -2,
  };

  /** Emotion aus Zahl (-2 bis 2), Wort („negativ“) oder Symbol; sonst null. */
  function emotionAusText(text) {
    const roh = String(text || '').trim();
    if (!roh) return null;
    const zahl = /^([+\-−–]?)\s*([0-2])(?:[.,]0+)?$/.exec(roh);
    if (zahl) return parseInt(zahl[2], 10) * (zahl[1] && zahl[1] !== '+' ? -1 : 1) || 0;
    for (const e of Modell.EMOTIONEN) if (roh.includes(e.symbol)) return e.wert;
    const k = norm(roh);
    return Object.prototype.hasOwnProperty.call(EMOTION_WOERTER, k) ? EMOTION_WOERTER[k] : null;
  }

  /**
   * Legt Schritte aus Tabellenzeilen an.
   * Zeilen ohne Phase gehören zur Phase der Zeile davor; die erste in o.phaseId.
   * Unbekannte Phasen und Quellen werden neu angelegt (Quellen per Kürzel „Q2“ oder Bezeichnung).
   */
  function schritteAusTabelle(map, datensaetze, o) {
    const ergebnis = { schritte: [], neuePhasen: [], neueQuellen: [], emotionUnklar: 0, quelleUnklar: 0, ueberzaehlig: 0 };
    const phasen = new Map(map.phasen.filter((p) => p.name.trim()).map((p) => [norm(p.name), p]));
    const startphase =
      map.phasen.length === 1 && !map.phasen[0].name.trim() && !map.schritte.some((s) => s.phaseId === map.phasen[0].id)
        ? map.phasen[0]
        : null;
    let phaseId = map.phasen.some((p) => p.id === (o && o.phaseId)) ? o.phaseId : map.phasen.length ? map.phasen[0].id : '';

    const quelleFinden = (text) => {
      const t = String(text || '').trim();
      if (!t) return '';
      const kuerzel = /^q\s*(\d+)$/i.exec(t);
      if (kuerzel) {
        const q = map.quellen[parseInt(kuerzel[1], 10) - 1];
        if (!q) ergebnis.quelleUnklar += 1;
        return q ? q.id : '';
      }
      const vorhanden = map.quellen.find((q) => norm(q.bezeichnung) === norm(t));
      if (vorhanden) return vorhanden.id;
      const neu = Modell.neueQuelle();
      neu.bezeichnung = t;
      map.quellen.push(neu);
      ergebnis.neueQuellen.push(t);
      return neu.id;
    };

    for (const d of datensaetze.slice(0, Modell.MAX_LISTENSCHRITTE)) {
      if (d.phase) {
        let p = phasen.get(norm(d.phase));
        if (!p) {
          if (startphase && !ergebnis.schritte.length && !ergebnis.neuePhasen.length) {
            p = startphase;
            p.name = d.phase;
          } else {
            p = Modell.neuePhase(d.phase);
            map.phasen.push(p);
          }
          phasen.set(norm(d.phase), p);
          ergebnis.neuePhasen.push(d.phase);
        }
        phaseId = p.id;
      }
      if (!phaseId) {
        const p = Modell.neuePhase('');
        map.phasen.push(p);
        phaseId = p.id;
      }
      const schritt = Modell.neuerSchritt(phaseId);
      schritt.aktion = d.aktion || '';
      schritt.touchpoint = d.touchpoint || '';
      schritt.intern = d.intern || '';
      schritt.gedanken = d.gedanken || '';
      schritt.zitat = d.zitat || '';
      schritt.emotion = emotionAusText(d.emotion);
      if (d.emotion && schritt.emotion === null) ergebnis.emotionUnklar += 1;
      schritt.quelleId = quelleFinden(d.quelleSchritt || d.quelle);
      const ppQuelle = d.painPoints ? quelleFinden(d.quellePainPoints || d.quelle) : '';
      schritt.painPoints = Modell.zeilenZuEintraegen(String(d.painPoints || '').replace(/;/g, '\n')).map((text) => {
        const pp = Modell.neuerPainPoint();
        pp.text = text;
        pp.quelleId = ppQuelle;
        return pp;
      });
      map.schritte.push(schritt);
      ergebnis.schritte.push(schritt);
    }
    ergebnis.ueberzaehlig = Math.max(0, datensaetze.length - Modell.MAX_LISTENSCHRITTE);
    return ergebnis;
  }

  /** Leere Tabellenvorlage als CSV für Excel (UTF-8 mit BOM, Semikolon). */
  function vorlageCsv() {
    return '﻿' + VORLAGE_SPALTEN.join(';') + '\r\n';
  }

  return {
    MAX_DATEI,
    VORLAGE_SPALTEN,
    SPALTEN,
    csvZeilen,
    spalteErkennen,
    emotionAusText,
    dateiAuswerten,
    schritteAusTabelle,
    vorlageCsv,
  };
});
