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
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
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

  function fokussieren(id) {
    let el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'FIELDSET') el = el.querySelector('input:checked') || el.querySelector('input');
    if (!el) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'center' });
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
    };
    for (const [key, fn] of Object.entries(bereiche)) {
      const el = document.querySelector('[data-abgeleitet="' + key + '"]');
      if (el) el.replaceChildren(...fn());
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
    aendern(
      () => {
        zustand.map.quellen = zustand.map.quellen.filter((x) => x !== q);
        for (const schritt of zustand.map.schritte) {
          if (schritt.quelleId === q.id) schritt.quelleId = '';
          for (const pp of schritt.painPoints) if (pp.quelleId === q.id) pp.quelleId = '';
        }
      },
      { neuZeichnen: true, fokus: 'f-quelle-neu' }
    );
    melden('Quelle ' + kuerzel + ' gelöscht.');
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
      { class: 'karte', open: !zustand.map.schritte.length },
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

  function phaseZeile(p, i, gesperrt) {
    const anzahl = zustand.map.schritte.filter((x) => x.phaseId === p.id).length;
    const letzte = zustand.map.phasen.length - 1;
    return h(
      'li',
      {},
      feld({
        id: 'f-phase-' + p.id + '-name',
        label: 'Phase ' + (i + 1),
        pflicht: true,
        wert: p.name,
        gesperrt,
        onInput: (v) =>
          aendern(() => {
            p.name = v;
            aktualisierePhasenNamen(p);
          }),
      }),
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
              { type: 'button', class: 'gefahr', 'aria-label': 'Phase ' + (i + 1) + ' löschen', onclick: () => phaseLoeschen(p, i, anzahl) },
              'Löschen'
            )
          )
    );
  }

  function schrittNeuId(phaseIndex, phaseId) {
    return phaseIndex === 0 ? 'f-schritt-neu' : 'btn-schritt-neu-' + phaseId;
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

  function schrittKarte(schritt, nr, pos, anzahl, gesperrt) {
    const m = zustand.map;
    const f = (feldname) => 'f-schritt-' + schritt.id + '-' + feldname;
    const titelId = 'h-schritt-' + schritt.id;
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
    return h(
      'li',
      { class: 'karte schritt', id: 'karte-' + schritt.id, 'aria-labelledby': titelId },
      h(
        'div',
        { class: 'karte-kopf' },
        h('h4', { id: titelId, tabindex: '-1' }, 'Schritt ' + nr),
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
                { type: 'button', class: 'gefahr', 'aria-label': 'Schritt ' + nr + ' löschen', onclick: () => schrittLoeschen(schritt, nr) },
                'Löschen'
              )
            )
      ),
      h(
        'div',
        { class: 'raster' },
        textFeld('aktion', { label: 'Aktion', pflicht: true, hilfe: 'Was tut die Person? Aus ihrer Sicht formulieren.' }),
        textFeld('touchpoint', { label: 'Touchpoint', pflicht: true, hilfe: 'Kanal oder Kontaktpunkt, z. B. Voicebot, Website, Brief.' })
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
        })
      ),
      emotionFeld(schritt, gesperrt),
      painPointBereich(schritt, nr, gesperrt),
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
      feld({
        id: f('phase'),
        label: 'Phase',
        typ: 'select',
        pflicht: true,
        wert: schritt.phaseId,
        gesperrt,
        hilfe: 'Zum Verschieben in eine andere Phase.',
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
    );
  }

  function phaseBlock(p, i, gesperrt, nummern) {
    const schritte = zustand.map.schritte.filter((x) => x.phaseId === p.id);
    const kopfId = 'h-phase-' + p.id;
    return h(
      'section',
      { class: 'phase-block', 'aria-labelledby': kopfId },
      h('h3', { id: kopfId }, 'Phase ' + (i + 1) + ': ', h('span', { 'data-phase-titel': p.id }, phasenName(p))),
      schritte.length
        ? h(
            'ol',
            { class: 'liste-ohne' },
            schritte.map((x, j) => schrittKarte(x, nummern.get(x.id), j, schritte.length, gesperrt))
          )
        : h('p', { class: 'hilfe' }, 'Noch keine Schritte in dieser Phase.'),
      gesperrt
        ? null
        : h(
            'button',
            { type: 'button', id: schrittNeuId(i, p.id), 'aria-describedby': kopfId, onclick: () => schrittHinzufuegen(p.id) },
            '+ Schritt hinzufügen'
          ),
      i === 0 ? problemAnzeige('f-schritt-neu') : null
    );
  }

  function renderSchritte(panel) {
    const m = zustand.map;
    const gesperrt = !M.bearbeitbar(m);
    const nummern = new Map(M.geordneteSchritte(m).map((x, i) => [x.id, i + 1]));
    const phasenIds = new Set(m.phasen.map((p) => p.id));
    const ohnePhase = m.schritte.filter((x) => !phasenIds.has(x.phaseId));
    fuellen(panel, 
      panelKopf(
        '3 · Schritte erfassen',
        'Lege zuerst die Phasen an. Erfasse dann je Schritt Aktion, Touchpoint und Emotion, einzeln oder als Liste. Jeder Pain Point braucht eine Quelle.'
      ),
      sperrHinweis(),
      ausfuellhilfe(),
      h(
        'section',
        { class: 'karte', 'aria-labelledby': 'h-phasen' },
        h('h3', { id: 'h-phasen' }, 'Phasen'),
        h('p', { class: 'hilfe' }, 'Grobe Abschnitte der Journey in zeitlicher Reihenfolge, z. B. „Anliegen erkennen“, „Kontakt aufnehmen“.'),
        h('ol', { class: 'phasen-liste' }, m.phasen.map((p, i) => phaseZeile(p, i, gesperrt))),
        gesperrt ? null : h('button', { type: 'button', id: 'f-phase-neu', onclick: phaseHinzufuegen }, '+ Phase hinzufügen'),
        problemAnzeige('f-phase-neu')
      ),
      listenFormular(gesperrt),
      m.phasen.map((p, i) => phaseBlock(p, i, gesperrt, nummern)),
      ohnePhase.length
        ? h(
            'section',
            { class: 'phase-block', 'aria-labelledby': 'h-ohne-phase' },
            h('h3', { id: 'h-ohne-phase' }, 'Schritte ohne Phase'),
            h(
              'ol',
              { class: 'liste-ohne' },
              ohnePhase.map((x) => schrittKarte(x, nummern.get(x.id), 0, 1, gesperrt))
            )
          )
        : null,
      weiter('map', 'Weiter: Map ansehen')
    );
  }

  function listenAnzahlText(text) {
    const n = M.zeilenZuEintraegen(text).length;
    if (!n) return 'Noch keine Zeilen erkannt.';
    if (n > M.MAX_LISTENSCHRITTE) {
      return n + ' Zeilen erkannt. Auf einmal werden höchstens ' + M.MAX_LISTENSCHRITTE + ' Schritte angelegt.';
    }
    return n === 1 ? '1 Zeile erkannt, daraus wird ein Schritt.' : n + ' Zeilen erkannt, daraus werden ' + n + ' Schritte.';
  }

  /** Formular „Schritte aus einer Liste übernehmen“, z. B. Prozessschritte aus einer Dokumentation. */
  function listenFormular(gesperrt) {
    if (gesperrt) return null;
    const m = zustand.map;
    const liste = zustand.liste;
    if (!m.phasen.some((p) => p.id === liste.phaseId)) liste.phaseId = m.phasen.length ? m.phasen[0].id : '';
    if (liste.quelleId && !m.quellen.some((q) => q.id === liste.quelleId)) liste.quelleId = '';
    const anzahl = h('p', { class: 'hilfe', id: 'f-liste-anzahl', 'aria-live': 'polite' }, listenAnzahlText(liste.text));
    const alsOptionen = [
      ['aktion', 'Aktion: was die Kund*in tut'],
      ['intern', 'Interner Ablauf: was bei uns oder im System passiert'],
    ];
    const details = h(
      'details',
      { class: 'karte', id: 'liste-formular', open: liste.offen === null ? !m.schritte.length : liste.offen },
      h('summary', {}, 'Schritte übernehmen: aus einer Datei oder als Liste'),
      dateiBereich(),
      h('h4', { class: 'abschnitt' }, 'Als Liste einfügen'),
      h(
        'p',
        { class: 'hilfe' },
        'Füge eine Liste ein, einen Schritt pro Zeile. Aufzählungszeichen und Nummern werden entfernt. ' +
          'Touchpoint, Emotion und Pain Points ergänzt du danach je Schritt. Nur Schrittbezeichnungen einfügen, keine Rohdaten oder Gesprächsmitschriften.'
      ),
      feld({
        id: 'f-liste-text',
        label: 'Liste',
        typ: 'textarea',
        zeilen: 6,
        wert: liste.text,
        onInput: (v) => {
          liste.text = v;
          anzahl.textContent = listenAnzahlText(v);
        },
      }),
      anzahl,
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
      m.phasen.length
        ? h('button', { type: 'button', class: 'primaer', onclick: listeUebernehmen }, 'Schritte anlegen')
        : h('p', { class: 'hilfe' }, 'Lege zuerst oben eine Phase an.')
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
    aendern(
      () => {
        neu = M.schritteAusListe(m, { text: liste.text, als, phaseId: liste.phaseId, quelleId: liste.quelleId });
        liste.text = '';
        liste.offen = false;
        zustand.alleZeigen = true;
      },
      { neuZeichnen: true }
    );
    fokussieren('h-schritt-' + neu[0].id);
    melden(
      mehrzahl(neu.length, 'Schritt', 'Schritte') +
        ' angelegt' +
        (eintraege.length > neu.length ? ' (die ersten ' + neu.length + ' von ' + eintraege.length + ' Zeilen)' : '') +
        '. Ergänze jetzt ' +
        (als === 'intern' ? 'die Aktion aus Sicht der Kund*innen, ' : '') +
        'Touchpoint und Emotion.'
    );
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
    teile.push('Was noch fehlt, ist jetzt markiert.');
    melden(teile.join(' '));
  }

  async function vorlageHerunterladen() {
    if (await dateiAnbieten('journey-map-schritte-vorlage.csv', I.vorlageCsv(), 'text/csv;charset=utf-8')) {
      melden('Vorlage gespeichert. Öffne sie mit Excel, trage eine Zeile je Schritt ein und speichere sie als .xlsx oder .csv.');
    }
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

  async function phaseLoeschen(p, i, anzahl) {
    if (anzahl > 0) {
      melden(
        'Phase ' + (i + 1) + ' enthält noch ' + mehrzahl(anzahl, 'Schritt', 'Schritte') + '. Bitte die Schritte zuerst in eine andere Phase verschieben oder löschen.',
        true
      );
      return;
    }
    if (!(await bestaetigen('Phase ' + (i + 1) + ' löschen?', 'Phase löschen', true))) return;
    aendern(
      () => {
        zustand.map.phasen = zustand.map.phasen.filter((x) => x !== p);
      },
      { neuZeichnen: true, fokus: 'f-phase-neu' }
    );
    melden('Phase gelöscht.');
  }

  function schrittHinzufuegen(phaseId) {
    const neu = M.neuerSchritt(phaseId);
    aendern(() => zustand.map.schritte.push(neu), { neuZeichnen: true, fokus: 'f-schritt-' + neu.id + '-aktion' });
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

  async function schrittLoeschen(schritt, nr) {
    if (!(await bestaetigen('Schritt ' + nr + ' löschen? Alle Angaben dieses Schritts gehen verloren.', 'Schritt löschen', true))) return;
    const phaseIndex = zustand.map.phasen.findIndex((p) => p.id === schritt.phaseId);
    aendern(
      () => {
        zustand.map.schritte = zustand.map.schritte.filter((x) => x !== schritt);
      },
      { neuZeichnen: true, fokus: phaseIndex >= 0 ? schrittNeuId(phaseIndex, schritt.phaseId) : 'f-phase-neu' }
    );
    melden('Schritt ' + nr + ' gelöscht.');
  }

  function painPointHinzufuegen(schritt) {
    const pp = M.neuerPainPoint();
    aendern(() => schritt.painPoints.push(pp), { neuZeichnen: true, fokus: 'f-pp-' + pp.id + '-text' });
  }

  async function painPointEntfernen(schritt, pp) {
    if (pp.text.trim() && !(await bestaetigen('Pain Point „' + kuerzen(pp.text, 60) + '“ entfernen?', 'Entfernen', true))) return;
    aendern(
      () => {
        schritt.painPoints = schritt.painPoints.filter((x) => x !== pp);
      },
      { neuZeichnen: true, fokus: 'h-schritt-' + schritt.id }
    );
    melden('Pain Point entfernt.');
  }

  /* ================= Reiter 4: Map ================= */

  /**
   * Ausschnitt der Emotionskurve für eine Spalte. Jede Zelle zeichnet ihren Punkt und die halben
   * Verbindungen zu den Nachbarn, so ergibt sich über die Zeile eine durchgehende Linie.
   * Feste Höhe, die Breite folgt der Spalte; der Punkt ist ein eigenes Element, damit er rund bleibt.
   */
  function kurve(aktuell, vorher, nachher) {
    const y = (v) => 50 - v * 20; // Werte -2…2 → 90…10 (in Prozent der Höhe)
    const svg = s('svg', { viewBox: '0 0 100 100', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    svg.append(s('line', { class: 'kurve-null', x1: 0, y1: 50, x2: 100, y2: 50 }));
    const huelle = h('div', { class: 'kurve', 'aria-hidden': 'true' }, svg);
    if (aktuell === null) return huelle;
    const punkte = [];
    if (vorher !== null) punkte.push('0,' + (y(vorher) + y(aktuell)) / 2);
    punkte.push('50,' + y(aktuell));
    if (nachher !== null) punkte.push('100,' + (y(aktuell) + y(nachher)) / 2);
    if (punkte.length > 1) svg.append(s('polyline', { class: 'kurve-linie', points: punkte.join(' ') }));
    const punkt = h('span', { class: 'kurve-punkt emo-' + aktuell });
    punkt.style.top = y(aktuell) + '%';
    huelle.append(punkt);
    return huelle;
  }

  function mapDokument(m, modus) {
    const pr = P.pruefen(m);
    const st = m.version.status;
    const nr = new Map(M.geordneteSchritte(m).map((x, i) => [x.id, i + 1]));

    // Spalten: je Phase ihre Schritte, eine Platzhalterspalte für leere Phasen
    const gruppen = m.phasen.map((p, pi) => {
      const ss = m.schritte.filter((x) => x.phaseId === p.id);
      return { titel: phasenName(p), klasse: pi % 2 ? 'phase-b' : 'phase-a', schritte: ss.length ? ss : [null] };
    });
    const phasenIds = new Set(m.phasen.map((p) => p.id));
    const ohnePhase = m.schritte.filter((x) => !phasenIds.has(x.phaseId));
    if (ohnePhase.length) gruppen.push({ titel: 'Ohne Phase', klasse: 'phase-b', schritte: ohnePhase });
    const spalten = gruppen.flatMap((g) => g.schritte);

    const titelTag = modus === 'druck' ? 'h1' : 'h3';
    const stempel =
      st === 'freigegeben'
        ? h('p', { class: 'map-stempel freigegeben' }, 'FREIGEGEBEN · Version ' + m.version.nummer)
        : h('p', { class: 'map-stempel' }, M.STATUS[st].label.toUpperCase() + ' · Version ' + m.version.nummer + ' · nicht freigegeben');

    const eckdaten = [
      ['Anlass und Rahmen', m.rahmen.anlass],
      ['Nutzergruppe', m.rahmen.nutzergruppe],
      ['Startpunkt', m.rahmen.startpunkt],
      ['Endpunkt', m.rahmen.endpunkt],
      ['Versionsstand', 'Version ' + m.version.nummer + ' · ' + M.STATUS[st].label + ' · Stand ' + datumDe(m.version.stand)],
      m.version.freigabe ? ['Freigabe', 'durch ' + m.version.freigabe.durch + ' am ' + datumDe(m.version.freigabe.datum)] : null,
      m.rahmen.erfasstVon.trim() ? ['Erfasst von', m.rahmen.erfasstVon] : null,
      m.rahmen.fachbereich.trim() ? ['Prüfender Fachbereich', m.rahmen.fachbereich] : null,
    ].filter(Boolean);

    const textOderLeer = (t) => (String(t || '').trim() ? t : '—');
    const zeile = (label, zellen) => h('tr', {}, h('th', { scope: 'row' }, label), zellen);
    const zellen = (fn, leerText) =>
      spalten.map((x, i) => (x ? h('td', {}, fn(x, i)) : h('td', { class: 'leer' }, leerText || '')));

    const hatGedanken = m.schritte.some((x) => x.gedanken.trim());
    const hatZitate = m.schritte.some((x) => x.zitat.trim());
    const hatIntern = m.schritte.some((x) => x.intern.trim());

    const emotionZellen = spalten.map((x, i) => {
      const wert = (sp) => (sp && sp.emotion !== null ? sp.emotion : null);
      if (!x) return h('td', { class: 'emotion' }, kurve(null, null, null));
      const emo = M.EMOTIONEN.find((e) => e.wert === x.emotion);
      return h(
        'td',
        { class: 'emotion' },
        kurve(wert(x), wert(spalten[i - 1]), wert(spalten[i + 1])),
        h(
          'span',
          { class: 'emotion-label' },
          emo ? [h('span', { 'aria-hidden': 'true' }, emo.symbol + ' '), emo.label] : 'nicht erfasst'
        )
      );
    });

    const tabelle = h(
      'table',
      { class: spalten.length <= 8 ? 'jm jm-schmal' : 'jm' },
      h('caption', { class: 'visuell-versteckt' }, 'Journey Map: Schritte nach Phasen mit Aktion, Touchpoint, Emotion und Pain Points'),
      h('colgroup', {}, h('col', { class: 'spalte-label' })),
      gruppen.map((g) => h('colgroup', {}, g.schritte.map(() => h('col', { class: 'spalte-schritt' })))),
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, 'Phase'),
          gruppen.map((g) => h('th', { scope: 'colgroup', colspan: String(g.schritte.length), class: 'phase ' + g.klasse }, g.titel))
        ),
        h(
          'tr',
          {},
          h('th', { scope: 'row' }, 'Schritt'),
          spalten.map((x) => h('th', { scope: 'col', class: 'schritt-nr' }, x ? String(nr.get(x.id)) : '–'))
        )
      ),
      h(
        'tbody',
        {},
        zeile(
          'Aktion',
          zellen(
            (x) => [
              textOderLeer(x.aktion),
              x.quelleId && M.quellenKuerzel(m, x.quelleId)
                ? [' ', h('span', { class: 'quelle-ref' }, '[' + M.quellenKuerzel(m, x.quelleId) + ']')]
                : null,
            ],
            'Noch keine Schritte'
          )
        ),
        zeile('Touchpoint', zellen((x) => textOderLeer(x.touchpoint))),
        hatGedanken ? zeile('Gedanken', zellen((x) => textOderLeer(x.gedanken))) : null,
        zeile('Emotion', emotionZellen),
        zeile(
          'Pain Points',
          zellen((x) =>
            x.painPoints.length
              ? h(
                  'ul',
                  { class: 'pp-liste' },
                  x.painPoints.map((pp) =>
                    h(
                      'li',
                      {},
                      textOderLeer(pp.text),
                      ' ',
                      h('span', { class: 'quelle-ref' }, '[' + (M.quellenKuerzel(m, pp.quelleId) || 'ohne Beleg') + ']')
                    )
                  )
                )
              : '—'
          )
        ),
        hatZitate ? zeile('Zitate', zellen((x) => (x.zitat.trim() ? h('span', { class: 'zitat' }, x.zitat) : '—'))) : null,
        hatIntern
          ? h(
              'tr',
              { class: 'trenner' },
              h('th', { scope: 'row' }, 'Interner Ablauf', h('span', { class: 'zeilen-hinweis' }, 'für Kund*innen nicht sichtbar')),
              zellen((x) => textOderLeer(x.intern))
            )
          : null
      )
    );

    const quellen = m.quellen.length
      ? h(
          'section',
          { class: 'map-quellen' },
          h(modus === 'druck' ? 'h2' : 'h4', {}, 'Quellen'),
          h(
            'ol',
            {},
            m.quellen.map((q, i) => {
              const art = M.artInfo(q.art);
              return h(
                'li',
                {},
                h('strong', {}, 'Q' + (i + 1) + ' '),
                textOderLeer(q.bezeichnung),
                art ? ' · ' + art.label : '',
                q.stand.trim() ? ' · Stand ' + q.stand : ''
              );
            })
          )
        )
      : null;

    const offen = pr.zaehler.fehlt + pr.zaehler.rueckfrage;
    return h(
      'div',
      { class: 'map-dokument' },
      stempel,
      h(titelTag, { class: 'map-titel' }, m.rahmen.titel.trim() || 'Ohne Titel'),
      h(
        'dl',
        { class: 'map-eckdaten' },
        eckdaten.map(([k, v]) => h('div', {}, h('dt', {}, k), h('dd', {}, textOderLeer(v))))
      ),
      tabelle,
      h(
        'p',
        { class: 'map-legende' },
        'Emotion: ' + M.EMOTIONEN.map((e) => e.symbol + ' ' + e.label).join(' · ') + '. Pain Points mit Quellenangabe [Q…].'
      ),
      quellen,
      h(
        'p',
        { class: 'map-fuss' },
        'Journey-Map-Vorlage · ' +
          (m.rahmen.titel.trim() || 'Ohne Titel') +
          ' · Version ' +
          m.version.nummer +
          ' · ' +
          M.STATUS[st].label +
          ' · Stand ' +
          datumDe(m.version.stand) +
          (modus === 'druck' ? ' · gedruckt am ' + datumDe(M.heute()) : '') +
          (offen ? ' · ' + mehrzahl(offen, 'offener Prüfpunkt', 'offene Prüfpunkte') : '')
      )
    );
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
      h('div', { class: 'map-rahmen', role: 'region', 'aria-label': 'Journey Map (horizontal scrollbar)', tabindex: '0' }, mapDokument(zustand.map, 'ansicht'))
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
