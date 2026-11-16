/*
 * Oberfläche der Journey-Map-Vorlage.
 * Kein Framework, keine fremden Pakete: läuft per Doppelklick auf index.html im Browser.
 * Alle Texte werden über textContent eingefügt (kein innerHTML), damit Eingaben nie als HTML laufen.
 */
(function () {
  'use strict';

  const M = window.JMModell;
  const P = window.JMPruefung;
  const B = window.JMBeispiel;
  const I = window.JMImport;

  const TABS = [
    { id: 'rahmen', label: 'Rahmen' },
    { id: 'material', label: 'Material' },
    { id: 'schritte', label: 'Schritte' },
    { id: 'map', label: 'Map' },
    { id: 'pruefung', label: 'Prüfung & Freigabe' },
  ];
  const TYP_LABEL = { fehlt: 'Fehlt', rueckfrage: 'Rückfrage', hinweis: 'Hinweis' };
  const TYP_RANG = { fehlt: 0, rueckfrage: 1, hinweis: 2 };
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_DATEIGROESSE = 2 * 1024 * 1024;

  /*
   * Läuft die Seite als Artifact in claude.ai, gibt es window.claude. Dort sind Downloads nur über die
   * Download-Funktion des Viewers möglich, und der Druckdialog lässt sich nicht öffnen.
   * Lokal (Doppelklick auf index.html) gibt es window.claude nicht.
   */
  const IM_VIEWER = !!(window.claude && typeof window.claude.use === 'function');
  const downloadsBereit = IM_VIEWER ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

  const NAECHSTER_SCHRITT = {
    entwurf:
      'Vervollständige die Map. Sobald keine Prüfpunkte mehr offen sind, gibst du sie zur fachlichen Prüfung. ' +
      'Danach exportierst du sie unter „Map“ als PDF für den Fachbereich.',
    in_pruefung:
      'Der Fachbereich prüft. Exportiere die Map unter „Map“ als PDF oder gib die Datei weiter. ' +
      'Trage jede Rückmeldung unten ein, egal über welchen Kanal sie kommt. Danach Rückmeldungen einarbeiten oder direkt freigeben.',
    in_ueberarbeitung:
      'Arbeite die Rückmeldungen ein und setze bei jeder den Status. Danach erneut zur Prüfung geben oder freigeben lassen.',
    freigegeben:
      'Exportiere die freigegebene Fassung unter „Map“ als PDF. Damit ist die Map erledigt. ' +
      'Für spätere Änderungen beginnst du eine neue Fassung.',
  };

  const zustand = {
    map: M.leereMap(),
    geaendert: false,
    tab: 'rahmen',
    pruefung: null,
    alleZeigen: false,
    freigabeDurch: '',
    statusNotiz: '',
    liste: leereListe(),
    schnell: { text: '', phaseId: '' },
    offenerSchritt: null,
    auswahl: new Set(),
    rueckgaengig: null,
  };

  /** Eingaben im Formular „Schritte aus einer Liste übernehmen“ (gehören nicht zur Map). */
  function leereListe() {
    // offen: null = automatisch (offen, solange es noch keine Schritte gibt); vorschau: ausgewertete Tabelle
    return { text: '', als: 'aktion', phaseId: '', quelleId: '', offen: null, vorschau: null };
  }

  /* ================= DOM-Hilfen ================= */

  function setzeAttribute(el, attrs) {
    if (!attrs) return;
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }

  function anhaengen(el, kinder) {
    for (const k of kinder.flat(Infinity)) {
      if (k === null || k === undefined || k === false) continue;
      el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }

  function h(tag, attrs, ...kinder) {
    const el = document.createElement(tag);
    setzeAttribute(el, attrs);
    anhaengen(el, kinder);
    return el;
  }

  function s(tag, attrs, ...kinder) {
    const el = document.createElementNS(SVG_NS, tag);
    setzeAttribute(el, attrs);
    anhaengen(el, kinder);
    return el;
  }

  /** Hängt Inhalte an einen Bereich an; null und leere Werte werden übersprungen, Listen aufgelöst. */
  function fuellen(el, ...kinder) {
    anhaengen(el, kinder);
  }

  function datumDe(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : iso || '—';
  }

  function kuerzen(text, max) {
    const t = String(text || '').trim();
    if (t.length <= max) return t;
    const schnitt = t.slice(0, max - 1);
    const grenze = schnitt.lastIndexOf(' ');
    return (grenze > max * 0.6 ? schnitt.slice(0, grenze) : schnitt).replace(/[\s,;:–-]+$/, '') + ' …';
  }

  function mehrzahl(n, eins, viele) {
    return n === 1 ? '1 ' + eins : n + ' ' + viele;
  }

  function melden(text, fehler) {
    const el = document.getElementById('meldung');
    el.classList.toggle('fehler', !!fehler);
    el.textContent = '';
    window.clearTimeout(melden.anzeigen);
    window.clearTimeout(melden.ausblenden);
    melden.anzeigen = window.setTimeout(() => {
      el.textContent = text;
    }, 50);
    melden.ausblenden = window.setTimeout(() => {
      el.textContent = '';
    }, Math.max(fehler ? 10000 : 6000, text.length * 70));
  }

  function fokussieren(id, ausrichtung) {
    let el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'FIELDSET') el = el.querySelector('input:checked') || el.querySelector('input');
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: ausrichtung || 'center' });
  }

  function fokusNachVerschieben(praefix, richtung) {
    const bevorzugt = document.getElementById(praefix + (richtung < 0 ? '-hoch' : '-runter'));
    const alternativ = document.getElementById(praefix + (richtung < 0 ? '-runter' : '-hoch'));
    const ziel = bevorzugt && !bevorzugt.disabled ? bevorzugt : alternativ;
    if (ziel) {
      ziel.focus({ preventScroll: true });
      ziel.scrollIntoView({ block: 'center' });
    }
  }

  /* ================= Zustand ändern und prüfen ================= */

  function sichtbar(p) {
    // Fehlende Pflichtangaben erst zeigen, wenn geprüft wird (Reiter „Prüfung“ oder geladene Datei).
    // Hinweise beim Verlassen eines Feldes würden die Seite verschieben, während man klickt.
    return p.art === 'inhalt' || zustand.alleZeigen;
  }

  /**
   * Führt eine Änderung aus und aktualisiert Prüfung und Anzeige.
   * optionen.inhalt=false: Änderung betrifft nicht den Inhalt der Map (Stand bleibt).
   * optionen.neuZeichnen: aktiven Reiter neu aufbauen (bei Strukturänderungen).
   */
  function aendern(fn, optionen) {
    const o = optionen || {};
    if (zustand.rueckgaengig) {
      zustand.rueckgaengig = null;
      renderRueckgaengig();
    }
    fn();
    if (o.inhalt !== false) zustand.map.version.stand = M.heute();
    zustand.geaendert = true;
    if (o.neuZeichnen) {
      zustand.pruefung = P.pruefen(zustand.map);
      renderAktivenTab(o.fokus);
      renderKopf();
    } else {
      neuBewerten();
    }
  }

  function neuBewerten() {
    zustand.pruefung = P.pruefen(zustand.map);
    renderKopf();
    aktualisiereMarker();
    aktualisiereAbgeleitet();
  }

  function aktualisiereMarker() {
    const nachFeld = new Map();
    for (const p of zustand.pruefung.probleme) {
      if (!p.feldId || !sichtbar(p)) continue;
      if (!nachFeld.has(p.feldId)) nachFeld.set(p.feldId, []);
      nachFeld.get(p.feldId).push(p);
    }
    const panel = document.getElementById('panel-' + zustand.tab);
    panel.querySelectorAll('[data-problem-fuer]').forEach((el) => {
      const id = el.getAttribute('data-problem-fuer');
      const liste = nachFeld.get(id) || [];
      el.replaceChildren(...liste.map((p) => h('span', { class: 'marker marker-' + p.typ }, TYP_LABEL[p.typ] + ': ' + p.kurz)));
      const feldEl = document.getElementById(id);
      if (feldEl && /^(INPUT|SELECT|TEXTAREA)$/.test(feldEl.tagName)) {
        if (liste.some((p) => p.typ !== 'hinweis')) feldEl.setAttribute('aria-invalid', 'true');
        else feldEl.removeAttribute('aria-invalid');
      }
    });
  }

  /** Bereiche, die sich aus dem Zustand ableiten und bei jeder Änderung neu gezeichnet werden. */
  function aktualisiereAbgeleitet() {
    const bereiche = {
      sichten: sichtenInhalt,
      'rm-zaehler': () => [rueckmeldungsZaehlerText()],
      aktionen: aktionenInhalt,
      erledigt: erledigtInhalt,
      pruefliste: prueflisteInhalt,
      auswahl: auswahlInhalt,
    };
    for (const [key, fn] of Object.entries(bereiche)) {
      const el = document.querySelector('[data-abgeleitet="' + key + '"]');
      if (el) el.replaceChildren(...fn().filter(Boolean));
    }
    const kurz = document.querySelectorAll('[data-schritt-kurz]');
    if (kurz.length) {
      const reihenfolge = M.geordneteSchritte(zustand.map);
      kurz.forEach((el) => {
        const schritt = reihenfolge.find((x) => x.id === el.getAttribute('data-schritt-kurz'));
        if (schritt) el.replaceChildren(...schrittKurzfassung(schritt, reihenfolge.indexOf(schritt) + 1));
      });
    }
  }

  /* ================= Kopf und Reiter ================= */

  function setzeChip(id, text, klasse) {
    const li = document.getElementById(id);
    li.replaceChildren(text ? h('span', { class: klasse }, text) : '');
  }

  function renderKopf() {
    const m = zustand.map;
    const pr = zustand.pruefung;
    const titel = m.rahmen.titel.trim();
    document.getElementById('dok-titel').textContent = titel || 'Ohne Titel';
    document.title = (titel ? kuerzen(titel, 60) + ' – ' : '') + 'Journey-Map-Vorlage';
    setzeChip('dok-status', M.STATUS[m.version.status].label, 'chip status-' + m.version.status);
    setzeChip('dok-version', 'Version ' + m.version.nummer, 'chip');
    setzeChip('dok-stand', 'Stand ' + datumDe(m.version.stand), 'chip');
    setzeChip('dok-gespeichert', zustand.geaendert ? 'Nicht gespeichert' : '', 'chip ungespeichert');

    const btn = document.getElementById('btn-pruefstand');
    const offen = pr.zaehler.fehlt + pr.zaehler.rueckfrage;
    btn.className = 'pruefstand ' + (offen ? 'offen' : 'ok');
    btn.textContent = offen
      ? mehrzahl(offen, 'offener Prüfpunkt', 'offene Prüfpunkte')
      : '✓ Vollständig' + (pr.zaehler.hinweis ? ' · ' + mehrzahl(pr.zaehler.hinweis, 'Hinweis', 'Hinweise') : '');

    for (const t of TABS) {
      const z = document.getElementById('tab-zaehler-' + t.id);
      const n = pr.probleme.filter((p) => p.tab === t.id && p.typ !== 'hinweis' && sichtbar(p)).length;
      z.replaceChildren(...(n ? [h('span', { class: 'visuell-versteckt' }, ', offene Prüfpunkte: '), String(n)] : []));
      z.hidden = !n;
    }
  }

  function baueTabs() {
    const liste = document.getElementById('tabs');
    TABS.forEach((t, i) => {
      const btn = h(
        'button',
        {
          type: 'button',
          role: 'tab',
          id: 'tab-' + t.id,
          'aria-controls': 'panel-' + t.id,
          'aria-selected': String(t.id === zustand.tab),
          tabindex: t.id === zustand.tab ? '0' : '-1',
          onclick: () => zeigeTab(t.id),
        },
        h('span', { class: 'tab-nr', 'aria-hidden': 'true' }, String(i + 1)),
        t.label,
        h('span', { class: 'tab-zaehler', id: 'tab-zaehler-' + t.id, hidden: true })
      );
      btn.addEventListener('keydown', (e) => {
        let ziel = null;
        if (e.key === 'ArrowRight') ziel = (i + 1) % TABS.length;
        else if (e.key === 'ArrowLeft') ziel = (i - 1 + TABS.length) % TABS.length;
        else if (e.key === 'Home') ziel = 0;
        else if (e.key === 'End') ziel = TABS.length - 1;
        if (ziel === null) return;
        e.preventDefault();
        zeigeTab(TABS[ziel].id);
        document.getElementById('tab-' + TABS[ziel].id).focus();
      });
      liste.append(btn);
    });
  }

  function zeigeTab(id, fokusId) {
    const wechsel = zustand.tab !== id;
    zustand.tab = id;
    document.body.setAttribute('data-tab', id);
    if (id === 'pruefung') zustand.alleZeigen = true;
    for (const t of TABS) {
      const aktiv = t.id === id;
      const btn = document.getElementById('tab-' + t.id);
      btn.setAttribute('aria-selected', String(aktiv));
      btn.tabIndex = aktiv ? 0 : -1;
      document.getElementById('panel-' + t.id).hidden = !aktiv;
    }
    renderAktivenTab(fokusId);
    renderKopf();
    if (wechsel && !fokusId) window.scrollTo(0, 0);
  }

  const RENDER = {
    rahmen: renderRahmen,
    material: renderMaterial,
    schritte: renderSchritte,
    map: renderMap,
    pruefung: renderPruefung,
  };

  function renderAktivenTab(fokusId) {
    const panel = document.getElementById('panel-' + zustand.tab);
    const scrollY = window.scrollY;
    panel.replaceChildren();
    RENDER[zustand.tab](panel);
    aktualisiereMarker();
    aktualisiereAbgeleitet();
    if (fokusId) fokussieren(fokusId);
    else window.scrollTo(0, scrollY);
  }

  /* ================= Bausteine für Formulare ================= */

  function problemAnzeige(id) {
    return h('p', { class: 'feld-problem', id: id + '-problem', 'data-problem-fuer': id });
  }

  function feldLabel(o) {
    return h(
      'label',
      { for: o.id },
      o.label,
      o.pflicht ? h('span', { class: 'pflicht', 'aria-hidden': 'true' }, ' *') : null,
      o.optional ? h('span', { class: 'optional' }, ' (optional)') : null
    );
  }

  /**
   * Eingabefeld mit Beschriftung, Hilfetext und Platz für Prüfhinweise.
   * o: id, label, typ (text|textarea|select|date), wert, pflicht, optional, hilfe, gesperrt,
   *    optionen [{wert,label,attrs}], leerOption, leerText, zeilen, onInput(wert)
   */
  function feld(o) {
    const beschreibung = [o.hilfe ? o.id + '-hilfe' : null, o.id + '-problem'].filter(Boolean).join(' ');
    const gemeinsam = {
      id: o.id,
      'aria-describedby': beschreibung,
      'aria-required': o.pflicht ? 'true' : null,
      disabled: !!o.gesperrt,
      autocomplete: 'off',
    };
    let eingabe;
    if (o.typ === 'textarea') {
      eingabe = h('textarea', Object.assign({ rows: String(o.zeilen || 3) }, gemeinsam));
    } else if (o.typ === 'select') {
      eingabe = h(
        'select',
        gemeinsam,
        o.leerOption === false ? null : h('option', { value: '' }, o.leerText || '– bitte wählen –'),
        o.optionen.map((op) => h('option', Object.assign({ value: op.wert }, op.attrs || {}), op.label))
      );
    } else {
      eingabe = h('input', Object.assign({ type: o.typ || 'text' }, gemeinsam));
    }
    eingabe.value = o.wert === null || o.wert === undefined ? '' : String(o.wert);
    if (o.onInput) {
      eingabe.addEventListener(o.typ === 'select' ? 'change' : 'input', () => o.onInput(eingabe.value));
    }
    return h(
      'div',
      { class: 'feld' },
      feldLabel(o),
      o.hilfe ? h('p', { class: 'hilfe', id: o.id + '-hilfe' }, o.hilfe) : null,
      eingabe,
      problemAnzeige(o.id)
    );
  }

  function checkboxFeld(o) {
    const cb = h('input', {
      type: 'checkbox',
      id: o.id,
      checked: !!o.wert,
      disabled: !!o.gesperrt,
      'aria-describedby': o.id + '-problem',
    });
    cb.addEventListener('change', () => o.onChange(cb.checked));
    return h(
      'div',
      { class: 'feld' },
      h('div', { class: 'checkbox-feld' }, cb, h('label', { for: o.id }, o.label)),
      problemAnzeige(o.id)
    );
  }

  function panelKopf(titel, text) {
    return h('div', { class: 'panel-kopf' }, h('h2', {}, titel), text ? h('p', {}, text) : null);
  }

  function sperrHinweis() {
    const m = zustand.map;
    if (m.version.status === 'in_pruefung') {
      return h(
        'div',
        { class: 'box box-warnung' },
        h(
          'p',
          {},
          'Die Map ist in fachlicher Prüfung. Der Inhalt ist gesperrt, damit alle dieselbe Fassung prüfen. ' +
            'Rückmeldungen erfasst du unter „Prüfung & Freigabe“.'
        )
      );
    }
    if (m.version.status === 'freigegeben') {
      return h(
        'div',
        { class: 'box box-ok' },
        h(
          'p',
          {},
          'Version ' + m.version.nummer + ' ist freigegeben und gesperrt. ' +
            'Für Änderungen unter „Prüfung & Freigabe“ eine neue Fassung beginnen.'
        )
      );
    }
    return null;
  }

  function weiter(tabId, text) {
    return h('div', { class: 'weiter' }, h('button', { type: 'button', class: 'primaer', onclick: () => zeigeTab(tabId) }, text + ' →'));
  }

  function pflichtHinweis() {
    return h('p', { class: 'hilfe' }, 'Felder mit * sind Pflicht.');
  }

  /* ================= Reiter 1: Rahmen ================= */

  function ablaufBox() {
    const neu = !zustand.map.schritte.length && !zustand.map.rahmen.titel.trim();
    const schritte = [
      ['Anlass und Rahmen klären', 'Reiter „Rahmen“', ''],
      ['Material sammeln', 'Reiter „Material“: Quellenverzeichnis anlegen', 'Übergabe danach: Fachbereich → UX (Material und Prozesswissen)'],
      ['Material anonymisieren', 'Reiter „Material“: Anonymisierung je Quelle bestätigen', ''],
      ['Schritte erfassen', 'Reiter „Schritte“: einzeln, als Liste oder aus einer Datei (Excel, Word, CSV, Text)', ''],
      ['Map erzeugen', 'Reiter „Map“', 'Übergabe danach: UX → Fachbereich (Entwurf zur Prüfung)'],
      ['Fachlich prüfen lassen', 'Reiter „Prüfung & Freigabe“', 'Übergabe danach: Fachbereich → UX (Rückmeldungen)'],
      ['Überarbeiten und freigeben lassen', 'Reiter „Prüfung & Freigabe“, danach Export unter „Map“', ''],
    ];
    return h(
      'details',
      { class: 'karte', open: neu },
      h('summary', {}, 'So läuft die Erstellung ab (7 Schritte)'),
      h(
        'ol',
        { class: 'ablauf' },
        schritte.map(([titel, wo, uebergabe]) =>
          h(
            'li',
            {},
            h('strong', {}, titel),
            h('span', { class: 'uebergabe' }, wo),
            uebergabe ? h('span', { class: 'uebergabe' }, uebergabe) : null
          )
        )
      ),
      h(
        'p',
        { class: 'hilfe' },
        'Rollen: UX erfasst. Der Fachbereich mit Prozesswissen prüft und entscheidet über die Freigabe.'
      )
    );
  }

  function renderRahmen(panel) {
    const r = zustand.map.rahmen;
    const gesperrt = !M.bearbeitbar(zustand.map);
    const rahmenFeld = (key, o) =>
      feld(
        Object.assign(
          {
            id: 'f-rahmen-' + key,
            wert: r[key],
            gesperrt,
            onInput: (v) =>
              aendern(() => {
                r[key] = v;
              }),
          },
          o
        )
      );
    fuellen(panel, 
      panelKopf('1 · Anlass und Rahmen klären', 'Welche Journey, für welche Nutzergruppe, wo beginnt und wo endet sie?'),
      sperrHinweis(),
      ablaufBox(),
      h(
        'div',
        { class: 'karte' },
        pflichtHinweis(),
        rahmenFeld('titel', {
          label: 'Titel',
          pflicht: true,
          hilfe: 'Kurz und eindeutig, z. B. „Schaden telefonisch melden über den Voicebot“.',
        }),
        rahmenFeld('anlass', {
          label: 'Anlass und Rahmen',
          typ: 'textarea',
          pflicht: true,
          hilfe: 'Warum entsteht die Map? Was gehört dazu, was ausdrücklich nicht?',
        }),
        rahmenFeld('nutzergruppe', {
          label: 'Nutzergruppe',
          pflicht: true,
          hilfe: 'Für wen gilt die Journey? Eine Gruppe beschreiben, keine einzelnen Personen.',
        }),
        h(
          'div',
          { class: 'raster' },
          rahmenFeld('startpunkt', { label: 'Startpunkt', pflicht: true, hilfe: 'Womit beginnt die Journey?' }),
          rahmenFeld('endpunkt', { label: 'Endpunkt', pflicht: true, hilfe: 'Woran erkennt man, dass sie endet?' })
        ),
        h(
          'div',
          { class: 'raster' },
          rahmenFeld('erfasstVon', {
            label: 'Erfasst von',
            optional: true,
            hilfe: 'Rolle oder Team, z. B. „UX-Team“. Namen sind nicht nötig.',
          }),
          rahmenFeld('fachbereich', {
            label: 'Prüfender Fachbereich',
            optional: true,
            hilfe: 'Wer prüft fachlich und gibt frei?',
          })
        )
      ),
      weiter('material', 'Weiter: Material sammeln')
    );
  }

  /* ================= Reiter 2: Material ================= */

  function anonymisierungsHilfe() {
    return h(
      'details',
      { class: 'karte' },
      h('summary', {}, 'Checkliste: Material anonymisieren'),
      h(
        'ul',
        {},
        h('li', {}, 'Direkte Merkmale entfernen: Namen, Anschriften, Wohnungslage, Vertrags- und Kundennummern, Telefonnummern, E-Mail-Adressen, Bankdaten, Geburtsdaten.'),
        h('li', {}, 'Indirekte Merkmale vergröbern: genaues Datum → Monat, Hausnummer → Quartier, genaue Beträge → Spannen.'),
        h('li', {}, 'Seltene Kombinationen prüfen: Lässt sich aus den übrigen Angaben auf eine Person schließen?'),
        h('li', {}, 'Freitexte und Zitate besonders prüfen: Hinweise auf Nachbarn, Krankheiten oder Familienereignisse entfernen.'),
        h('li', {}, 'Rohdaten und Transkripte bleiben in eurer freigegebenen Ablage, nicht in der Map.')
      ),
      h('p', { class: 'hilfe' }, 'Die Map prüft Freitexte zusätzlich auf typische Muster (z. B. E-Mail, Telefonnummer, IBAN). Das ersetzt nicht deine eigene Prüfung.')
    );
  }

  function sichtenInhalt() {
    const m = zustand.map;
    return Object.entries(M.SICHTEN).map(([sicht, label]) => {
      const n = m.quellen.filter((q) => (M.artInfo(q.art) || {}).sicht === sicht).length;
      return h(
        'li',
        { class: n ? 'ok' : 'luecke' },
        h('strong', {}, label),
        h('br'),
        n ? (n === 1 ? '✓ 1 Quelle' : '✓ ' + n + ' Quellen') : 'Noch keine Quelle'
      );
    });
  }

  function quelleKarte(q, i, gesperrt) {
    const f = (feldname) => 'f-quelle-' + q.id + '-' + feldname;
    const kuerzel = 'Q' + (i + 1);
    const genutzt = quellenNutzung(q.id);
    return h(
      'li',
      { class: 'karte', id: 'karte-' + q.id },
      h(
        'div',
        { class: 'karte-kopf' },
        h('h4', {}, 'Quelle ' + kuerzel),
        gesperrt
          ? null
          : h(
              'div',
              { class: 'werkzeuge' },
              h(
                'button',
                { type: 'button', class: 'gefahr', 'aria-label': 'Quelle ' + kuerzel + ' löschen', onclick: () => quelleLoeschen(q, kuerzel, genutzt) },
                'Löschen'
              )
            )
      ),
      h(
        'div',
        { class: 'raster' },
        feld({
          id: f('bezeichnung'),
          label: 'Bezeichnung',
          pflicht: true,
          wert: q.bezeichnung,
          gesperrt,
          hilfe: 'Was ist das für Material? Ohne Inhalte, Namen oder Zitate.',
          onInput: (v) =>
            aendern(() => {
              q.bezeichnung = v;
            }),
        }),
        feld({
          id: f('art'),
          label: 'Art der Quelle',
          hilfe: 'Zeigt, welche Sicht die Quelle abdeckt. Daraus entsteht der Lückencheck oben.',
          typ: 'select',
          pflicht: true,
          wert: q.art,
          gesperrt,
          optionen: M.QUELLEN_ARTEN.map((a) => ({
            wert: a.id,
            label: a.label + (a.sicht ? ' – ' + M.SICHTEN[a.sicht] : ''),
          })),
          onInput: (v) =>
            aendern(() => {
              q.art = v;
            }),
        }),
        feld({
          id: f('stand'),
          label: 'Stand',
          optional: true,
          wert: q.stand,
          gesperrt,
          hilfe: 'Aus welcher Zeit stammt das Material? z. B. „10/2026“.',
          onInput: (v) =>
            aendern(() => {
              q.stand = v;
            }),
        })
      ),
      checkboxFeld({
        id: f('anonymisiert'),
        label:
          'Anonymisierung geprüft: Das Material enthält keine Namen, Kontaktdaten, Vertragsnummern oder andere Merkmale, die auf einzelne Personen schließen lassen.',
        wert: q.anonymisiert,
        gesperrt,
        onChange: (v) =>
          aendern(() => {
            q.anonymisiert = v;
          }),
      }),
      h('p', { class: 'hilfe' }, genutzt.text ? 'Belegt ' + genutzt.text + '.' : 'Belegt noch keinen Schritt und keinen Pain Point.')
    );
  }

  /** Wie oft eine Quelle als Beleg genutzt wird, mit lesbarer Beschreibung. */
  function quellenNutzung(quelleId) {
    let schritte = 0;
    let painPoints = 0;
    for (const schritt of zustand.map.schritte) {
      if (schritt.quelleId === quelleId) schritte += 1;
      painPoints += schritt.painPoints.filter((pp) => pp.quelleId === quelleId).length;
    }
    const teile = [];
    if (schritte) teile.push(mehrzahl(schritte, 'Schritt', 'Schritte'));
    if (painPoints) teile.push(mehrzahl(painPoints, 'Pain Point', 'Pain Points'));
    return { anzahl: schritte + painPoints, text: teile.join(' und ') };
  }

  /** Auswahlliste der Quellen für Schritte, Pain Points und das Listen-Formular. */
  function quellenOptionen() {
    return zustand.map.quellen.map((q, i) => ({
      wert: q.id,
      label: 'Q' + (i + 1) + ': ' + kuerzen(q.bezeichnung || '(ohne Bezeichnung)', 60),
    }));
  }

  function renderMaterial(panel) {
    const m = zustand.map;
    const gesperrt = !M.bearbeitbar(m);
    fuellen(panel, 
      panelKopf(
        '2 · Material sammeln und anonymisieren',
        'Hier führst du das Quellenverzeichnis: Welche Unterlagen und Gespräche liegen der Map zugrunde? Das Material selbst bleibt in eurer Ablage. ' +
          'Den Inhalt, z. B. die Prozessschritte, überträgst du im Reiter „Schritte“, einzeln oder als Liste. Schritte und Pain Points verweisen dann mit [Q1], [Q2] … auf diese Quellen.'
      ),
      sperrHinweis(),
      h(
        'div',
        { class: 'box box-warnung' },
        h(
          'p',
          {},
          h('strong', {}, 'Keine Rohdaten, Transkripte oder Namen eintragen. '),
          'Nur eine Kurzbezeichnung der Quelle, z. B. „Workshop mit dem Kundenservice (Protokoll)“.'
        )
      ),
      anonymisierungsHilfe(),
      h('h3', {}, 'Lückencheck'),
      h('p', { class: 'hilfe' }, 'Gute Journey Maps stützen sich auf mehrere Sichten. Fehlt eine, fehlt vielleicht Material.'),
      h('ul', { class: 'sichten', 'data-abgeleitet': 'sichten' }),
      h('h3', {}, 'Quellen'),
      m.quellen.length
        ? h('ol', { class: 'liste-ohne' }, m.quellen.map((q, i) => quelleKarte(q, i, gesperrt)))
        : h('p', {}, 'Noch keine Quellen erfasst.'),
      gesperrt ? null : h('button', { type: 'button', id: 'f-quelle-neu', onclick: quelleHinzufuegen }, '+ Quelle hinzufügen'),
      problemAnzeige('f-quelle-neu'),
      h(
        'div',
        { class: 'weiter' },
        gesperrt
          ? null
          : h(
              'button',
              {
                type: 'button',
                onclick: () => {
                  zustand.liste.offen = true;
                  zeigeTab('schritte', 'f-liste-text');
                },
              },
              'Schritte aus Datei oder Liste übernehmen →'
            ),
        h('button', { type: 'button', class: 'primaer', onclick: () => zeigeTab('schritte') }, 'Weiter: Schritte erfassen →')
      )
    );
  }

  function quelleHinzufuegen() {
    const q = M.neueQuelle();
    aendern(() => zustand.map.quellen.push(q), { neuZeichnen: true, fokus: 'f-quelle-' + q.id + '-bezeichnung' });
  }

  async function quelleLoeschen(q, kuerzel, genutzt) {
    const frage = genutzt.anzahl
      ? 'Quelle ' + kuerzel + ' löschen? Sie belegt ' + genutzt.text + '. Diese verlieren dann ihren Beleg.'
      : 'Quelle ' + kuerzel + ' löschen?';
    if (!(await bestaetigen(frage, 'Quelle löschen', true))) return;
    mitRueckgaengig(
      'Quelle ' + kuerzel + ' gelöscht.',
      () => {
        zustand.map.quellen = zustand.map.quellen.filter((x) => x !== q);
        for (const schritt of zustand.map.schritte) {
          if (schritt.quelleId === q.id) schritt.quelleId = '';
          for (const pp of schritt.painPoints) if (pp.quelleId === q.id) pp.quelleId = '';
        }
      },
      { fokus: 'f-quelle-neu' }
    );
  }

  /* ================= Reiter 3: Schritte ================= */

  function ausfuellhilfe() {
    const b = B.BEISPIEL_SCHRITT;
    const emo = M.EMOTIONEN.find((e) => e.wert === b.emotion);
    const zeilen = [
      ['Phase', b.phase],
      ['Aktion *', b.aktion],
      ['Touchpoint *', b.touchpoint],
      ['Interner Ablauf', b.intern],
      ['Quelle des Schritts', b.schrittQuelle],
      ['Emotion *', emo.symbol + ' ' + emo.label],
      ['Pain Point', b.painPoint],
      ['Quelle (Beleg) *', b.quelle],
      ['Gedanken', b.gedanken],
      ['Zitat', b.zitat],
    ];
    return h(
      'details',
      { class: 'karte' },
      h('summary', {}, 'Ausfüllhilfe: So sieht ein ausgefüllter Schritt aus'),
      h(
        'table',
        { class: 'beispiel-tabelle' },
        h('caption', { class: 'visuell-versteckt' }, 'Beispiel für einen ausgefüllten Schritt (fiktiv)'),
        h('tbody', {}, zeilen.map(([k, v]) => h('tr', {}, h('th', { scope: 'row' }, k), h('td', {}, v))))
      ),
      h(
        'ul',
        { class: 'hilfe' },
        h('li', {}, 'Ein Schritt ist eine Handlung. Die Aktion aus Sicht der Nutzer*in formulieren, mit Verb.'),
        h('li', {}, 'Touchpoint ist der Ort oder Kanal, an dem der Schritt passiert.'),
        h('li', {}, 'Interner Ablauf beschreibt, was dabei bei uns oder im System passiert. Er erscheint in der Map unter der Kundensicht.'),
        h('li', {}, 'Jeder Pain Point braucht eine Quelle aus dem Reiter „Material“.'),
        h('li', {}, 'Gedanken und Zitate sind optional. Zitate kurz halten und anonymisieren.')
      ),
      h('p', { class: 'hilfe' }, 'Fiktives Beispiel. Die ganze Beispiel-Map lädst du oben mit „Beispiel laden“.')
    );
  }

  function phasenName(p) {
    return p.name.trim() || '(ohne Namen)';
  }

  function aktualisierePhasenNamen(p) {
    const name = phasenName(p);
    const sel = CSS.escape(p.id);
    document.querySelectorAll('[data-phase-titel="' + sel + '"]').forEach((el) => {
      el.textContent = name;
    });
    document.querySelectorAll('option[data-phase-option="' + sel + '"]').forEach((el) => {
      el.textContent = el.getAttribute('data-praefix') + name;
    });
  }

  function emotionFeld(schritt, gesperrt) {
    const id = 'f-schritt-' + schritt.id + '-emotion';
    return h(
      'fieldset',
      { class: 'feld', id, 'aria-describedby': id + '-problem' },
      h('legend', {}, 'Emotion', h('span', { class: 'pflicht', 'aria-hidden': 'true' }, ' *')),
      h(
        'div',
        { class: 'emotion-optionen' },
        M.EMOTIONEN.map((e) => {
          const rid = id + '-' + (e.wert + 2);
          const radio = h('input', {
            type: 'radio',
            name: id,
            id: rid,
            value: String(e.wert),
            checked: schritt.emotion === e.wert,
            disabled: gesperrt,
          });
          radio.addEventListener('change', () => {
            aendern(() => {
              schritt.emotion = e.wert;
            });
          });
          return h('label', { class: 'emotion-option emo-' + e.wert, for: rid }, radio, h('span', { 'aria-hidden': 'true' }, e.symbol), e.label);
        })
      ),
      problemAnzeige(id)
    );
  }

  function painPointBereich(schritt, nr, gesperrt) {
    const m = zustand.map;
    const optionen = quellenOptionen();
    return h(
      'div',
      { class: 'feld' },
      h('h5', { class: 'feld-titel' }, 'Pain Points'),
      h('p', { class: 'hilfe' }, 'Was läuft schief, was kostet Zeit oder Nerven? Je Pain Point sind Beschreibung und Quelle Pflicht.'),
      schritt.painPoints.length
        ? h(
            'ul',
            { class: 'painpoints' },
            schritt.painPoints.map((pp, j) =>
              h(
                'li',
                { class: 'painpoint' },
                feld({
                  id: 'f-pp-' + pp.id + '-text',
                  label: 'Pain Point ' + (j + 1),
                  pflicht: true,
                  wert: pp.text,
                  gesperrt,
                  onInput: (v) =>
                    aendern(() => {
                      pp.text = v;
                    }),
                }),
                feld({
                  id: 'f-pp-' + pp.id + '-quelle',
                  label: 'Quelle (Beleg)',
                  typ: 'select',
                  pflicht: true,
                  wert: pp.quelleId,
                  gesperrt,
                  optionen,
                  leerText: m.quellen.length ? '– Quelle wählen –' : '– erst unter „Material“ Quellen anlegen –',
                  onInput: (v) =>
                    aendern(() => {
                      pp.quelleId = v;
                    }),
                }),
                gesperrt
                  ? null
                  : h(
                      'button',
                      {
                        type: 'button',
                        class: 'gefahr entfernen',
                        'aria-label': 'Pain Point ' + (j + 1) + ' von Schritt ' + nr + ' entfernen',
                        onclick: () => painPointEntfernen(schritt, pp),
                      },
                      'Entfernen'
                    )
              )
            )
          )
        : h('p', { class: 'hilfe' }, 'Keine Pain Points erfasst.'),
      gesperrt
        ? null
        : h(
            'button',
            { type: 'button', 'aria-describedby': 'h-schritt-' + schritt.id, onclick: () => painPointHinzufuegen(schritt) },
            '+ Pain Point hinzufügen'
          )
    );
  }

  /* ---------- Schritte als kompakte Liste ---------- */

  const FELD_KURZ = {
    aktion: 'Aktion',
    touchpoint: 'Touchpoint',
    emotion: 'Emotion',
    phase: 'Phase',
    quelle: 'Quelle',
    intern: 'interner Ablauf',
    gedanken: 'Gedanken',
    zitat: 'Zitat',
  };

  /** Was an einem Schritt noch fehlt oder geklärt werden muss, in Stichworten. */
  function offenePunkte(schritt) {
    const praefix = 'f-schritt-' + schritt.id + '-';
    const ppIds = new Set(schritt.painPoints.map((pp) => pp.id));
    const punkte = [];
    for (const p of zustand.pruefung.probleme) {
      if (p.typ === 'hinweis' || !p.feldId) continue;
      let wort = null;
      if (p.feldId.startsWith(praefix)) {
        wort = FELD_KURZ[p.feldId.slice(praefix.length)] || null;
      } else {
        const pp = /^f-pp-(.+)-(text|quelle)$/.exec(p.feldId);
        if (pp && ppIds.has(pp[1])) wort = pp[2] === 'text' ? 'Pain-Point-Text' : 'Beleg für Pain Point';
      }
      if (!wort) continue;
      if (p.kurz.startsWith('Möglicher Personenbezug')) wort = 'Personenbezug prüfen';
      else if (p.kurz.startsWith('Sehr langer Text') || p.kurz.startsWith('Zitat ist sehr lang')) wort = wort + ' kürzen';
      if (!punkte.includes(wort)) punkte.push(wort);
    }
    return punkte;
  }

  /** Eine Zeile Kurzfassung: Nummer, Aktion, Touchpoint, Emotion, Pain Points, was noch fehlt. */
  function schrittKurzfassung(schritt, nr) {
    const emo = M.EMOTIONEN.find((e) => e.wert === schritt.emotion);
    const offen = offenePunkte(schritt);
    return [
      h('span', { class: 'sz-nr' }, String(nr)),
      h('span', { class: 'sz-aktion' + (schritt.aktion.trim() ? '' : ' leer') }, schritt.aktion.trim() || 'Aktion noch offen'),
      h(
        'span',
        { class: 'sz-details' },
        schritt.touchpoint.trim()
          ? h('span', { class: 'sz-tp' }, symbol(touchpointArt(schritt.touchpoint)), kuerzen(schritt.touchpoint, 40))
          : null,
        emo
          ? h('span', { class: 'sz-emo' }, h('span', { 'aria-hidden': 'true' }, emo.symbol), h('span', { class: 'visuell-versteckt' }, 'Emotion: ' + emo.label))
          : null,
        schritt.painPoints.length ? h('span', { class: 'sz-pp' }, mehrzahl(schritt.painPoints.length, 'Pain Point', 'Pain Points')) : null,
        offen.length ? h('span', { class: 'sz-offen' }, 'fehlt: ' + offen.join(', ')) : h('span', { class: 'sz-ok' }, '✓ vollständig')
      ),
    ];
  }

  /** Felder eines Schritts (aufgeklappte Zeile). Wichtiges oben, Weiteres zum Aufklappen. */
  function schrittEditor(schritt, nr, gesperrt) {
    const m = zustand.map;
    const f = (feldname) => 'f-schritt-' + schritt.id + '-' + feldname;
    const textFeld = (key, o) =>
      feld(
        Object.assign(
          {
            id: f(key),
            wert: schritt[key],
            gesperrt,
            onInput: (v) =>
              aendern(() => {
                schritt[key] = v;
              }),
          },
          o
        )
      );
    const weitereOffen =
      ['gedanken', 'zitat', 'intern', 'quelleId'].some((k) => String(schritt[k] || '').trim()) ||
      !m.phasen.some((p) => p.id === schritt.phaseId);
    return h(
      'div',
      { class: 'schritt-editor', id: 'editor-' + schritt.id },
      h(
        'div',
        { class: 'raster' },
        textFeld('aktion', { label: 'Was tut die Person?', pflicht: true, hilfe: 'Aus ihrer Sicht formulieren, mit Verb.' }),
        textFeld('touchpoint', { label: 'Touchpoint', pflicht: true, hilfe: 'Kanal oder Kontaktpunkt, z. B. Voicebot, Website, Brief.' })
      ),
      emotionFeld(schritt, gesperrt),
      painPointBereich(schritt, nr, gesperrt),
      h(
        'details',
        { class: 'mehr-felder', open: weitereOffen },
        h('summary', {}, 'Weitere Angaben (optional): Gedanken, Zitat, interner Ablauf, Quelle, Phase'),
        h(
          'div',
          { class: 'raster' },
          textFeld('gedanken', { label: 'Gedanken', optional: true, typ: 'textarea', zeilen: 2, hilfe: 'Was geht der Person durch den Kopf?' }),
          textFeld('zitat', {
            label: 'Zitat',
            optional: true,
            typ: 'textarea',
            zeilen: 2,
            hilfe: 'Kurz und anonymisiert, höchstens ' + P.GRENZE_ZITAT + ' Zeichen.',
          })
        ),
        h(
          'div',
          { class: 'raster' },
          textFeld('intern', {
            label: 'Interner Ablauf',
            optional: true,
            typ: 'textarea',
            zeilen: 2,
            hilfe: 'Was passiert dabei bei uns oder im System? z. B. „Voicebot legt einen Vorgang an“.',
          }),
          h(
            'div',
            {},
            feld({
              id: f('quelle'),
              label: 'Quelle des Schritts',
              optional: true,
              typ: 'select',
              wert: schritt.quelleId,
              gesperrt,
              optionen: quellenOptionen(),
              leerText: m.quellen.length ? '– keine –' : '– erst unter „Material“ Quellen anlegen –',
              hilfe: 'Woher wissen wir, dass es diesen Schritt gibt?',
              onInput: (v) =>
                aendern(() => {
                  schritt.quelleId = v;
                }),
            }),
            feld({
              id: f('phase'),
              label: 'In Phase verschieben',
              typ: 'select',
              pflicht: true,
              wert: schritt.phaseId,
              gesperrt,
              optionen: m.phasen.map((p, i) => ({
                wert: p.id,
                label: 'Phase ' + (i + 1) + ': ' + phasenName(p),
                attrs: { 'data-phase-option': p.id, 'data-praefix': 'Phase ' + (i + 1) + ': ' },
              })),
              onInput: (v) =>
                aendern(
                  () => {
                    schritt.phaseId = v;
                  },
                  { neuZeichnen: true, fokus: f('phase') }
                ),
            })
          )
        )
      ),
      h(
        'div',
        { class: 'editor-fuss' },
        h('button', { type: 'button', onclick: () => schrittUmschalten(schritt) }, 'Fertig, zuklappen')
      )
    );
  }

  function schrittZeile(schritt, nr, pos, anzahl, gesperrt) {
    const offen = zustand.offenerSchritt === schritt.id;
    let auswahl = null;
    if (!gesperrt) {
      auswahl = h('input', {
        type: 'checkbox',
        id: 'f-auswahl-' + schritt.id,
        class: 'sz-auswahl',
        checked: zustand.auswahl.has(schritt.id),
        'aria-label': 'Schritt ' + nr + ' auswählen',
      });
      auswahl.addEventListener('change', () => {
        if (auswahl.checked) zustand.auswahl.add(schritt.id);
        else zustand.auswahl.delete(schritt.id);
        aktualisiereAbgeleitet();
      });
    }
    return h(
      'li',
      { class: 'schritt-zeile' + (offen ? ' offen' : ''), id: 'karte-' + schritt.id },
      h(
        'div',
        { class: 'sz-kopf' },
        auswahl,
        h(
          'button',
          {
            type: 'button',
            class: 'sz-umschalter',
            id: 'h-schritt-' + schritt.id,
            'aria-expanded': String(offen),
            'aria-controls': offen ? 'editor-' + schritt.id : null,
            onclick: () => schrittUmschalten(schritt),
          },
          h('span', { class: 'sz-kurz', 'data-schritt-kurz': schritt.id }, schrittKurzfassung(schritt, nr)),
          h('span', { class: 'sz-pfeil', 'aria-hidden': 'true' }, offen ? '▲' : '▼'),
          h('span', { class: 'visuell-versteckt' }, offen ? ' zuklappen' : ' bearbeiten')
        ),
        gesperrt
          ? null
          : h(
              'div',
              { class: 'werkzeuge' },
              h(
                'button',
                { type: 'button', class: 'symbol', id: 'btn-s-' + schritt.id + '-hoch', 'aria-label': 'Schritt ' + nr + ' nach oben', disabled: pos === 0, onclick: () => schrittVerschieben(schritt, -1) },
                '↑'
              ),
              h(
                'button',
                { type: 'button', class: 'symbol', id: 'btn-s-' + schritt.id + '-runter', 'aria-label': 'Schritt ' + nr + ' nach unten', disabled: pos === anzahl - 1, onclick: () => schrittVerschieben(schritt, 1) },
                '↓'
              ),
              h(
                'button',
                { type: 'button', class: 'symbol gefahr', 'aria-label': 'Schritt ' + nr + ' löschen', title: 'Löschen', onclick: () => schrittLoeschen(schritt, nr) },
                '✕'
              )
            )
      ),
      offen ? schrittEditor(schritt, nr, gesperrt) : null
    );
  }

  function phaseBlock(p, i, gesperrt, nummern) {
    const m = zustand.map;
    const schritte = m.schritte.filter((x) => x.phaseId === p.id);
    const labelId = 'h-phase-' + p.id;
    const nameId = 'f-phase-' + p.id + '-name';
    const name = h('input', {
      type: 'text',
      id: nameId,
      class: 'phase-name',
      placeholder: 'Name der Phase, z. B. „Kontakt aufnehmen“',
      autocomplete: 'off',
      disabled: gesperrt,
      'aria-labelledby': labelId,
      'aria-describedby': nameId + '-problem',
    });
    name.value = p.name;
    name.addEventListener('input', () =>
      aendern(() => {
        p.name = name.value;
        aktualisierePhasenNamen(p);
      })
    );
    const letzte = m.phasen.length - 1;
    return h(
      'section',
      { class: 'phase-block farbe-' + ((i % 6) + 1), 'aria-labelledby': labelId },
      h(
        'div',
        { class: 'phase-kopf' },
        h('span', { class: 'phase-nr', id: labelId }, 'Phase ' + (i + 1)),
        name,
        gesperrt
          ? null
          : h(
              'div',
              { class: 'werkzeuge' },
              h(
                'button',
                { type: 'button', class: 'symbol', id: 'btn-ph-' + p.id + '-hoch', 'aria-label': 'Phase ' + (i + 1) + ' nach oben', disabled: i === 0, onclick: () => phaseVerschieben(p, -1) },
                '↑'
              ),
              h(
                'button',
                { type: 'button', class: 'symbol', id: 'btn-ph-' + p.id + '-runter', 'aria-label': 'Phase ' + (i + 1) + ' nach unten', disabled: i === letzte, onclick: () => phaseVerschieben(p, 1) },
                '↓'
              ),
              h(
                'button',
                { type: 'button', class: 'symbol gefahr', 'aria-label': 'Phase ' + (i + 1) + ' löschen', title: 'Löschen', onclick: () => phaseLoeschen(p, i, schritte.length) },
                '✕'
              )
            )
      ),
      problemAnzeige(nameId),
      schritte.length
        ? h(
            'ol',
            { class: 'schritt-liste' },
            schritte.map((x, j) => schrittZeile(x, nummern.get(x.id), j, schritte.length, gesperrt))
          )
        : h('p', { class: 'hilfe' }, 'Noch keine Schritte in dieser Phase.'),
      gesperrt
        ? null
        : h(
            'button',
            { type: 'button', class: 'link', id: 'btn-schritt-neu-' + p.id, 'aria-describedby': labelId, onclick: () => schrittHinzufuegen(p.id) },
            '+ Schritt in dieser Phase'
          )
    );
  }

  /** Schnelle Eingabe: Phase wählen, Aktion tippen, Enter. */
  function schnellErfassung(gesperrt) {
    if (gesperrt) return null;
    const m = zustand.map;
    const schnell = zustand.schnell;
    if (!m.phasen.some((p) => p.id === schnell.phaseId)) schnell.phaseId = m.phasen.length ? m.phasen[0].id : '';
    const eingabe = h('input', {
      type: 'text',
      id: 'f-schritt-neu',
      autocomplete: 'off',
      placeholder: 'z. B. Ruft die Service-Hotline an',
      'aria-describedby': 'f-schritt-neu-hilfe f-schritt-neu-problem',
    });
    eingabe.value = schnell.text;
    eingabe.addEventListener('input', () => {
      schnell.text = eingabe.value;
    });
    eingabe.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        schnellHinzufuegen();
      }
    });
    return h(
      'section',
      { class: 'karte schnell', 'aria-labelledby': 'h-schnell' },
      h('h3', { id: 'h-schnell' }, 'Neuer Schritt'),
      h(
        'div',
        { class: 'schnell-zeile' },
        m.phasen.length
          ? feld({
              id: 'f-schnell-phase',
              label: 'Phase',
              typ: 'select',
              leerOption: false,
              wert: schnell.phaseId,
              optionen: m.phasen.map((p, i) => ({
                wert: p.id,
                label: 'Phase ' + (i + 1) + ': ' + phasenName(p),
                attrs: { 'data-phase-option': p.id, 'data-praefix': 'Phase ' + (i + 1) + ': ' },
              })),
              onInput: (v) => {
                schnell.phaseId = v;
              },
            })
          : null,
        h('div', { class: 'feld schnell-text' }, h('label', { for: 'f-schritt-neu' }, 'Was tut die Person?'), eingabe),
        h('button', { type: 'button', class: 'primaer', onclick: schnellHinzufuegen }, 'Hinzufügen')
      ),
      h(
        'p',
        { class: 'hilfe', id: 'f-schritt-neu-hilfe' },
        'Enter fügt den Schritt hinzu, danach tippst du gleich den nächsten. Touchpoint, Emotion und Pain Points ergänzt du per Klick auf den Schritt in der Liste.'
      ),
      problemAnzeige('f-schritt-neu')
    );
  }

  /** Leiste für die Auswahl mehrerer Schritte (z. B. zum Löschen). */
  function auswahlInhalt() {
    const m = zustand.map;
    if (!M.bearbeitbar(m) || !m.schritte.length) return [];
    for (const id of Array.from(zustand.auswahl)) if (!m.schritte.some((x) => x.id === id)) zustand.auswahl.delete(id);
    const n = zustand.auswahl.size;
    const gesamt = m.schritte.length;
    const alle = h('input', { type: 'checkbox', id: 'f-alle-auswaehlen', checked: n > 0 && n === gesamt });
    alle.indeterminate = n > 0 && n < gesamt;
    alle.addEventListener('change', () => {
      if (alle.checked) m.schritte.forEach((x) => zustand.auswahl.add(x.id));
      else zustand.auswahl.clear();
      document.querySelectorAll('input.sz-auswahl').forEach((cb) => {
        cb.checked = zustand.auswahl.has(cb.id.slice('f-auswahl-'.length));
      });
      aktualisiereAbgeleitet();
      const neu = document.getElementById('f-alle-auswaehlen');
      if (neu) neu.focus({ preventScroll: true });
    });
    return [
      h('div', { class: 'checkbox-feld' }, alle, h('label', { for: 'f-alle-auswaehlen' }, 'Alle ' + gesamt + ' Schritte auswählen')),
      n ? h('span', { class: 'auswahl-anzahl' }, n + ' ausgewählt') : null,
      n ? h('button', { type: 'button', class: 'gefahr', onclick: auswahlLoeschen }, mehrzahl(n, 'Schritt', 'Schritte') + ' löschen') : null,
    ];
  }

  function renderSchritte(panel) {
    const m = zustand.map;
    const gesperrt = !M.bearbeitbar(m);
    const nummern = new Map(M.geordneteSchritte(m).map((x, i) => [x.id, i + 1]));
    const phasenIds = new Set(m.phasen.map((p) => p.id));
    const ohnePhase = m.schritte.filter((x) => !phasenIds.has(x.phaseId));
    fuellen(
      panel,
      panelKopf(
        '3 · Schritte erfassen',
        'Trag Schritt für Schritt ein, was die Person tut. Touchpoint, Emotion und Pain Points ergänzt du per Klick auf den Schritt.'
      ),
      sperrHinweis(),
      schnellErfassung(gesperrt),
      listenFormular(gesperrt),
      ausfuellhilfe(),
      h('div', { class: 'auswahl-leiste', 'data-abgeleitet': 'auswahl' }),
      m.phasen.map((p, i) => phaseBlock(p, i, gesperrt, nummern)),
      ohnePhase.length
        ? h(
            'section',
            { class: 'phase-block farbe-6', 'aria-labelledby': 'h-ohne-phase' },
            h('div', { class: 'phase-kopf' }, h('span', { class: 'phase-nr', id: 'h-ohne-phase' }, 'Schritte ohne Phase')),
            h(
              'ol',
              { class: 'schritt-liste' },
              ohnePhase.map((x, j) => schrittZeile(x, nummern.get(x.id), j, ohnePhase.length, gesperrt))
            )
          )
        : null,
      gesperrt
        ? null
        : h(
            'div',
            { class: 'phase-neu' },
            h('button', { type: 'button', id: 'f-phase-neu', onclick: phaseHinzufuegen }, '+ Phase hinzufügen'),
            problemAnzeige('f-phase-neu')
          ),
      weiter('map', 'Weiter: Map ansehen')
    );
  }

  /** Vorschau, was aus dem Listen-Text entsteht, mit Warnung bei Fließtext. */
  function listenVorschauInhalt(text) {
    const eintraege = M.zeilenZuEintraegen(text);
    if (!eintraege.length) return [h('p', { class: 'hilfe' }, 'Noch keine Zeilen. Jede Zeile wird ein eigener Schritt.')];
    const n = Math.min(eintraege.length, M.MAX_LISTENSCHRITTE);
    const lang = eintraege.filter((e) => e.length > 120).length;
    const warnungen = [];
    if (lang) {
      warnungen.push(
        mehrzahl(lang, 'Zeile ist', 'Zeilen sind') +
          ' sehr lang. Das sieht nach Fließtext aus. Jede Zeile wird ein eigener Schritt. Für einzelne Schritte nutze besser oben „Neuer Schritt“.'
      );
    }
    if (eintraege.length > 20) warnungen.push('Das sind viele Schritte. Prüfe, ob wirklich jede Zeile ein Schritt ist.');
    if (eintraege.length > M.MAX_LISTENSCHRITTE) warnungen.push('Auf einmal werden höchstens ' + M.MAX_LISTENSCHRITTE + ' Schritte angelegt.');
    return [
      h('p', {}, h('strong', {}, n === 1 ? 'Daraus wird 1 Schritt:' : 'Daraus werden ' + n + ' Schritte:')),
      warnungen.length ? h('div', { class: 'box box-warnung' }, warnungen.map((w) => h('p', {}, w))) : null,
      h(
        'ol',
        { class: 'listen-vorschau' },
        eintraege.slice(0, 5).map((e) => h('li', {}, kuerzen(e, 100)))
      ),
      eintraege.length > 5 ? h('p', { class: 'hilfe' }, '… und ' + (eintraege.length - 5) + ' weitere') : null,
    ];
  }

  function listenKnopfText(text) {
    const n = Math.min(M.zeilenZuEintraegen(text).length, M.MAX_LISTENSCHRITTE);
    return n === 1 ? '1 Schritt anlegen' : n + ' Schritte anlegen';
  }

  /** „Mehrere Schritte auf einmal übernehmen“: aus einer Datei oder als Liste. Standardmäßig zugeklappt. */
  function listenFormular(gesperrt) {
    if (gesperrt) return null;
    const m = zustand.map;
    const liste = zustand.liste;
    if (!m.phasen.some((p) => p.id === liste.phaseId)) liste.phaseId = m.phasen.length ? m.phasen[0].id : '';
    if (liste.quelleId && !m.quellen.some((q) => q.id === liste.quelleId)) liste.quelleId = '';
    const vorschau = h('div', { class: 'listen-vorschau-bereich', id: 'f-liste-vorschau', 'aria-live': 'polite' }, listenVorschauInhalt(liste.text));
    const knopf = h('button', { type: 'button', class: 'primaer', id: 'btn-liste-anlegen', onclick: listeUebernehmen }, listenKnopfText(liste.text));
    knopf.disabled = !M.zeilenZuEintraegen(liste.text).length;
    const alsOptionen = [
      ['aktion', 'Aktion: was die Kund*in tut'],
      ['intern', 'Interner Ablauf: was bei uns oder im System passiert'],
    ];
    const details = h(
      'details',
      { class: 'karte', id: 'liste-formular', open: liste.offen === true },
      h('summary', {}, 'Mehrere Schritte auf einmal übernehmen (aus einer Datei oder Liste)'),
      dateiBereich(),
      h('h4', { class: 'abschnitt' }, 'Als Liste einfügen'),
      h(
        'p',
        { class: 'hilfe' },
        'Für eine Liste von Prozessschritten, nicht für Fließtext: Jede Zeile wird ein eigener Schritt. Aufzählungszeichen und Nummern werden entfernt.'
      ),
      feld({
        id: 'f-liste-text',
        label: 'Liste (ein Schritt pro Zeile)',
        typ: 'textarea',
        zeilen: 6,
        wert: liste.text,
        onInput: (v) => {
          liste.text = v;
          vorschau.replaceChildren(...listenVorschauInhalt(v).filter(Boolean));
          knopf.textContent = listenKnopfText(v);
          knopf.disabled = !M.zeilenZuEintraegen(v).length;
        },
      }),
      vorschau,
      h(
        'div',
        { class: 'raster' },
        h(
          'fieldset',
          { class: 'feld' },
          h('legend', {}, 'Zeilen übernehmen als'),
          alsOptionen.map(([wert, label]) => {
            const id = 'f-liste-als-' + wert;
            const radio = h('input', { type: 'radio', name: 'f-liste-als', id, value: wert, checked: liste.als === wert });
            radio.addEventListener('change', () => {
              liste.als = wert;
            });
            return h('div', { class: 'checkbox-feld' }, radio, h('label', { for: id }, label));
          })
        ),
        h(
          'div',
          {},
          feld({
            id: 'f-liste-phase',
            label: 'In Phase',
            typ: 'select',
            leerOption: false,
            wert: liste.phaseId,
            optionen: m.phasen.map((p, i) => ({ wert: p.id, label: 'Phase ' + (i + 1) + ': ' + phasenName(p) })),
            onInput: (v) => {
              liste.phaseId = v;
            },
          }),
          feld({
            id: 'f-liste-quelle',
            label: 'Quelle für alle Schritte',
            optional: true,
            typ: 'select',
            wert: liste.quelleId,
            optionen: quellenOptionen(),
            leerText: '– keine –',
            onInput: (v) => {
              liste.quelleId = v;
            },
          })
        )
      ),
      m.phasen.length ? knopf : h('p', { class: 'hilfe' }, 'Lege zuerst unten eine Phase an.')
    );
    details.addEventListener('toggle', () => {
      liste.offen = details.open;
    });
    return details;
  }

  function listeUebernehmen() {
    const m = zustand.map;
    const liste = zustand.liste;
    const eintraege = M.zeilenZuEintraegen(liste.text);
    if (!eintraege.length) {
      melden('Die Liste ist leer. Füge mindestens eine Zeile ein.', true);
      fokussieren('f-liste-text');
      return;
    }
    if (!m.phasen.some((p) => p.id === liste.phaseId)) {
      melden('Bitte zuerst eine Phase anlegen und auswählen.', true);
      return;
    }
    let neu = [];
    const als = liste.als;
    mitRueckgaengig(
      () =>
        mehrzahl(neu.length, 'Schritt', 'Schritte') +
        ' aus der Liste angelegt' +
        (eintraege.length > neu.length ? ' (die ersten ' + neu.length + ' von ' + eintraege.length + ' Zeilen)' : '') +
        '. Ergänze jetzt ' +
        (als === 'intern' ? 'die Aktion aus Sicht der Kund*innen, ' : '') +
        'Touchpoint und Emotion.',
      () => {
        neu = M.schritteAusListe(m, { text: liste.text, als, phaseId: liste.phaseId, quelleId: liste.quelleId });
        liste.text = '';
        liste.offen = false;
        zustand.alleZeigen = true;
      }
    );
    fokussieren('h-schritt-' + neu[0].id);
  }

  /* ---------- Schritte aus einer Datei ---------- */

  function dateiBereich() {
    const liste = zustand.liste;
    return h(
      'div',
      { class: 'datei-bereich' },
      h('h4', { class: 'abschnitt' }, 'Aus einer Datei'),
      h('p', { class: 'hilfe' }, 'Die Datei wird nur in deinem Browser gelesen. Sie wird nicht hochgeladen und nicht gespeichert.'),
      h(
        'ul',
        { class: 'hilfe' },
        h(
          'li',
          {},
          h('strong', {}, 'Excel oder CSV: '),
          'eine Zeile je Schritt, mit Spaltenüberschriften wie in der Vorlage (Phase, Aktion, Touchpoint, Emotion, Pain Points, Interner Ablauf, Quelle …). Andere Spalten werden nicht übernommen.'
        ),
        h('li', {}, h('strong', {}, 'Word: '), 'eine Tabelle mit einer Spalte „Aktion“ oder „Prozessschritt“, sonst die Aufzählungspunkte.'),
        h('li', {}, h('strong', {}, 'Text: '), 'ein Schritt pro Zeile.'),
        h('li', {}, h('strong', {}, 'PDF: '), 'Text kopieren und unten als Liste einfügen.')
      ),
      h(
        'div',
        { class: 'knopf-reihe' },
        h('button', { type: 'button', id: 'f-import-datei', onclick: () => document.getElementById('import-datei').click() }, 'Datei auswählen …'),
        h('button', { type: 'button', onclick: vorlageHerunterladen }, 'Tabellenvorlage herunterladen')
      ),
      liste.vorschau ? vorschauBereich(liste.vorschau) : null
    );
  }

  function emotionVorschau(text) {
    if (!text) return '—';
    const wert = I.emotionAusText(text);
    const e = M.EMOTIONEN.find((x) => x.wert === wert);
    return e ? e.symbol + ' ' + e.label : text + ' (nicht lesbar)';
  }

  function vorschauBereich(v) {
    const a = v.auswertung;
    const m = zustand.map;
    const anzahl = Math.min(a.datensaetze.length, M.MAX_LISTENSCHRITTE);
    const zeigen = a.datensaetze.slice(0, 8);
    const spalten = [
      ['phase', 'Phase'],
      ['aktion', 'Aktion'],
      ['touchpoint', 'Touchpoint'],
      ['emotion', 'Emotion'],
      ['painPoints', 'Pain Points'],
      ['intern', 'Interner Ablauf'],
    ].filter(([k]) => a.datensaetze.some((d) => d[k]));
    return h(
      'section',
      { class: 'vorschau', 'aria-labelledby': 'h-vorschau' },
      h('h4', { id: 'h-vorschau', tabindex: '-1' }, 'Vorschau: „' + v.dateiname + '“'),
      h(
        'p',
        {},
        mehrzahl(a.datensaetze.length, 'Schritt', 'Schritte') +
          ' erkannt (' +
          a.herkunft +
          ').' +
          (a.datensaetze.length > M.MAX_LISTENSCHRITTE ? ' Übernommen werden die ersten ' + M.MAX_LISTENSCHRITTE + '.' : '')
      ),
      h(
        'p',
        { class: 'hilfe' },
        'Übernommene Spalten: ' + a.spalten.join(', ') + '.' + (a.ignoriert.length ? ' Nicht übernommen: ' + a.ignoriert.join(', ') + '.' : '')
      ),
      h(
        'div',
        { class: 'tabelle-scroll', role: 'region', 'aria-label': 'Vorschau der Schritte', tabindex: '0' },
        h(
          'table',
          { class: 'vorschau-tabelle' },
          h('thead', {}, h('tr', {}, spalten.map(([, label]) => h('th', { scope: 'col' }, label)))),
          h(
            'tbody',
            {},
            zeigen.map((d, i) =>
              h(
                'tr',
                {},
                spalten.map(([k]) => {
                  if (k === 'emotion') return h('td', {}, emotionVorschau(d.emotion));
                  if (k === 'phase' && !d.phase && i > 0) return h('td', { class: 'leise' }, 'wie oben');
                  return h('td', {}, d[k] || '—');
                })
              )
            )
          )
        )
      ),
      a.datensaetze.length > zeigen.length ? h('p', { class: 'hilfe' }, '… und ' + (a.datensaetze.length - zeigen.length) + ' weitere.') : null,
      !a.datensaetze[0].phase && m.phasen.length
        ? feld({
            id: 'f-vorschau-phase',
            label: 'Zeilen ohne Phase am Anfang kommen in',
            typ: 'select',
            leerOption: false,
            wert: zustand.liste.phaseId || m.phasen[0].id,
            optionen: m.phasen.map((p, i) => ({ wert: p.id, label: 'Phase ' + (i + 1) + ': ' + phasenName(p) })),
            onInput: (wert) => {
              zustand.liste.phaseId = wert;
            },
          })
        : null,
      h(
        'div',
        { class: 'knopf-reihe' },
        h('button', { type: 'button', class: 'primaer', onclick: tabelleUebernehmen }, (anzahl === 1 ? '1 Schritt' : anzahl + ' Schritte') + ' übernehmen'),
        h('button', { type: 'button', onclick: vorschauVerwerfen }, 'Verwerfen')
      )
    );
  }

  async function importDateiGewaehlt(e) {
    const eingabe = e.target;
    const datei = eingabe.files && eingabe.files[0];
    eingabe.value = '';
    if (!datei) return;
    let auswertung;
    try {
      auswertung = await I.dateiAuswerten(datei.name, await datei.arrayBuffer());
    } catch (f) {
      melden(f && f.nutzer ? f.message : 'Die Datei konnte nicht gelesen werden. Ist sie beschädigt?', true);
      return;
    }
    const liste = zustand.liste;
    liste.offen = true;
    if (auswertung.art === 'tabelle') {
      if (!auswertung.datensaetze.length) {
        melden('In „' + datei.name + '“ gibt es Spaltenüberschriften, aber keine Zeilen mit Inhalt.', true);
        return;
      }
      liste.vorschau = { dateiname: datei.name, auswertung };
      renderAktivenTab('h-vorschau');
      return;
    }
    if (!auswertung.zeilen.length) {
      melden('In „' + datei.name + '“ wurde kein Text gefunden.', true);
      return;
    }
    liste.vorschau = null;
    liste.text = auswertung.zeilen.join('\n');
    renderAktivenTab('f-liste-text');
    melden(
      mehrzahl(auswertung.zeilen.length, 'Zeile', 'Zeilen') +
        ' aus „' +
        datei.name +
        '“ in die Liste übernommen' +
        (auswertung.hinweis ? ' (' + auswertung.hinweis + ')' : '') +
        '. Prüfe die Liste, lösche überflüssige Zeilen und lege dann die Schritte an.'
    );
  }

  function vorschauVerwerfen() {
    zustand.liste.vorschau = null;
    renderAktivenTab('f-import-datei');
  }

  function tabelleUebernehmen() {
    const v = zustand.liste.vorschau;
    if (!v) return;
    let erg = null;
    const stand = M.zuJson(zustand.map);
    aendern(
      () => {
        erg = I.schritteAusTabelle(zustand.map, v.auswertung.datensaetze, { phaseId: zustand.liste.phaseId });
        zustand.liste.vorschau = null;
        zustand.liste.offen = false;
        zustand.alleZeigen = true;
      },
      { neuZeichnen: true }
    );
    if (erg.schritte.length) fokussieren('h-schritt-' + erg.schritte[0].id);
    const teile = [mehrzahl(erg.schritte.length, 'Schritt', 'Schritte') + ' aus „' + v.dateiname + '“ übernommen.'];
    if (erg.ueberzaehlig) {
      teile.push(mehrzahl(erg.ueberzaehlig, 'weitere Zeile wurde', 'weitere Zeilen wurden') + ' nicht übernommen (höchstens ' + M.MAX_LISTENSCHRITTE + ' auf einmal).');
    }
    if (erg.neuePhasen.length) teile.push('Neue Phasen: ' + erg.neuePhasen.join(', ') + '.');
    if (erg.neueQuellen.length) {
      teile.push('Neue Quellen: ' + erg.neueQuellen.join(', ') + '. Bitte unter „Material“ Art und Anonymisierung ergänzen.');
    }
    if (erg.emotionUnklar) teile.push('Bei ' + mehrzahl(erg.emotionUnklar, 'Schritt', 'Schritten') + ' war die Emotion nicht lesbar.');
    if (erg.quelleUnklar) teile.push(mehrzahl(erg.quelleUnklar, 'Quellenkürzel wurde', 'Quellenkürzel wurden') + ' nicht gefunden.');
    teile.push('Was noch fehlt, steht in der Liste bei jedem Schritt.');
    zustand.rueckgaengig = { stand, text: teile.join(' ') };
    renderRueckgaengig();
  }

  async function vorlageHerunterladen() {
    if (await dateiAnbieten('journey-map-schritte-vorlage.csv', I.vorlageCsv(), 'text/csv;charset=utf-8')) {
      melden('Vorlage gespeichert. Öffne sie mit Excel, trage eine Zeile je Schritt ein und speichere sie als .xlsx oder .csv.');
    }
  }

  /* ---------- Phasen und Schritte bearbeiten ---------- */

  /**
   * Führt eine Strukturänderung aus und bietet danach „Rückgängig“ an.
   * text: Meldung (oder Funktion, die sie nach der Änderung liefert).
   */
  function mitRueckgaengig(text, fn, optionen) {
    const stand = M.zuJson(zustand.map);
    aendern(fn, Object.assign({}, optionen || {}, { neuZeichnen: true }));
    zustand.rueckgaengig = { stand, text: typeof text === 'function' ? text() : text };
    renderRueckgaengig();
  }

  function renderRueckgaengig() {
    const leiste = document.getElementById('rueckgaengig');
    if (!leiste) return;
    const r = zustand.rueckgaengig;
    document.body.classList.toggle('mit-rueckgaengig', !!r);
    leiste.replaceChildren(
      ...(r
        ? [
            h('p', {}, r.text),
            h('button', { type: 'button', id: 'btn-rueckgaengig', onclick: rueckgaengigMachen }, 'Rückgängig'),
            h(
              'button',
              {
                type: 'button',
                class: 'symbol',
                'aria-label': 'Hinweis schließen',
                onclick: () => {
                  zustand.rueckgaengig = null;
                  renderRueckgaengig();
                },
              },
              '✕'
            ),
          ]
        : [])
    );
  }

  function rueckgaengigMachen() {
    const r = zustand.rueckgaengig;
    if (!r) return;
    const ergebnis = M.ausJson(r.stand);
    if (!ergebnis.ok) return;
    zustand.map = ergebnis.map;
    zustand.rueckgaengig = null;
    zustand.geaendert = true;
    zustand.offenerSchritt = null;
    zustand.auswahl.clear();
    zustand.pruefung = P.pruefen(zustand.map);
    renderRueckgaengig();
    renderAktivenTab();
    renderKopf();
    melden('Rückgängig gemacht.');
  }

  function phaseHinzufuegen() {
    const p = M.neuePhase('');
    aendern(() => zustand.map.phasen.push(p), { neuZeichnen: true, fokus: 'f-phase-' + p.id + '-name' });
  }

  function phaseVerschieben(p, richtung) {
    const a = zustand.map.phasen;
    const i = a.indexOf(p);
    const j = i + richtung;
    if (j < 0 || j >= a.length) return;
    aendern(
      () => {
        a[i] = a[j];
        a[j] = p;
      },
      { neuZeichnen: true }
    );
    fokusNachVerschieben('btn-ph-' + p.id, richtung);
  }

  function phaseLoeschen(p, i, anzahl) {
    if (anzahl > 0) {
      melden(
        'Phase ' + (i + 1) + ' enthält noch ' + mehrzahl(anzahl, 'Schritt', 'Schritte') + '. Verschiebe oder lösche die Schritte zuerst.',
        true
      );
      return;
    }
    mitRueckgaengig('Phase ' + (i + 1) + ' gelöscht.', () => {
      zustand.map.phasen = zustand.map.phasen.filter((x) => x !== p);
    });
    fokussieren('f-phase-neu');
  }

  function schnellHinzufuegen() {
    const m = zustand.map;
    const schnell = zustand.schnell;
    const text = schnell.text.trim();
    if (!text) {
      melden('Trag zuerst ein, was die Person tut.', true);
      fokussieren('f-schritt-neu');
      return;
    }
    let neu = null;
    aendern(
      () => {
        if (!m.phasen.some((p) => p.id === schnell.phaseId)) {
          if (!m.phasen.length) m.phasen.push(M.neuePhase(''));
          schnell.phaseId = m.phasen[0].id;
        }
        neu = M.neuerSchritt(schnell.phaseId);
        neu.aktion = text;
        m.schritte.push(neu);
        schnell.text = '';
      },
      { neuZeichnen: true }
    );
    const eingabe = document.getElementById('f-schritt-neu');
    if (eingabe) eingabe.focus({ preventScroll: true });
    const nr = M.geordneteSchritte(m).indexOf(neu) + 1;
    melden('Schritt ' + nr + ' hinzugefügt: „' + kuerzen(text, 60) + '“');
  }

  function schrittHinzufuegen(phaseId) {
    const neu = M.neuerSchritt(phaseId);
    zustand.offenerSchritt = neu.id;
    aendern(() => zustand.map.schritte.push(neu), { neuZeichnen: true, fokus: 'f-schritt-' + neu.id + '-aktion' });
  }

  function schrittUmschalten(schritt) {
    zustand.offenerSchritt = zustand.offenerSchritt === schritt.id ? null : schritt.id;
    renderAktivenTab();
    fokussieren('h-schritt-' + schritt.id, 'nearest');
  }

  function schrittVerschieben(schritt, richtung) {
    const a = zustand.map.schritte;
    const gleichePhase = a.filter((x) => x.phaseId === schritt.phaseId);
    const nachbar = gleichePhase[gleichePhase.indexOf(schritt) + richtung];
    if (!nachbar) return;
    const i = a.indexOf(schritt);
    const j = a.indexOf(nachbar);
    aendern(
      () => {
        a[i] = nachbar;
        a[j] = schritt;
      },
      { neuZeichnen: true }
    );
    fokusNachVerschieben('btn-s-' + schritt.id, richtung);
  }

  function schrittLoeschen(schritt, nr) {
    mitRueckgaengig('Schritt ' + nr + ' gelöscht' + (schritt.aktion.trim() ? ': „' + kuerzen(schritt.aktion, 50) + '“' : '') + '.', () => {
      zustand.map.schritte = zustand.map.schritte.filter((x) => x !== schritt);
      zustand.auswahl.delete(schritt.id);
      if (zustand.offenerSchritt === schritt.id) zustand.offenerSchritt = null;
    });
    fokussieren(document.getElementById('btn-schritt-neu-' + schritt.phaseId) ? 'btn-schritt-neu-' + schritt.phaseId : 'f-schritt-neu', 'nearest');
  }

  async function auswahlLoeschen() {
    const ids = new Set(zustand.auswahl);
    const n = ids.size;
    if (!n) return;
    if (!(await bestaetigen(mehrzahl(n, 'Schritt', 'Schritte') + ' löschen? Du kannst das danach rückgängig machen.', mehrzahl(n, 'Schritt', 'Schritte') + ' löschen', true))) return;
    mitRueckgaengig(mehrzahl(n, 'Schritt', 'Schritte') + ' gelöscht.', () => {
      zustand.map.schritte = zustand.map.schritte.filter((x) => !ids.has(x.id));
      zustand.auswahl.clear();
      if (ids.has(zustand.offenerSchritt)) zustand.offenerSchritt = null;
    });
    fokussieren('f-schritt-neu', 'nearest');
  }

  function painPointHinzufuegen(schritt) {
    const pp = M.neuerPainPoint();
    aendern(() => schritt.painPoints.push(pp), { neuZeichnen: true, fokus: 'f-pp-' + pp.id + '-text' });
  }

  function painPointEntfernen(schritt, pp) {
    mitRueckgaengig('Pain Point entfernt.', () => {
      schritt.painPoints = schritt.painPoints.filter((x) => x !== pp);
    });
    fokussieren('h-schritt-' + schritt.id, 'nearest');
  }

  /** Zu welchem Schritt gehört ein Feld? (zum Aufklappen beim Sprung aus der Prüfliste) */
  function schrittZuFeld(feldId) {
    if (!feldId) return null;
    for (const schritt of zustand.map.schritte) {
      if (feldId.startsWith('f-schritt-' + schritt.id + '-')) return schritt.id;
      if (schritt.painPoints.some((pp) => feldId.startsWith('f-pp-' + pp.id + '-'))) return schritt.id;
    }
    return null;
  }

  /* ================= Reiter 4: Map ================= */

  /* ---------- Symbole für Touchpoints (einfache Linienzeichnungen, 24 × 24) ---------- */

  const SYMBOLE = {
    voicebot: [
      ['rect', { x: 4, y: 8, width: 16, height: 12, rx: 3 }],
      ['path', { d: 'M12 4v4' }],
      ['circle', { cx: 12, cy: 3, r: 1 }],
      ['circle', { cx: 9, cy: 14, r: 1.2 }],
      ['circle', { cx: 15, cy: 14, r: 1.2 }],
    ],
    telefon: [
      [
        'path',
        {
          d: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
        },
      ],
    ],
    web: [
      ['circle', { cx: 12, cy: 12, r: 9 }],
      ['ellipse', { cx: 12, cy: 12, rx: 4, ry: 9 }],
      ['path', { d: 'M3 12h18' }],
    ],
    app: [
      ['rect', { x: 7, y: 2, width: 10, height: 20, rx: 2 }],
      ['path', { d: 'M11 18h2' }],
    ],
    nachricht: [['path', { d: 'M4 5h16v11H9l-5 4z' }]],
    post: [
      ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 2 }],
      ['path', { d: 'M3 7l9 6 9-6' }],
    ],
    person: [
      ['circle', { cx: 12, cy: 8, r: 4 }],
      ['path', { d: 'M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6' }],
    ],
    aushang: [
      ['rect', { x: 5, y: 3, width: 14, height: 18, rx: 1 }],
      ['path', { d: 'M8 8h8M8 12h8M8 16h5' }],
    ],
    ort: [
      ['path', { d: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z' }],
      ['circle', { cx: 12, cy: 10, r: 2.5 }],
    ],
    sonstiges: [['circle', { cx: 12, cy: 12, r: 4 }]],
  };

  const SYMBOL_MUSTER = [
    ['voicebot', /voicebot|sprachassistent|sprachdialog|\bbot\b|ivr|chatbot/i],
    ['nachricht', /sms|chat|messenger|whatsapp|nachricht/i],
    ['telefon', /telefon|hotline|anruf|call/i],
    ['app', /\bapp\b|smartphone|handy|mobil/i],
    ['web', /website|webseite|internet|portal|online|homepage|\bweb\b/i],
    ['post', /e-?mail|\bmail|brief|\bpost\b|schreiben/i],
    ['aushang', /aushang|hausflur|flyer|plakat|schaukasten|aufsteller/i],
    ['person', /service-?team|mitarbeit|berater|team|person|hauswart|hausmeist|kundenservice|sachbearbeit/i],
    ['ort', /vor ort|büro|buero|geschäftsstelle|servicepunkt|wohnung|filiale/i],
  ];

  function symbol(art, klasse) {
    const svg = s('svg', { class: klasse || 'jm-symbol', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' });
    for (const [tag, attrs] of SYMBOLE[art] || SYMBOLE.sonstiges) svg.append(s(tag, attrs));
    return svg;
  }

  function touchpointArt(text) {
    const treffer = SYMBOL_MUSTER.find(([, muster]) => muster.test(text || ''));
    return treffer ? treffer[0] : 'sonstiges';
  }

  /* ---------- Emotionskurve ---------- */

  /** Weiche Kurve durch alle Punkte (Catmull-Rom als Bézier-Kurven). */
  function glatterPfad(p) {
    const r = (z) => Math.round(z * 10) / 10;
    let d = 'M' + r(p[0].x) + ' ' + r(p[0].y);
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i];
      const p1 = p[i];
      const p2 = p[i + 1];
      const p3 = p[i + 2] || p2;
      d +=
        ' C' +
        [p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6, p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6, p2.x, p2.y]
          .map(r)
          .join(' ');
    }
    return d;
  }

  /**
   * Durchgehende Emotionskurve über alle Spalten. Die Linie ist SVG (dehnt sich mit der Breite),
   * die Gesichter sind eigene Elemente, damit sie rund bleiben.
   */
  function emotionsKurve(spalten, nr, kz) {
    const n = spalten.length;
    const y = (v) => 50 - v * 20; // -2 … 2 → 90 … 10 (Prozent der Höhe)
    const flaeche = h('div', { class: 'jm-kurve-flaeche' });
    const svg = s('svg', {
      class: 'jm-kurve-svg',
      viewBox: '0 0 ' + n * 100 + ' 100',
      preserveAspectRatio: 'none',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.append(
      s('rect', { class: 'zone-positiv', x: 0, y: 0, width: n * 100, height: 50 }),
      s('rect', { class: 'zone-negativ', x: 0, y: 50, width: n * 100, height: 50 }),
      s('line', { class: 'kurve-null', x1: 0, y1: 50, x2: n * 100, y2: 50 })
    );
    const abschnitte = [];
    let abschnitt = [];
    spalten.forEach((sp, i) => {
      if (sp.schritt && sp.schritt.emotion !== null) {
        abschnitt.push({ x: i * 100 + 50, y: y(sp.schritt.emotion) });
      } else if (abschnitt.length) {
        abschnitte.push(abschnitt);
        abschnitt = [];
      }
    });
    if (abschnitt.length) abschnitte.push(abschnitt);
    for (const a of abschnitte) if (a.length > 1) svg.append(s('path', { class: 'kurve-linie', d: glatterPfad(a) }));
    flaeche.append(svg);

    spalten.forEach((sp, i) => {
      const x = sp.schritt;
      if (!x || x.emotion === null) return;
      const emo = M.EMOTIONEN.find((e) => e.wert === x.emotion);
      const art =
        kz.tiefpunkt && kz.tiefpunkt.schrittId === x.id ? 'tief' : kz.hoehepunkt && kz.hoehepunkt.schrittId === x.id ? 'hoch' : '';
      const gesicht = h(
        'span',
        { class: 'jm-gesicht emo-' + x.emotion + (art ? ' ' + art : ''), title: 'Schritt ' + nr.get(x.id) + ': ' + emo.label },
        emo.symbol
      );
      const links = ((i + 0.5) / n) * 100 + '%';
      gesicht.style.left = links;
      gesicht.style.top = y(x.emotion) + '%';
      flaeche.append(gesicht);
      if (art) {
        const marke = h('span', { class: 'jm-kurven-marke ' + art }, art === 'tief' ? 'Tiefpunkt' : 'Höhepunkt');
        marke.style.left = links;
        marke.style.top = y(x.emotion) + '%';
        flaeche.append(marke);
      }
    });
    const huelle = h('div', { class: 'jm-kurve' }, flaeche);
    huelle.style.gridColumn = '2 / span ' + n;
    return huelle;
  }

  /* ---------- Journey Map ---------- */

  function mapDokument(m, modus) {
    const pr = P.pruefen(m);
    const kz = M.kennzahlen(m);
    const st = m.version.status;
    const nr = new Map(M.geordneteSchritte(m).map((x, i) => [x.id, i + 1]));
    const leer = (t) => !String(t || '').trim();

    // Spalten: je Phase ihre Schritte, eine Platzhalterspalte für leere Phasen
    const gruppen = m.phasen.map((p, pi) => {
      const ss = m.schritte.filter((x) => x.phaseId === p.id);
      return { titel: phasenName(p), farbe: (pi % 6) + 1, schritte: ss.length ? ss : [null] };
    });
    const phasenIds = new Set(m.phasen.map((p) => p.id));
    const ohnePhase = m.schritte.filter((x) => !phasenIds.has(x.phaseId));
    if (ohnePhase.length) gruppen.push({ titel: 'Ohne Phase', farbe: 6, schritte: ohnePhase });
    const spalten = gruppen.flatMap((g) => g.schritte.map((schritt) => ({ schritt, farbe: g.farbe })));
    const n = spalten.length;

    const quelleMarke = (quelleId) => {
      const k = M.quellenKuerzel(m, quelleId);
      return k ? h('span', { class: 'jm-quelle' }, k) : null;
    };
    const spur = (titel, hinweis, zellen, klasse) => [
      h('div', { class: 'jm-spur-titel' + (klasse ? ' ' + klasse : '') }, h('span', {}, titel), hinweis ? h('small', {}, hinweis) : null),
      zellen,
    ];
    const jeSpalte = (klasse, fn, leerInhalt) =>
      spalten.map((sp) =>
        h('div', { class: 'jm-zelle ' + klasse + ' farbe-' + sp.farbe }, sp.schritt ? fn(sp.schritt) : leerInhalt || null)
      );

    /* Kopf */
    const titelTag = modus === 'druck' ? 'h1' : 'h3';
    const stempel =
      st === 'freigegeben'
        ? h('p', { class: 'jm-stempel freigegeben' }, 'Freigegeben · Version ' + m.version.nummer)
        : h('p', { class: 'jm-stempel' }, M.STATUS[st].label + ' · Version ' + m.version.nummer + ' · nicht freigegeben');
    const kachel = (wert, label) => h('div', { class: 'jm-kachel' }, h('dd', {}, String(wert)), h('dt', {}, label));
    const kopf = h(
      'header',
      { class: 'jm-kopf' },
      h(
        'div',
        { class: 'jm-kopf-haupt' },
        stempel,
        h(titelTag, { class: 'jm-titel' }, m.rahmen.titel.trim() || 'Ohne Titel'),
        leer(m.rahmen.anlass) ? null : h('p', { class: 'jm-anlass' }, m.rahmen.anlass),
        h(
          'div',
          { class: 'jm-reise' },
          h('div', { class: 'jm-reise-punkt' }, h('span', { class: 'jm-augenbraue' }, 'Start'), h('span', {}, m.rahmen.startpunkt.trim() || '—')),
          h('span', { class: 'jm-reise-pfeil', 'aria-hidden': 'true' }),
          h('div', { class: 'jm-reise-punkt' }, h('span', { class: 'jm-augenbraue' }, 'Ziel'), h('span', {}, m.rahmen.endpunkt.trim() || '—'))
        )
      ),
      h(
        'div',
        { class: 'jm-kopf-seite' },
        h(
          'div',
          { class: 'jm-persona' },
          symbol('person', 'jm-persona-symbol'),
          h('div', {}, h('span', { class: 'jm-augenbraue' }, 'Nutzergruppe'), h('p', {}, m.rahmen.nutzergruppe.trim() || '—'))
        ),
        h(
          'dl',
          { class: 'jm-ueberblick' },
          kachel(kz.schritte, 'Schritte'),
          kachel(kz.touchpoints, 'Touchpoints'),
          kachel(kz.painPoints, 'Pain Points')
        ),
        kz.tiefpunkt
          ? h(
              'p',
              { class: 'jm-tiefpunkt' },
              h('strong', {}, 'Tiefpunkt: '),
              'Schritt ' + kz.tiefpunkt.nr + (kz.tiefpunkt.aktion ? ': ' + kuerzen(kz.tiefpunkt.aktion, 90) : '') + (kz.tiefpunkt.phase ? ' (' + kz.tiefpunkt.phase + ')' : '')
            )
          : null
      )
    );

    /* Raster mit Spuren */
    const raster = h('div', { class: 'jm-raster', 'aria-hidden': 'true' });
    raster.style.setProperty('--spalten', String(n));

    const phasen = gruppen.map((g, gi) => {
      const pp = g.schritte.reduce((summe, x) => summe + (x ? x.painPoints.length : 0), 0);
      const el = h(
        'div',
        { class: 'jm-phase farbe-' + g.farbe + (gi === 0 ? ' erste' : '') + (gi === gruppen.length - 1 ? ' letzte' : '') },
        h('span', { class: 'jm-phase-name' }, g.titel),
        pp ? h('span', { class: 'jm-phase-pp' }, mehrzahl(pp, 'Pain Point', 'Pain Points')) : null
      );
      el.style.gridColumn = 'span ' + g.schritte.length;
      return el;
    });

    const hatGedanken = m.schritte.some((x) => !leer(x.gedanken));
    const hatZitate = m.schritte.some((x) => !leer(x.zitat));
    const hatIntern = m.schritte.some((x) => !leer(x.intern));

    const linie = hatIntern
      ? h('div', { class: 'jm-sichtlinie' }, h('span', {}, 'Sichtbarkeitslinie · darunter: was intern passiert, für Kund*innen nicht sichtbar'))
      : null;
    if (linie) linie.style.gridColumn = '1 / -1';

    fuellen(
      raster,
      spur('Phase', null, phasen, 'oben'),
      spur(
        'Was die Person tut',
        null,
        jeSpalte(
          'jm-zelle-aktion',
          (x) =>
            h(
              'div',
              { class: 'jm-karte' },
              h('span', { class: 'jm-nr' }, String(nr.get(x.id))),
              h('p', {}, x.aktion.trim() || '—'),
              quelleMarke(x.quelleId)
            ),
          h('div', { class: 'jm-karte jm-leer' }, 'Noch keine Schritte')
        )
      ),
      spur(
        'Touchpoint',
        null,
        jeSpalte('jm-zelle-tp', (x) =>
          leer(x.touchpoint) ? null : h('div', { class: 'jm-tp' }, symbol(touchpointArt(x.touchpoint)), h('span', {}, x.touchpoint))
        )
      ),
      hatGedanken
        ? spur('Was sie denkt', null, jeSpalte('jm-zelle-gedanke', (x) => (leer(x.gedanken) ? null : h('p', { class: 'jm-gedanke' }, x.gedanken))))
        : null,
      spur('Wie sie sich fühlt', 'oben positiv, unten negativ', [emotionsKurve(spalten, nr, kz)]),
      spur(
        'Pain Points',
        null,
        jeSpalte('jm-zelle-pp', (x) =>
          x.painPoints.map((pp) => h('div', { class: 'jm-pp' }, h('p', {}, pp.text.trim() || '—'), quelleMarke(pp.quelleId)))
        )
      ),
      hatZitate
        ? spur('Zitate', null, jeSpalte('jm-zelle-zitat', (x) => (leer(x.zitat) ? null : h('blockquote', { class: 'jm-zitat' }, x.zitat))))
        : null,
      linie,
      hatIntern
        ? spur('Interner Ablauf', null, jeSpalte('jm-zelle-intern', (x) => (leer(x.intern) ? null : h('div', { class: 'jm-intern' }, x.intern))), 'intern')
        : null
    );

    /* Textfassung für Screenreader (die Grafik ist für sie ausgeblendet) */
    const textfassung = h(
      'div',
      { class: 'visuell-versteckt' },
      h('p', {}, 'Textfassung der Journey Map'),
      h(
        'ol',
        {},
        M.geordneteSchritte(m).map((x) => {
          const phase = m.phasen.find((p) => p.id === x.phaseId);
          const emo = M.EMOTIONEN.find((e) => e.wert === x.emotion);
          return h(
            'li',
            {},
            [
              'Phase: ' + (phase ? phasenName(phase) : 'ohne Phase'),
              'Aktion: ' + (x.aktion.trim() || 'fehlt'),
              'Touchpoint: ' + (x.touchpoint.trim() || 'fehlt'),
              'Emotion: ' + (emo ? emo.label : 'nicht erfasst'),
              leer(x.gedanken) ? null : 'Gedanken: ' + x.gedanken,
              x.painPoints.length ? 'Pain Points: ' + x.painPoints.map((pp) => pp.text).join('; ') : null,
              leer(x.zitat) ? null : 'Zitat: ' + x.zitat,
              leer(x.intern) ? null : 'Interner Ablauf: ' + x.intern,
            ]
              .filter(Boolean)
              .join('. ') + '.'
          );
        })
      )
    );

    /* Fuß: Legende, Quellen, Versionsstand */
    const offen = pr.zaehler.fehlt + pr.zaehler.rueckfrage;
    const angaben = [
      'Version ' + m.version.nummer + ' · ' + M.STATUS[st].label + ' · Stand ' + datumDe(m.version.stand),
      m.version.freigabe ? 'Freigegeben durch ' + m.version.freigabe.durch + ' am ' + datumDe(m.version.freigabe.datum) : null,
      leer(m.rahmen.erfasstVon) ? null : 'Erfasst von ' + m.rahmen.erfasstVon.trim(),
      leer(m.rahmen.fachbereich) ? null : 'Geprüft durch ' + m.rahmen.fachbereich.trim(),
      modus === 'druck' ? 'gedruckt am ' + datumDe(M.heute()) : null,
      offen ? mehrzahl(offen, 'offener Prüfpunkt', 'offene Prüfpunkte') : null,
    ].filter(Boolean);
    const fuss = h(
      'footer',
      { class: 'jm-fuss' },
      h(
        'div',
        { class: 'jm-legende' },
        h('span', { class: 'jm-augenbraue' }, 'Emotion'),
        M.EMOTIONEN.map((e) => h('span', { class: 'jm-legende-eintrag' }, h('span', { 'aria-hidden': 'true' }, e.symbol), ' ' + e.label))
      ),
      m.quellen.length
        ? h(
            'div',
            { class: 'jm-quellen' },
            h('span', { class: 'jm-augenbraue' }, 'Quellen'),
            h(
              'ol',
              {},
              m.quellen.map((q, i) => {
                const art = M.artInfo(q.art);
                return h(
                  'li',
                  {},
                  h('span', { class: 'jm-quelle' }, 'Q' + (i + 1)),
                  ' ' + (q.bezeichnung.trim() || '—') + (art ? ' · ' + art.label : '') + (q.stand.trim() ? ' · ' + q.stand : '')
                );
              })
            )
          )
        : null,
      h('p', { class: 'jm-angaben' }, 'Journey-Map-Vorlage · ' + angaben.join(' · '))
    );

    const buehne = h('div', { class: 'jm-buehne' }, raster);
    if (modus !== 'druck') {
      buehne.setAttribute('role', 'region');
      buehne.setAttribute('tabindex', '0');
      buehne.setAttribute('aria-label', 'Grafische Journey Map, horizontal scrollbar. Die Textfassung steht davor.');
    }
    return h('div', { class: 'jm-doc' }, kopf, textfassung, buehne, fuss);
  }

  function renderMap(panel) {
    fuellen(panel, 
      panelKopf(
        '4 · Map',
        IM_VIEWER
          ? 'So sieht die Journey Map aus. Für den PDF-Export sicherst du eine druckfertige Datei, öffnest sie im Browser und speicherst sie mit Strg+P als PDF (A3 quer).'
          : 'So sieht die Journey Map aus. Für den Export im Druckdialog „Als PDF speichern“ wählen, am besten im Format A3 quer.'
      ),
      h(
        'div',
        { class: 'map-werkzeuge' },
        h('button', { type: 'button', class: 'primaer', onclick: exportieren }, IM_VIEWER ? 'Druckfertige Datei sichern …' : 'Als PDF exportieren …'),
        h('p', {}, 'Der Export wird mit Version und Datum in der Versionshistorie vermerkt.')
      ),
      zustand.pruefung.vollstaendig
        ? null
        : h(
            'div',
            { class: 'box box-warnung' },
            h(
              'p',
              {},
              'Die Map ist noch nicht vollständig. ',
              h('button', { type: 'button', class: 'link', onclick: () => zeigeTab('pruefung') }, 'Offene Prüfpunkte ansehen')
            )
          ),
      h('div', { class: 'map-rahmen' }, mapDokument(zustand.map, 'ansicht'))
    );
  }

  function druckvorbereiten() {
    document.getElementById('druck').replaceChildren(mapDokument(zustand.map, 'druck'));
  }

  function htmlText(text) {
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Stile dieser Seite als Text, für die exportierte Datei. */
  async function seitenStile() {
    let css = '';
    for (const blatt of Array.from(document.styleSheets)) {
      try {
        css += Array.from(blatt.cssRules)
          .map((r) => r.cssText)
          .join('\n') + '\n';
      } catch (e) {
        // Stylesheet nicht lesbar (z. B. andere Herkunft): unten nachladen
      }
    }
    if (!css.includes('.jm')) {
      try {
        const antwort = await fetch('css/app.css');
        if (antwort.ok) css += await antwort.text();
      } catch (e) {
        // ohne Stile weiter; die Map bleibt lesbar
      }
    }
    return css;
  }

  /** Eigenständige HTML-Datei der Map mit den Stilen dieser Seite, zum Drucken als PDF. Ohne Skripte. */
  async function exportHtml(m) {
    const css = (await seitenStile()).replace(/<\/style/gi, '<\\/style');
    const huelle = h('div', {}, mapDokument(m, 'druck'));
    const titel = M.dateiname(m, 'html').replace(/\.html$/, '');
    return (
      '<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + htmlText(titel) + '</title>\n<style>\n' + css + '</style>\n</head>\n<body class="export">\n' +
      '<p class="export-hinweis">Als PDF speichern: Strg+P (Mac: Cmd+P), Ziel „Als PDF speichern“, Format A3 quer.</p>\n' +
      '<div id="druck">' + huelle.innerHTML + '</div>\n</body>\n</html>\n'
    );
  }

  function exportVermerkSetzen() {
    M.exportVermerken(zustand.map);
    zustand.geaendert = true;
    neuBewerten();
    renderAktivenTab();
  }

  async function exportieren() {
    const m = zustand.map;
    if (IM_VIEWER) {
      const name = M.dateiname(m, 'html');
      if (!(await dateiAnbieten(name, await exportHtml(m), 'text/html'))) return;
      exportVermerkSetzen();
      melden(
        'Druckfertige Datei „' + name + '“ gesichert. Öffne sie im Browser und speichere sie mit Strg+P als PDF. ' +
          'Speichere danach die Map, damit der Export-Vermerk erhalten bleibt.'
      );
      return;
    }
    M.exportVermerken(m);
    zustand.geaendert = true;
    neuBewerten();
    const alterTitel = document.title;
    document.title = M.dateiname(m, 'pdf').replace(/\.pdf$/, '');
    window.addEventListener(
      'afterprint',
      () => {
        document.title = alterTitel;
        renderKopf();
      },
      { once: true }
    );
    druckvorbereiten();
    window.print();
    renderAktivenTab();
    melden('Export vermerkt (Version ' + m.version.nummer + '). Bitte die Map jetzt speichern, damit der Vermerk erhalten bleibt.');
  }

  /* ================= Reiter 5: Prüfung und Freigabe ================= */

  function versionHinweis(key) {
    const nr = zustand.map.version.nummer;
    if (key === 'ueberarbeiten' || key === 'neueFassung') return ' (wird Version ' + M.naechsteNebenversion(nr) + ')';
    if (key === 'freigeben') return ' (wird Version ' + M.naechsteHauptversion(nr) + ')';
    return '';
  }

  function aktionenInhalt() {
    const m = zustand.map;
    const verfuegbar = M.verfuegbareAktionen(m);
    const gruendeJe = new Map(
      verfuegbar.map((key) => [key, M.hindernisse(m, key, zustand.pruefung, { durch: zustand.freigabeDurch })])
    );
    const empfohlen = verfuegbar.find((key) => !gruendeJe.get(key).length) || verfuegbar[0];
    return verfuegbar.map((key) => {
      const gruende = gruendeJe.get(key);
      const gesperrt = gruende.length > 0;
      const gid = 'gruende-' + key;
      return h(
        'div',
        { class: 'aktion' },
        h(
          'button',
          {
            type: 'button',
            class: key === empfohlen && !gesperrt ? 'primaer' : null,
            'aria-disabled': gesperrt ? 'true' : null,
            'aria-describedby': gesperrt ? gid : null,
            onclick: () => aktionKlick(key),
          },
          M.AKTIONEN[key].label + versionHinweis(key)
        ),
        gesperrt
          ? h('div', { id: gid, class: 'gruende' }, h('p', {}, 'Noch nicht möglich:'), h('ul', {}, gruende.map((g) => h('li', {}, g))))
          : null
      );
    });
  }

  async function aktionKlick(key) {
    const m = zustand.map;
    const gruende = M.hindernisse(m, key, zustand.pruefung, { durch: zustand.freigabeDurch });
    if (gruende.length) {
      melden('Noch nicht möglich: ' + gruende.join(' '), true);
      return;
    }
    const nr = m.version.nummer;
    const fragen = {
      zurPruefung: 'Map zur fachlichen Prüfung geben? Der Inhalt wird gesperrt, bis die Rückmeldungen eingearbeitet werden.',
      ueberarbeiten: 'Rückmeldungen einarbeiten? Die Map wird wieder bearbeitbar und erhält Version ' + M.naechsteNebenversion(nr) + '.',
      freigeben: 'Version ' + M.naechsteHauptversion(nr) + ' freigeben? Danach ist der Inhalt gesperrt.',
      neueFassung: 'Neue Fassung beginnen? Die Map wird wieder bearbeitbar und erhält Version ' + M.naechsteNebenversion(nr) + '.',
    };
    if (!(await bestaetigen(fragen[key], M.AKTIONEN[key].label))) return;
    aendern(() => M.aktionAusfuehren(m, key, { durch: zustand.freigabeDurch, notiz: zustand.statusNotiz }), {
      inhalt: false,
    });
    zustand.freigabeDurch = '';
    zustand.statusNotiz = '';
    renderAktivenTab('h-status');
    melden('Status: ' + M.STATUS[m.version.status].label + ', Version ' + m.version.nummer + '. Bitte speichern.');
  }

  function statusBereich() {
    const m = zustand.map;
    const st = m.version.status;
    const verfuegbar = M.verfuegbareAktionen(m);
    return h(
      'section',
      { class: 'karte', 'aria-labelledby': 'h-status' },
      h('h3', { id: 'h-status', tabindex: '-1' }, 'Status: ' + M.STATUS[st].label + ' · Version ' + m.version.nummer),
      h(
        'ol',
        { class: 'status-ablauf', 'aria-label': 'Ablauf der Freigabe' },
        M.STATUS_REIHENFOLGE.map((k) => h('li', { 'aria-current': k === st ? 'step' : null }, M.STATUS[k].label))
      ),
      h('p', {}, NAECHSTER_SCHRITT[st]),
      verfuegbar.includes('freigeben')
        ? feld({
            id: 'f-freigabe-durch',
            label: 'Freigegeben durch',
            hilfe: 'Rolle oder Gremium, z. B. „Fachbereich Kundenservice, Teamleitung“. Nötig für die Freigabe.',
            wert: zustand.freigabeDurch,
            onInput: (v) => {
              zustand.freigabeDurch = v;
              aktualisiereAbgeleitet();
            },
          })
        : null,
      feld({
        id: 'f-status-notiz',
        label: 'Notiz zur Statusänderung',
        optional: true,
        typ: 'textarea',
        zeilen: 2,
        wert: zustand.statusNotiz,
        hilfe: 'Erscheint in der Versionshistorie, z. B. „Entwurf an den Kundenservice geschickt“.',
        onInput: (v) => {
          zustand.statusNotiz = v;
        },
      }),
      h('div', { class: 'aktionen', 'data-abgeleitet': 'aktionen' })
    );
  }

  function zumFeld(p) {
    zustand.alleZeigen = true;
    const schrittId = schrittZuFeld(p.feldId);
    if (schrittId) zustand.offenerSchritt = schrittId;
    zeigeTab(p.tab, p.feldId);
  }

  function prueflisteInhalt() {
    const pr = zustand.pruefung;
    if (!pr.probleme.length) {
      return [h('div', { class: 'box box-ok' }, h('p', {}, '✓ Alles vollständig. Keine Rückfragen und keine Hinweise.'))];
    }
    const teile = [];
    if (pr.vollstaendig) {
      teile.push(
        h('div', { class: 'box box-ok' }, h('p', {}, '✓ Alle Pflichtangaben sind vollständig, es gibt keine offenen Rückfragen. Die Hinweise unten blockieren nicht.'))
      );
    } else {
      const teileText = [];
      if (pr.zaehler.fehlt) teileText.push(mehrzahl(pr.zaehler.fehlt, 'fehlende Angabe', 'fehlende Angaben'));
      if (pr.zaehler.rueckfrage) teileText.push(mehrzahl(pr.zaehler.rueckfrage, 'Rückfrage', 'Rückfragen'));
      teile.push(h('p', {}, 'Noch offen: ' + teileText.join(' und ') + '. Erst danach kann die Map zur Prüfung oder in die Freigabe.'));
    }
    for (const tab of TABS) {
      const liste = pr.probleme.filter((p) => p.tab === tab.id).sort((a, b) => TYP_RANG[a.typ] - TYP_RANG[b.typ]);
      if (!liste.length) continue;
      teile.push(
        h('h4', {}, tab.label),
        h(
          'ul',
          { class: 'problem-gruppe' },
          liste.map((p) =>
            h(
              'li',
              {},
              h('span', { class: 'typ-chip typ-' + p.typ }, TYP_LABEL[p.typ]),
              h('span', {}, p.text),
              p.feldId
                ? h('button', { type: 'button', class: 'link', 'aria-label': 'Zum Feld: ' + p.text, onclick: () => zumFeld(p) }, 'Zum Feld')
                : null
            )
          )
        )
      );
    }
    return teile;
  }

  function rueckmeldungsZaehlerText() {
    const liste = zustand.map.rueckmeldungen;
    if (!liste.length) return '';
    const offen = liste.filter((r) => r.status === 'offen').length;
    return mehrzahl(liste.length, 'Rückmeldung', 'Rückmeldungen') + ', davon ' + offen + ' offen';
  }

  function bezugOptionen(r) {
    const m = zustand.map;
    const optionen = [
      { wert: 'allgemein', label: 'Map allgemein' },
      { wert: 'rahmen', label: 'Rahmen' },
      ...m.phasen.map((p, i) => ({ wert: 'phase:' + p.id, label: 'Phase ' + (i + 1) + ': ' + phasenName(p) })),
      ...M.geordneteSchritte(m).map((x, i) => ({
        wert: 'schritt:' + x.id,
        label: 'Schritt ' + (i + 1) + ': ' + kuerzen(x.aktion || '(ohne Aktion)', 50),
      })),
    ];
    if (!optionen.some((o) => o.wert === r.bezug)) optionen.push({ wert: r.bezug, label: '(gelöschter Bezug)' });
    return optionen;
  }

  function rueckmeldungKarte(r, i) {
    const f = (feldname) => 'f-rm-' + r.id + '-' + feldname;
    const aendernRm = (fn, optionen) => aendern(fn, Object.assign({ inhalt: false }, optionen || {}));
    const nr = i + 1;
    return h(
      'li',
      { class: 'karte', id: 'karte-' + r.id },
      h(
        'div',
        { class: 'karte-kopf' },
        h('h4', {}, 'Rückmeldung ' + nr + ' · ' + M.RUECKMELDUNG_STATUS[r.status]),
        h(
          'button',
          { type: 'button', class: 'gefahr', 'aria-label': 'Rückmeldung ' + nr + ' löschen', onclick: () => rueckmeldungLoeschen(r, nr) },
          'Löschen'
        )
      ),
      h(
        'div',
        { class: 'raster' },
        feld({
          id: f('bezug'),
          label: 'Bezieht sich auf',
          typ: 'select',
          leerOption: false,
          wert: r.bezug,
          optionen: bezugOptionen(r),
          onInput: (v) =>
            aendernRm(() => {
              r.bezug = v;
            }),
        }),
        feld({
          id: f('von'),
          label: 'Von',
          wert: r.von,
          hilfe: 'Rolle oder Bereich, z. B. „Fachbereich Kundenservice“.',
          onInput: (v) =>
            aendernRm(() => {
              r.von = v;
            }),
        }),
        feld({
          id: f('kanal'),
          label: 'Eingegangen über',
          typ: 'select',
          wert: r.kanal,
          optionen: M.KANAELE.map((k) => ({ wert: k, label: k })),
          onInput: (v) =>
            aendernRm(() => {
              r.kanal = v;
            }),
        }),
        feld({
          id: f('datum'),
          label: 'Datum',
          typ: 'date',
          wert: r.datum,
          onInput: (v) =>
            aendernRm(() => {
              r.datum = v;
            }),
        })
      ),
      feld({
        id: f('text'),
        label: 'Rückmeldung',
        pflicht: true,
        typ: 'textarea',
        wert: r.text,
        hilfe: 'Sinngemäß zusammenfassen. Keine Namen von Kund*innen.',
        onInput: (v) =>
          aendernRm(() => {
            r.text = v;
          }),
      }),
      h(
        'div',
        { class: 'raster' },
        feld({
          id: f('status'),
          label: 'Bearbeitung',
          typ: 'select',
          leerOption: false,
          wert: r.status,
          optionen: Object.entries(M.RUECKMELDUNG_STATUS).map(([k, label]) => ({ wert: k, label })),
          onInput: (v) =>
            aendernRm(
              () => {
                r.status = v;
              },
              { neuZeichnen: true, fokus: f('status') }
            ),
        }),
        feld({
          id: f('antwort'),
          label: 'Antwort oder Begründung',
          optional: true,
          typ: 'textarea',
          zeilen: 2,
          wert: r.antwort,
          hilfe: 'Was wurde geändert? Bei „nicht übernommen“ bitte begründen.',
          onInput: (v) =>
            aendernRm(() => {
              r.antwort = v;
            }),
        })
      )
    );
  }

  function rueckmeldungHinzufuegen() {
    const r = M.neueRueckmeldung();
    aendern(() => zustand.map.rueckmeldungen.push(r), { inhalt: false, neuZeichnen: true, fokus: 'f-rm-' + r.id + '-text' });
  }

  async function rueckmeldungLoeschen(r, nr) {
    if (!(await bestaetigen('Rückmeldung ' + nr + ' löschen?', 'Rückmeldung löschen', true))) return;
    aendern(
      () => {
        zustand.map.rueckmeldungen = zustand.map.rueckmeldungen.filter((x) => x !== r);
      },
      { inhalt: false, neuZeichnen: true, fokus: 'f-rm-neu' }
    );
    melden('Rückmeldung gelöscht.');
  }

  function rueckmeldungenBereich() {
    const m = zustand.map;
    return h(
      'section',
      { class: 'karte', 'aria-labelledby': 'h-rueckmeldungen' },
      h(
        'div',
        { class: 'karte-kopf' },
        h('h3', { id: 'h-rueckmeldungen' }, 'Rückmeldungen'),
        h('span', { class: 'rm-zaehler', 'data-abgeleitet': 'rm-zaehler' })
      ),
      h(
        'p',
        { class: 'hilfe' },
        'Sammle hier alle Rückmeldungen, egal ob per E-Mail, Teams, im Termin oder am Telefon. So geht nichts verloren und jede Entscheidung bleibt nachvollziehbar.'
      ),
      m.rueckmeldungen.length
        ? h('ol', { class: 'liste-ohne' }, m.rueckmeldungen.map((r, i) => rueckmeldungKarte(r, i)))
        : h('p', {}, 'Noch keine Rückmeldungen.'),
      h('button', { type: 'button', id: 'f-rm-neu', onclick: rueckmeldungHinzufuegen }, '+ Rückmeldung erfassen'),
      problemAnzeige('f-rm-neu')
    );
  }

  function erledigtInhalt() {
    const e = M.erledigtStand(zustand.map, zustand.pruefung);
    return [
      e.erledigt
        ? h('div', { class: 'box box-ok' }, h('p', {}, '✓ Erledigt: fachlich geprüft, freigegeben und mit Versionsstand exportiert.'))
        : h('p', {}, 'Die Journey Map ist erledigt, wenn alle Punkte erfüllt sind:'),
      h(
        'ul',
        { class: 'checkliste' },
        e.punkte.map((p) =>
          h(
            'li',
            { class: p.ok ? 'ok' : 'offen' },
            h('span', { 'aria-hidden': 'true' }, p.ok ? '✓ ' : '○ '),
            h('span', { class: 'visuell-versteckt' }, p.ok ? 'Erfüllt: ' : 'Offen: '),
            p.text
          )
        )
      ),
    ];
  }

  function historieBereich() {
    const m = zustand.map;
    return h(
      'section',
      { class: 'karte', 'aria-labelledby': 'h-historie' },
      h('h3', { id: 'h-historie' }, 'Versionshistorie'),
      h(
        'div',
        { class: 'tabelle-scroll', role: 'region', 'aria-labelledby': 'h-historie', tabindex: '0' },
        h(
          'table',
          { class: 'historie' },
          h('thead', {}, h('tr', {}, ['Datum', 'Version', 'Ereignis', 'Notiz'].map((t) => h('th', { scope: 'col' }, t)))),
          h(
            'tbody',
            {},
            m.historie
              .slice()
              .reverse()
              .map((e) =>
                h(
                  'tr',
                  {},
                  h('td', {}, datumDe(e.datum)),
                  h('td', {}, e.version),
                  h('td', {}, M.EREIGNISSE[e.ereignis] + (e.durch ? ' durch ' + e.durch : '')),
                  h('td', {}, e.notiz || '—')
                )
              )
          )
        )
      )
    );
  }

  function renderPruefung(panel) {
    fuellen(panel, 
      panelKopf(
        '5 · Prüfung und Freigabe',
        'Hier siehst du, was noch fehlt, sammelst alle Rückmeldungen an einer Stelle und steuerst Status und Version.'
      ),
      statusBereich(),
      h(
        'section',
        { class: 'karte', 'aria-labelledby': 'h-pruefliste' },
        h('h3', { id: 'h-pruefliste', tabindex: '-1' }, 'Prüfpunkte'),
        h('div', { 'data-abgeleitet': 'pruefliste' })
      ),
      rueckmeldungenBereich(),
      h(
        'section',
        { class: 'karte', 'aria-labelledby': 'h-erledigt' },
        h('h3', { id: 'h-erledigt' }, 'Erledigt?'),
        h('div', { 'data-abgeleitet': 'erledigt' })
      ),
      historieBereich()
    );
  }

  /* ================= Dateien ================= */

  async function verwerfenOk() {
    return (
      !zustand.geaendert ||
      bestaetigen('Es gibt ungespeicherte Änderungen. Sie gehen verloren, wenn du fortfährst.', 'Änderungen verwerfen', true)
    );
  }

  /**
   * Bietet eine Datei zum Speichern an.
   * Als gehostete Seite (claude.ai) über die Download-Funktion des Viewers, lokal über einen Download-Link.
   * Liefert true, wenn die Datei übergeben wurde.
   */
  async function dateiAnbieten(name, inhalt, typ) {
    if (IM_VIEWER) {
      const downloads = await downloadsBereit;
      if (!downloads) {
        melden('Speichern ist in dieser Ansicht nicht möglich. Öffne die Seite in claude.ai.', true);
        return false;
      }
      try {
        await downloads.save({ filename: name, data: inhalt });
        return true;
      } catch (fehler) {
        const code = fehler && fehler.code;
        if (code === 'declined') melden('Speichern abgebrochen.');
        else if (code === 'rate_limited') melden('Es ist schon ein Speicherdialog offen. Bitte kurz warten.', true);
        else melden('Die Datei konnte nicht gespeichert werden.', true);
        return false;
      }
    }
    const url = URL.createObjectURL(new Blob([inhalt], { type: typ }));
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }

  function laden(map, meldung, optionen) {
    const o = optionen || {};
    zustand.map = map;
    zustand.geaendert = false;
    zustand.alleZeigen = !o.neu;
    zustand.freigabeDurch = '';
    zustand.statusNotiz = '';
    zustand.liste = leereListe();
    zustand.schnell = { text: '', phaseId: '' };
    zustand.offenerSchritt = null;
    zustand.auswahl.clear();
    zustand.rueckgaengig = null;
    renderRueckgaengig();
    zustand.pruefung = P.pruefen(map);
    zeigeTab(o.tab || 'rahmen');
    if (meldung) melden(meldung);
  }

  async function speichern() {
    const name = M.dateiname(zustand.map, 'json');
    if (!(await dateiAnbieten(name, M.zuJson(zustand.map), 'application/json'))) return;
    zustand.geaendert = false;
    renderKopf();
    melden('Gespeichert als „' + name + '“ (im Download-Ordner).');
  }

  async function oeffnen() {
    if (!(await verwerfenOk())) return;
    const eingabe = document.getElementById('datei-eingabe');
    eingabe.value = '';
    eingabe.click();
  }

  function dateiGewaehlt(e) {
    const datei = e.target.files && e.target.files[0];
    if (!datei) return;
    if (datei.size > MAX_DATEIGROESSE) {
      melden('Die Datei ist zu groß für eine Journey Map (über 2 MB). Enthält sie Rohdaten?', true);
      return;
    }
    datei
      .text()
      .then((inhalt) => {
        const ergebnis = M.ausJson(inhalt);
        if (!ergebnis.ok) {
          melden(ergebnis.fehler, true);
          return;
        }
        laden(ergebnis.map, 'Datei „' + datei.name + '“ geöffnet.', { tab: 'map' });
      })
      .catch(() => melden('Die Datei konnte nicht gelesen werden.', true));
  }

  async function neu() {
    if (!(await verwerfenOk())) return;
    laden(M.leereMap(), 'Neue, leere Journey Map angelegt.', { neu: true, tab: 'rahmen' });
  }

  function beispielMap() {
    return M.ausJson(JSON.stringify(B.beispielMap())).map;
  }

  async function beispielLaden() {
    if (!(await verwerfenOk())) return;
    laden(beispielMap(), 'Fiktives Beispiel geladen. Es dient nur zur Orientierung.', { tab: 'map' });
  }

  /* ================= Bestätigungsdialog ================= */

  /**
   * Eigener Dialog statt window.confirm (der in eingebetteten Seiten nicht angezeigt wird).
   * Liefert ein Promise mit true (bestätigt) oder false (abgebrochen).
   */
  function bestaetigen(text, okText, gefahr) {
    const dlg = document.getElementById('bestaetigung');
    const ok = document.getElementById('bestaetigung-ok');
    const abbrechen = document.getElementById('bestaetigung-abbrechen');
    const vorher = document.activeElement;
    document.getElementById('bestaetigung-text').textContent = text;
    ok.textContent = okText || 'OK';
    ok.className = gefahr ? 'gefahr-primaer' : 'primaer';
    return new Promise((resolve) => {
      let erledigt = false;
      const fertig = (wert) => {
        if (erledigt) return;
        erledigt = true;
        if (dlg.open) dlg.close();
        if (!wert && vorher && document.contains(vorher)) vorher.focus();
        resolve(wert);
      };
      ok.onclick = () => fertig(true);
      abbrechen.onclick = () => fertig(false);
      dlg.oncancel = (e) => {
        e.preventDefault();
        fertig(false);
      };
      dlg.showModal();
      abbrechen.focus();
    });
  }

  function baueDialog() {
    document.body.append(
      h(
        'dialog',
        { id: 'bestaetigung', class: 'dialog', 'aria-labelledby': 'bestaetigung-titel', 'aria-describedby': 'bestaetigung-text' },
        h('h2', { id: 'bestaetigung-titel' }, 'Bitte bestätigen'),
        h('p', { id: 'bestaetigung-text' }),
        h(
          'div',
          { class: 'dialog-aktionen' },
          h('button', { type: 'button', id: 'bestaetigung-abbrechen' }, 'Abbrechen'),
          h('button', { type: 'button', id: 'bestaetigung-ok', class: 'primaer' }, 'OK')
        )
      )
    );
  }

  /* ================= Start ================= */

  function start() {
    baueDialog();
    document.body.append(h('div', { id: 'rueckgaengig', class: 'rueckgaengig', role: 'status', 'aria-live': 'polite' }));
    const importEingabe = h('input', { type: 'file', id: 'import-datei', accept: '.xlsx,.xlsm,.csv,.txt,.docx', hidden: true });
    importEingabe.addEventListener('change', importDateiGewaehlt);
    document.body.append(importEingabe);
    baueTabs();
    document.getElementById('btn-neu').addEventListener('click', neu);
    document.getElementById('btn-oeffnen').addEventListener('click', oeffnen);
    document.getElementById('btn-speichern').addEventListener('click', speichern);
    document.getElementById('btn-beispiel').addEventListener('click', beispielLaden);
    document.getElementById('datei-eingabe').addEventListener('change', dateiGewaehlt);
    document.getElementById('btn-pruefstand').addEventListener('click', () => zeigeTab('pruefung', 'h-pruefliste'));

    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        speichern();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (!zustand.geaendert) return;
      e.preventDefault();
      e.returnValue = '';
    });
    window.addEventListener('beforeprint', druckvorbereiten);
    window.addEventListener('afterprint', () => document.getElementById('druck').replaceChildren());

    // Als gehostete Seite mit dem fiktiven Beispiel starten, damit sofort sichtbar ist, was die Vorlage kann.
    const inhalt = document.getElementById('inhalt');
    if (inhalt && inhalt.getAttribute('data-start') === 'beispiel') {
      zustand.map = beispielMap();
      zustand.alleZeigen = true;
      zustand.pruefung = P.pruefen(zustand.map);
      zeigeTab('map');
    } else {
      zustand.pruefung = P.pruefen(zustand.map);
      zeigeTab('rahmen');
    }
  }

  start();
})();
