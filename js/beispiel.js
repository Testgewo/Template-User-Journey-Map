/*
 * Frei erfundenes Beispiel zur Orientierung (Ausfüllhilfe).
 * Alle Inhalte sind fiktiv. Keine echten Kund*innen, Gespräche oder Kennzahlen.
 */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./model.js'));
  } else {
    root.JMBeispiel = factory(root.JMModell);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Modell) {
  'use strict';

  /** Ein ausgefüllter Schritt als Ausfüllhilfe. */
  const BEISPIEL_SCHRITT = {
    phase: 'Mit dem Voicebot sprechen',
    aktion: 'Nennt das Anliegen in eigenen Worten',
    touchpoint: 'Voicebot: Anliegenerkennung',
    emotion: -1,
    gedanken: 'Versteht der mich überhaupt?',
    painPoint: 'Anliegen wird oft erst im zweiten Versuch erkannt',
    quelle: 'Q3: Auswertung der Gesprächsverläufe (aggregiert)',
    zitat: '„Ich musste es dreimal sagen.“',
  };

  function beispielMap() {
    const m = {
      schema: Modell.SCHEMA,
      schemaVersion: Modell.SCHEMA_VERSION,
      rahmen: {
        titel: 'Beispiel (fiktiv): Schaden telefonisch melden über den Voicebot',
        anlass:
          'IST-Aufnahme im Projekt: Wie kommen Kund*innen heute mit dem Voicebot in Kontakt, und wo hakt es? ' +
          'Betrachtet wird nur die telefonische Schadensmeldung, nicht die Bearbeitung des Schadens.',
        nutzergruppe: 'Mieter*innen, die einen Schaden in der Wohnung telefonisch melden',
        startpunkt: 'Kund*in bemerkt einen Schaden und sucht, wo man ihn meldet',
        endpunkt: 'Kund*in hat eine Bestätigung der Schadensmeldung erhalten',
        erfasstVon: 'UX-Team',
        fachbereich: 'Kundenservice',
      },
      version: {
        nummer: '0.2',
        status: 'in_ueberarbeitung',
        stand: '2026-11-12',
        freigabe: null,
        letzterExport: { version: '0.1', status: 'in_pruefung', datum: '2026-11-03' },
      },
      phasen: [
        { id: 'ph-erkennen', name: 'Anliegen erkennen' },
        { id: 'ph-kontakt', name: 'Kontakt aufnehmen' },
        { id: 'ph-voicebot', name: 'Mit dem Voicebot sprechen' },
        { id: 'ph-abschluss', name: 'Weiterleitung und Abschluss' },
      ],
      quellen: [
        {
          id: 'q-interviews',
          bezeichnung: 'Kurzinterviews mit Mieter*innen (anonymisierte Notizen)',
          art: 'interview',
          stand: '09/2026',
          anonymisiert: true,
        },
        {
          id: 'q-workshop',
          bezeichnung: 'Workshop mit dem Kundenservice (Protokoll)',
          art: 'workshop',
          stand: '10/2026',
          anonymisiert: true,
        },
        {
          id: 'q-auswertung',
          bezeichnung: 'Auswertung der Gesprächsverläufe (aggregiert, keine Einzelgespräche)',
          art: 'auswertung',
          stand: '10/2026',
          anonymisiert: true,
        },
      ],
      schritte: [
        {
          id: 's-suchen',
          phaseId: 'ph-erkennen',
          aktion: 'Sucht, wo man einen Schaden meldet',
          touchpoint: 'Website, Aushang im Hausflur',
          emotion: 0,
          gedanken: 'Wen rufe ich da eigentlich an?',
          zitat: '',
          painPoints: [
            {
              id: 'pp-nummer',
              text: 'Die Telefonnummer für Schadensmeldungen ist auf der Website schwer zu finden',
              quelleId: 'q-interviews',
            },
          ],
        },
        {
          id: 's-anrufen',
          phaseId: 'ph-kontakt',
          aktion: 'Ruft die Service-Hotline an',
          touchpoint: 'Telefon: Service-Hotline',
          emotion: 0,
          gedanken: 'Hoffentlich muss ich nicht lange warten.',
          zitat: '',
          painPoints: [],
        },
        {
          id: 's-begruessung',
          phaseId: 'ph-kontakt',
          aktion: 'Hört die Begrüßung und den Hinweis auf den Sprachassistenten',
          touchpoint: 'Voicebot: Begrüßung',
          emotion: -1,
          gedanken: 'Ist das ein Anrufbeantworter?',
          zitat: '„Ich dachte erst, ich bin falsch verbunden.“',
          painPoints: [
            {
              id: 'pp-auflegen',
              text: 'Ein Teil der Anrufenden erwartet eine Person und legt während der Ansage auf',
              quelleId: 'q-auswertung',
            },
          ],
        },
        {
          id: 's-anliegen',
          phaseId: 'ph-voicebot',
          aktion: BEISPIEL_SCHRITT.aktion,
          touchpoint: BEISPIEL_SCHRITT.touchpoint,
          emotion: BEISPIEL_SCHRITT.emotion,
          gedanken: BEISPIEL_SCHRITT.gedanken,
          zitat: BEISPIEL_SCHRITT.zitat,
          painPoints: [{ id: 'pp-erkennung', text: BEISPIEL_SCHRITT.painPoint, quelleId: 'q-auswertung' }],
        },
        {
          id: 's-rueckfragen',
          phaseId: 'ph-voicebot',
          aktion: 'Beantwortet Rückfragen zu Ort und Art des Schadens',
          touchpoint: 'Voicebot: Rückfragen',
          emotion: 0,
          gedanken: 'Das habe ich doch schon gesagt.',
          zitat: '',
          painPoints: [
            {
              id: 'pp-doppelt',
              text: 'Rückfragen wirken doppelt, weil Angaben schon genannt wurden',
              quelleId: 'q-workshop',
            },
          ],
        },
        {
          id: 's-weiterleitung',
          phaseId: 'ph-abschluss',
          aktion: 'Wird nach zwei Fehlversuchen oder auf Wunsch an das Service-Team weitergeleitet',
          touchpoint: 'Telefon: Service-Team',
          emotion: -2,
          gedanken: 'Jetzt erzähle ich alles noch einmal?',
          zitat: '',
          painPoints: [
            {
              id: 'pp-uebergabe',
              text: 'Angaben aus dem Voicebot-Gespräch kommen beim Service-Team nicht an. Kund*in muss alles wiederholen',
              quelleId: 'q-workshop',
            },
          ],
        },
        {
          id: 's-bestaetigung',
          phaseId: 'ph-abschluss',
          aktion: 'Erhält eine Bestätigung der Schadensmeldung',
          touchpoint: 'SMS oder E-Mail',
          emotion: 1,
          gedanken: 'Gut, es ist angekommen.',
          zitat: '',
          painPoints: [],
        },
      ],
      rueckmeldungen: [
        {
          id: 'rm-weiterleitung',
          bezug: 'schritt:s-weiterleitung',
          von: 'Fachbereich Kundenservice',
          kanal: 'Termin',
          datum: '2026-11-05',
          text: 'Die Weiterleitung passiert nicht nur auf Wunsch, sondern auch automatisch nach zwei Fehlversuchen.',
          status: 'uebernommen',
          antwort: 'In der Aktion von Schritt 6 ergänzt.',
        },
        {
          id: 'rm-servicezeiten',
          bezug: 'allgemein',
          von: 'Fachbereich Kundenservice',
          kanal: 'E-Mail',
          datum: '2026-11-06',
          text: 'Bitte den Fall ergänzen, dass jemand außerhalb der Servicezeiten anruft.',
          status: 'offen',
          antwort: '',
        },
      ],
      historie: [
        { datum: '2026-10-27', version: '0.1', ereignis: 'angelegt', notiz: '', durch: '' },
        {
          datum: '2026-11-03',
          version: '0.1',
          ereignis: 'zur_pruefung',
          notiz: 'Entwurf an den Kundenservice geschickt',
          durch: '',
        },
        { datum: '2026-11-03', version: '0.1', ereignis: 'export', notiz: 'PDF-Export im Status „In fachlicher Prüfung“', durch: '' },
        {
          datum: '2026-11-10',
          version: '0.2',
          ereignis: 'ueberarbeitung',
          notiz: 'Zwei Rückmeldungen aus Termin und E-Mail',
          durch: '',
        },
      ],
    };
    return m;
  }

  return { beispielMap, BEISPIEL_SCHRITT };
});
