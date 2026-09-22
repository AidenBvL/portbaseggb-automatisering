# GGB Documentcheck

Webtool die laat zien welke certificaten en documenten je bij een GGB-aanvraag
(Gemeenschappelijk Gezondheidsdocument van Binnenkomst, CHED-P / CHED-D) in
Portbase moet indienen, op basis van **GN-code**, **Animo-code** en **land van
oorsprong**. Bijvoorbeeld: garnalen (0306 17) uit India vereisen een
gezondheidscertificaat én een gecertificeerd laboratoriumrapport dat naar dat
certificaat verwijst.

## Gebruik

Open `index.html` in een browser. Er is geen installatie of build nodig.

Drie tabbladen:

1. **Opzoeken** – vul type, GN-code, Animo-code en land in en zie direct welke
   documenten vereist zijn. Onderaan kun je meerdere combinaties tegelijk
   opzoeken (één per regel: `type;GN;Animo;land`).
2. **Declaraties controleren** – maak declaraties aan of plak de tekst van het
   Portbase-declaratieoverzicht (Ctrl+A, Ctrl+C op de pagina, dan plakken).
   De tool haalt land van oorsprong, ETA, documenten en goederenitems eruit.
   Klik op **Controleer deze declaratie** of **Controleer alles** om per item te
   zien welke documenten aanwezig zijn, ontbreken of aandacht vragen
   (bijv. een labrapport dat naar het gezondheidscertificaat moet verwijzen,
   of een afgiftedatum na de ETA). Meerdere geplakte declaraties scheid je met
   een regel `---`. Declaraties worden in de browser (localStorage) bewaard.
3. **Regels** – de kennisbank. Bekijk, bewerk (JSON), exporteer, importeer of
   herstel de standaardregels.

## Kennisbank: automatisch uit het douanetarief + handmatige NVWA-laag

De kennisbank bestaat uit twee lagen:

| Laag | Bron | Bijwerken |
|------|------|-----------|
| **Automatisch (TARIC)** – `data/rules.taric.js`, `data/taric-controls.js` | EU-douanetarief (TARIC), maandextractie van DG TAXUD. Bevat per goederencode en land van oorsprong de controlemaatregelen: veterinaire controle (GGB-P, code N853), IUU-vangstcertificaat (C673), Ver. (EU) 2019/1793 (GGB-D, C678, per land/product), CITES, biologische producten (COI), fytosanitaire controle, invoerverboden en sanctiemaatregelen, inclusief uitgezonderde landen. | `python3 sync/run.py` of de maandelijkse GitHub-workflow `sync-kennisbank.yml` |
| **Handmatig (NVWA/praktijk)** – `js/rules.default.js` | Eisen die niet in het douanetarief staan, zoals het analyseverslag voor aquacultuurproducten uit India en de verwijzing daarvan naar het gezondheidscertificaat. | In de GUI (tabblad Regels) of in het bestand |

Beide lagen worden bij het controleren gecombineerd; de GUI toont per document
of de eis uit TARIC of uit de handmatige regels komt. Het tabblad *Opzoeken*
toont daarnaast de ruwe TARIC-maatregelen met de documentcodes (vak 44) en
hun Nederlandse omschrijving.

### Synchronisatie draaien

```
python3 sync/run.py                 # nieuwste maandextractie downloaden en data/ regenereren
python3 sync/run.py --maand 2026-08 # specifieke maand
python3 sync/run.py --zip pad.zip   # zelf gedownloade CIRCABC-zip gebruiken
```

Alleen Python 3 (standaardbibliotheek) is nodig. De download komt van de
publieke GitHub-mirror `rousseauxy/taric-opendata` (release `eu-JJJJ-MM`),
die de officiële CIRCABC-bestanden van DG TAXUD ongewijzigd doorzet. Wil je
rechtstreeks van de bron werken, download de maandmap dan van
[CIRCABC](https://circabc.europa.eu/ui/group/0e5f18c2-4b2f-42e9-aed4-dfe50ae1263b/library/64db9d0f-e7c9-4084-afe9-f47e70e53c10)
en geef de zip mee met `--zip`.

De GitHub-workflow draait op de 3e van elke maand (en handmatig via
*Run workflow*), bouwt de kennisbank opnieuw, draait de tests en commit de
gewijzigde bestanden in `data/`.

### Wat (nog) niet automatisch kan

- **NVWA-specifieke eisen** (landspecifieke analyseverslagen, verwijzing van
  het labrapport naar het certificaat, bijzondere voorwaarden) staan alleen
  in proza/PDF op nvwa.nl. Die blijven in de handmatige laag.
- **Bijlage I vs. bijlage II van Ver. 2019/1793**: TARIC codeert beide als
  "GGB-D vereist". De automatische regel zet het officieel certificaat en
  het analyseverslag daarom op *ter beoordeling*; de handmatige regels
  zetten bekende bijlage II-combinaties op *verplicht*.
- **IVO / TRACES**: alleen na inloggen, geen publieke API. Portbase koppelt
  hier zelf mee.

## Handmatige regelbank

De standaardregels staan in `js/rules.default.js`. Elke regel koppelt een
combinatie van declaratietype, GN-code-prefixen, Animo-codes en landen aan een
lijst vereiste documenten:

```js
{
  id: 'india-aquacultuur-labrapport',
  naam: 'Aquacultuurproducten uit India: analyseverslag residuen',
  type: 'PRD',                 // 'PRD' (CHED-P), 'LNV' (CHED-D) of '*'
  gn: ['0306', '0307'],        // GN-prefixen of '*'
  animo: '*',                  // Animo-codes of '*'  (ook animoExclude / gnExclude / landenExclude)
  landen: ['IN'],              // ISO-landcodes of '*'
  documenten: [
    { type: 'LAB', niveau: 'verplicht', verwijstNaar: 'HC', opmerking: '…' }
  ],
  bron: '…'
}
```

Documentcodes: `HC` gezondheidscertificaat, `LAB` gecertificeerd labrapport,
`CATCH` vangstcertificaat, `OFFCERT` officieel certificaat (Ver. 2019/1793),
`PRIVATT` private attestation, `CITES`, `COI` controlecertificaat biologisch,
`PHYTO` fytosanitair certificaat, `COMM`, `OTHER`. Een regel mag naast of in
plaats van `documenten` ook `meldingen` bevatten (`{niveau, tekst}`), bijv.
voor een invoerverbod.

**De regelbank is een startset.** EU- en NVWA-eisen wijzigen regelmatig;
controleer de regels tegen de actuele wetgeving en pas ze aan.

## Tests

```
node test/engine.test.js
```

## Structuur

```
index.html                    GUI
css/style.css
js/rules.default.js           handmatige regelbank + documenttypen
js/engine.js                  regel-engine (browser + Node)
js/parser.js                  parser voor geplakte Portbase-tekst
js/app.js                     GUI-logica
data/rules.taric.js(.json)    automatisch afgeleide regels uit TARIC
data/taric-controls.js(.json) controlemaatregelen per goederencode (ruwe kennisbank)
data/landen.js                landnamen (NL) uit TARIC
data/nomenclatuur.js          goederenomschrijvingen (EN) uit TARIC
data/taric-meta.json          bron, extractiedatum, aantallen
sync/run.py                   volledige synchronisatie (download + bouwen)
sync/fetch_taric.py           download van de maandextractie
sync/build_taric.py           conversie TARIC -> kennisbank en regels
sync/xlsx_reader.py           minimale xlsx-lezer (geen dependencies)
.github/workflows/sync-kennisbank.yml  maandelijkse automatische update
test/engine.test.js           tests voor engine, parser en TARIC-regels
```
