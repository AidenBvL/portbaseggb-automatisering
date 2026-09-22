/*
 * Handmatige regelbank: NVWA-/praktijkregels die niet uit het douanetarief
 * (TARIC) af te leiden zijn, zoals het analyseverslag voor aquacultuur uit
 * India. De automatisch afgeleide TARIC-regels staan in data/rules.taric.js.
 *
 * LET OP: dit is een startset. EU/NVWA-eisen wijzigen regelmatig.
 * Controleer de regels tegen de actuele wetgeving en pas ze aan via het
 * tabblad "Regels" (of direct in dit bestand).
 *
 * Structuur van een regel:
 *   id            unieke sleutel
 *   naam          korte omschrijving
 *   type          'PRD' (CHED-P, dierlijk), 'LNV' (CHED-D, niet-dierlijk) of '*'
 *   gn            lijst met GN-code-prefixen, of '*'
 *   gnExclude     (optioneel) GN-prefixen die de regel uitsluiten
 *   animo         lijst met Animo-codes, of '*'
 *   animoExclude  (optioneel) Animo-codes die de regel uitsluiten
 *   landen        lijst met ISO-landcodes (land van oorsprong), of '*'
 *   landenExclude (optioneel)
 *   documenten    lijst met vereiste documenten:
 *                   type          documentcode (zie DOC_TYPES)
 *                   niveau        'verplicht' | 'aandacht'
 *                   alternatieven (optioneel) documentcodes die ook voldoen
 *                   verwijstNaar  (optioneel) documentcode waarnaar dit document moet verwijzen
 *                   opmerking     toelichting
 *   meldingen     (optioneel, i.p.v. of naast documenten) lijst {niveau, tekst}
 *                 niveau: 'info' | 'aandacht' | 'ontbreekt' | 'fout'
 *   bron          wettelijke basis / bron
 */
(function (root) {
  'use strict';

  var DOC_TYPES = {
    HC:      { code: 'HC',      naam: 'Gezondheidscertificaat',                    portbase: 'Health certificate' },
    LAB:     { code: 'LAB',     naam: 'Gecertificeerd laboratoriumrapport',        portbase: 'Certified lab report' },
    CATCH:   { code: 'CATCH',   naam: 'Vangstcertificaat (IUU)',                   portbase: 'Catch certificate' },
    OFFCERT: { code: 'OFFCERT', naam: 'Officieel certificaat (Ver. (EU) 2019/1793)', portbase: 'Official certificate' },
    PRIVATT: { code: 'PRIVATT', naam: 'Private attestation (samengesteld product)', portbase: 'Private attestation' },
    CITES:   { code: 'CITES',   naam: 'CITES-invoervergunning',                    portbase: 'CITES permit' },
    COI:     { code: 'COI',     naam: 'Controlecertificaat biologisch (COI)',       portbase: 'Certificate of inspection' },
    PHYTO:   { code: 'PHYTO',   naam: 'Fytosanitair certificaat',                  portbase: 'Phytosanitary certificate' },
    COMM:    { code: 'COMM',    naam: 'Handelsdocument',                           portbase: 'Commercial document' },
    OTHER:   { code: 'OTHER',   naam: 'Overig document',                           portbase: 'Other' }
  };

  var LANDEN = {
    AR: 'Argentinië', BD: 'Bangladesh', BR: 'Brazilië', CL: 'Chili', CN: 'China',
    EC: 'Ecuador', EG: 'Egypte', GM: 'Gambia', ID: 'Indonesië', IN: 'India',
    IR: 'Iran', LK: 'Sri Lanka', MA: 'Marokko', MY: 'Maleisië', NG: 'Nigeria',
    NO: 'Noorwegen', PE: 'Peru', PH: 'Filipijnen', SD: 'Soedan', SN: 'Senegal',
    TH: 'Thailand', TR: 'Turkije', US: 'Verenigde Staten', VN: 'Vietnam', ZA: 'Zuid-Afrika'
  };

  var VIS_GN = ['0301', '0302', '0303', '0304', '0305', '0306', '0307', '0308', '1604', '1605'];
  var SAMENGESTELD_GN = ['1602', '1901', '1902', '1904', '1905', '2104', '2105', '2106'];

  var DEFAULT_RULES = [
    {
      id: 'prd-basis-gezondheidscertificaat',
      naam: 'Producten van dierlijke oorsprong: officieel gezondheidscertificaat',
      type: 'PRD',
      gn: '*',
      gnExclude: SAMENGESTELD_GN,
      animo: '*',
      landen: '*',
      documenten: [
        {
          type: 'HC',
          niveau: 'verplicht',
          opmerking: 'Origineel officieel certificaat volgens het EU-model, afgegeven door de bevoegde autoriteit van het derde land.'
        }
      ],
      bron: 'Ver. (EU) 2017/625 art. 47; Uitv. Ver. (EU) 2020/2235 (certificaatmodellen)'
    },
    {
      id: 'vis-vangstcertificaat',
      naam: 'Visserijproducten (wildvangst): vangstcertificaat',
      type: 'PRD',
      gn: ['0302', '0303', '0304', '0305', '0306', '0307', '0308', '1604', '1605'],
      animo: '*',
      animoExclude: ['206107'],
      landen: '*',
      documenten: [
        {
          type: 'CATCH',
          niveau: 'aandacht',
          opmerking: 'Alleen vereist voor wildgevangen visserijproducten (IUU-verordening). Niet nodig bij aquacultuur.'
        }
      ],
      bron: 'Ver. (EG) 1005/2008 (IUU)'
    },
    {
      id: 'india-aquacultuur-labrapport',
      naam: 'Aquacultuurproducten uit India: analyseverslag residuen',
      type: 'PRD',
      gn: VIS_GN,
      animo: '*',
      landen: ['IN'],
      documenten: [
        {
          type: 'LAB',
          niveau: 'verplicht',
          verwijstNaar: 'HC',
          opmerking: 'Analyseverslag van een erkend laboratorium op residuen van farmacologisch werkzame stoffen (o.a. chlooramfenicol, nitrofuraan-metabolieten, tetracyclines). Het rapport moet verwijzen naar het bijbehorende gezondheidscertificaat.'
        }
      ],
      bron: 'NVWA verscherpte controle aquacultuurproducten India (Besluit 2010/381/EU en opvolgende EU-maatregelen) – controleer actuele status'
    },
    {
      id: 'bangladesh-schaaldieren-labrapport',
      naam: 'Schaaldieren uit Bangladesh: analyseverslag residuen',
      type: 'PRD',
      gn: ['0306', '1605'],
      animo: '*',
      landen: ['BD'],
      documenten: [
        {
          type: 'LAB',
          niveau: 'verplicht',
          verwijstNaar: 'HC',
          opmerking: 'Analyseverslag residuen farmacologisch werkzame stoffen; moet verwijzen naar het gezondheidscertificaat.'
        }
      ],
      bron: 'Beschikking 2008/630/EG (noodmaatregelen schaaldieren Bangladesh) – controleer actuele status'
    },
    {
      id: 'kaviaar-cites',
      naam: 'Kaviaar (steuren): CITES-invoervergunning',
      type: 'PRD',
      gn: ['160431'],
      animo: '*',
      landen: '*',
      documenten: [
        {
          type: 'CITES',
          niveau: 'verplicht',
          opmerking: 'Steurachtigen staan op CITES bijlage B; invoervergunning van RVO vereist naast het gezondheidscertificaat.'
        }
      ],
      bron: 'Ver. (EG) 338/97 (CITES)'
    },
    {
      id: 'samengestelde-producten',
      naam: 'Samengestelde producten: gezondheidscertificaat of private attestation',
      type: 'PRD',
      gn: SAMENGESTELD_GN,
      animo: '*',
      landen: '*',
      documenten: [
        {
          type: 'HC',
          niveau: 'verplicht',
          alternatieven: ['PRIVATT'],
          opmerking: 'Niet-houdbare samengestelde producten en producten met vlees: officieel gezondheidscertificaat. Houdbare producten zonder vlees: private attestation van de importeur.'
        }
      ],
      bron: 'Uitv. Ver. (EU) 2020/2235 art. 12-14; Gedelegeerde Ver. (EU) 2021/630'
    },
    {
      id: 'lnv-sesamzaad-india',
      naam: 'Sesamzaad uit India: officieel certificaat + analyseverslag',
      type: 'LNV',
      gn: ['120740'],
      animo: '*',
      landen: ['IN'],
      documenten: [
        { type: 'OFFCERT', niveau: 'verplicht', opmerking: 'Officieel certificaat volgens bijlage IV van Ver. (EU) 2019/1793.' },
        { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'OFFCERT', opmerking: 'Analyseverslag (Salmonella, bestrijdingsmiddelenresiduen incl. ethyleenoxide) behorend bij het officieel certificaat.' }
      ],
      bron: 'Uitv. Ver. (EU) 2019/1793 bijlage II – controleer actuele versie'
    },
    {
      id: 'lnv-guargom-india',
      naam: 'Guargom uit India: officieel certificaat + analyseverslag',
      type: 'LNV',
      gn: ['130232'],
      animo: '*',
      landen: ['IN'],
      documenten: [
        { type: 'OFFCERT', niveau: 'verplicht', opmerking: 'Officieel certificaat volgens bijlage IV van Ver. (EU) 2019/1793.' },
        { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'OFFCERT', opmerking: 'Analyseverslag pentachloorfenol en dioxinen.' }
      ],
      bron: 'Uitv. Ver. (EU) 2019/1793 bijlage II – controleer actuele versie'
    },
    {
      id: 'lnv-betelbladeren-india',
      naam: 'Betelbladeren uit India: officieel certificaat + analyseverslag',
      type: 'LNV',
      gn: ['140490'],
      animo: '*',
      landen: ['IN'],
      documenten: [
        { type: 'OFFCERT', niveau: 'verplicht', opmerking: 'Officieel certificaat volgens bijlage IV van Ver. (EU) 2019/1793.' },
        { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'OFFCERT', opmerking: 'Analyseverslag Salmonella.' }
      ],
      bron: 'Uitv. Ver. (EU) 2019/1793 bijlage II – controleer actuele versie'
    },
    {
      id: 'lnv-pistaches-iran',
      naam: 'Pistaches uit Iran: officieel certificaat + analyseverslag aflatoxinen',
      type: 'LNV',
      gn: ['080251', '080252', '200819'],
      animo: '*',
      landen: ['IR'],
      documenten: [
        { type: 'OFFCERT', niveau: 'verplicht', opmerking: 'Officieel certificaat volgens bijlage IV van Ver. (EU) 2019/1793.' },
        { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'OFFCERT', opmerking: 'Analyseverslag aflatoxinen.' }
      ],
      bron: 'Uitv. Ver. (EU) 2019/1793 bijlage II – controleer actuele versie'
    },
    {
      id: 'lnv-gedroogde-vijgen-turkije',
      naam: 'Gedroogde vijgen uit Turkije: officieel certificaat + analyseverslag aflatoxinen',
      type: 'LNV',
      gn: ['080420'],
      animo: '*',
      landen: ['TR'],
      documenten: [
        { type: 'OFFCERT', niveau: 'verplicht', opmerking: 'Officieel certificaat volgens bijlage IV van Ver. (EU) 2019/1793.' },
        { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'OFFCERT', opmerking: 'Analyseverslag aflatoxinen.' }
      ],
      bron: 'Uitv. Ver. (EU) 2019/1793 bijlage II – controleer actuele versie'
    },
    {
      id: 'lnv-grondnoten-soedan-gambia',
      naam: 'Grondnoten uit Soedan / Gambia: officieel certificaat + analyseverslag aflatoxinen',
      type: 'LNV',
      gn: ['120241', '120242', '200811', '150810'],
      animo: '*',
      landen: ['SD', 'GM'],
      documenten: [
        { type: 'OFFCERT', niveau: 'verplicht', opmerking: 'Officieel certificaat volgens bijlage IV van Ver. (EU) 2019/1793.' },
        { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'OFFCERT', opmerking: 'Analyseverslag aflatoxinen.' }
      ],
      bron: 'Uitv. Ver. (EU) 2019/1793 bijlage II – controleer actuele versie'
    }
  ];

  var exported = { DOC_TYPES: DOC_TYPES, LANDEN: LANDEN, DEFAULT_RULES: DEFAULT_RULES, VERSIE: '2026-09-22' };
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = exported;
  } else {
    root.GGB_RULES = exported;
  }
})(typeof window !== 'undefined' ? window : this);
