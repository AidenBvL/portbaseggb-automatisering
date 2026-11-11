# GGB Documentcheck + AI invullen

Webtool die laat zien welke certificaten en documenten je bij een GGB-aanvraag
(Gemeenschappelijk Gezondheidsdocument van Binnenkomst, CHED-P / CHED-D) in
Portbase moet indienen, op basis van **GN-code**, **Animo-code** en **land van
oorsprong**. Bijvoorbeeld: garnalen (0306 17) uit India vereisen een
gezondheidscertificaat én een gecertificeerd laboratoriumrapport dat naar dat
certificaat verwijst.

## Gebruik

Er zijn twee manieren:

1. **Browserextensie (Edge / Chrome)** – toont de documentcheck direct op de
   Portbase-pagina *Declaration Food and Consumer Products*, zodra je een
   declaratie opent (bijv. `…/declarations/inbox(sidebar:view-declaration/…)`).
   De gegevens (declaratietype, land van oorsprong, ETA, documenten,
   goederenitems met GN- en Animo-code) worden rechtstreeks uit de pagina
   gelezen; niets wordt naar een server gestuurd.
   Het tabblad **AI invullen** maakt de GGB vanuit het gezondheidscertificaat
   en andere documenten (zie hieronder).
2. **Losse webapp** – open `index.html` in een browser (geen installatie of
   build nodig), of klik op het extensie-icoon.

### Extensie installeren in Edge

1. Download of clone deze repository.
2. Ga in Edge naar `edge://extensions`, zet **Ontwikkelaarsmodus** aan.
3. Kies **Uitgepakt laden** en selecteer de map van de repository (de map
   met `manifest.json`).
4. Open in Portbase een declaratie. Rechtsonder verschijnt het paneel
   *GGB Documentcheck* met per goederenitem de vereiste documenten, de
   status (compleet / ontbreekt / controleren) en, uitklapbaar, de
   TARIC-maatregelen. Het paneel ververst automatisch als je documenten
   toevoegt of een andere declaratie opent.
5. **Openen in tool** zet de uitgelezen declaratie in de volledige webapp
   (nieuw tabblad), bijv. om het certificaatnummer waarnaar het labrapport
   verwijst in te vullen. In Chrome werkt het op dezelfde manier via
   `chrome://extensions`.

Na een update van de kennisbank (`data/`) of de code: op de extensiepagina
op **Opnieuw laden** klikken.

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

## AI invullen: GGB maken vanuit het HC en andere documenten

In het paneel op de Portbase-pagina, tabblad **AI invullen**:

1. Sleep het **gezondheidscertificaat (HC)** en eventueel labrapport,
   vangstcertificaat, factuur, paklijst en B/L in het paneel (PDF, JPG, PNG,
   WEBP). Extra info die niet in de documenten staat (bijv. ETA) kun je in het
   tekstvak zetten.
2. **Uitlezen met AI** – Claude (Anthropic) leest de documenten en geeft per
   GGB-veld een voorstel met bron (bijv. "HC vak I.1") en zekerheid
   (hoog/middel/laag). De extensie normaliseert datums (dd-mm-jjjj),
   landcodes, GN-codes en gewichten, controleert containernummers
   (ISO 6346-controlecijfer) en meldt tegenstrijdigheden tussen documenten
   onder *Aandachtspunten*.
3. Op het voorstel draait direct de **documentcheck**: welke documenten zijn
   voor deze GN-code/land vereist (TARIC + NVWA-regels) en zitten ze bij de
   upload, inclusief de verwijzing van het labrapport naar het HC.
4. Pas waarden aan waar nodig en klik **Invullen in Portbase** (op "New
   declaration" of een bewerkbare declaratie). De extensie vult:
   declaratietype, B/L, bestemming, land van oorsprong/lading, I.18, I.16,
   vervoermiddel + naam + nationaliteit, ETA, containers + zegels,
   documentregels (type, nummer, datum, land, **en uploadt het bijbehorende
   bestand**) en goederenitems (omschrijving, gewichten, colli, verpakking,
   batch, erkenningsnummer). Ontbrekende documentregels/goederenitems worden
   aangemaakt met *Add document* / *Add goods item*.
5. Velden die in Portbase via een zoekdialoog gaan (**exporteur, importeur,
   grenscontrolepost, plaats van bestemming, inrichting van oorsprong,
   GN-code, activity/approval number**) worden niet automatisch gekozen. Ze
   staan als *handmatig* in het verslag met een knop **Zoek in Portbase**.
   In de organisatiedialoog (exporteur, importeur, plaats van bestemming,
   inrichting van oorsprong, erkenningsnummer) doet die knop:
   zoektype kiezen (*Organisation name* of *Approval number*), **land**
   invullen (exporteur/inrichting: land van oorsprong, importeur: NL),
   zoekterm invullen, **Search** klikken en – als er precies één exacte
   treffer is (naam op B.V./Pvt Ltd na, of erkenningsnummer) – die rij aanvinken. Gedeeltelijke of meerdere treffers worden
   gemarkeerd en dan kies je zelf. **Save** in de dialoog klik je altijd zelf.
   In de lijstdialoog **Border control post** wordt het land (NL) ingevuld
   als het leeg is en de regel met de juiste code aangevinkt (bijv.
   *Rotterdam – NLRTM1*). Bij de GN-code-dialoog wordt alleen de zoekterm
   ingevuld.

   De grenscontrolepost kiest de AI uit de vaste Portbase-lijst
   (`BCP_NL` in `js/ggb-ai.js`; bijwerken als Portbase de lijst wijzigt).
   Het **inspectiecentrum** vult de declarant zelf in; de extensie stelt het
   niet voor en raakt het veld niet aan.

Er wordt **nooit** op Opslaan of Verzenden geklikt: de declarant controleert
en verstuurt zelf.

### Instellen

Rechtsklik op het extensie-icoon → **Opties** (of `edge://extensions` →
Details → Extensieopties): vul een Anthropic API-sleutel in
(console.anthropic.com). Standaardmodel: Claude Opus 5.5, grondigheid *hoog*.
De sleutel blijft lokaal in de browser.

**Privacy:** bij *Uitlezen met AI* gaan de geselecteerde documenten naar de
API van Anthropic. Zonder die knop wordt niets verstuurd. Controleer of dat
past binnen de afspraken van je organisatie.

### Beperkingen

- De velden worden gevonden via de `data-test`/`formcontrolname` van de
  echte Portbase-pagina *New declaration* en anders via de labeltekst.
  Verborgen secties (Transit, Transhipment, Means of transport after border)
  hergebruiken sommige `data-test`-namen; de invuller kijkt daarom alleen in
  de juiste sectie. De test draait op een ingekorte kopie van de echte DOM
  (`test/fixtures/portbase-new-declaration.html`), waarin keuzelijsten,
  autocomplete en dialogen worden nagebootst. De teksten van de keuzelijsten
  (bijv. Means of transport, Package type) en de landen-suggesties zijn niet
  bekend; de invuller kiest de best passende optie en meldt het als dat niet
  lukt. Als Portbase verandert, meldt het verslag welke velden *niet
  gevonden* zijn.
- Portbase accepteert alleen **PDF** als bijlage; foto's worden wel
  uitgelezen maar niet geüpload.
- De **Animo-code** staat niet op het HC en wordt niet ingevuld.
- AI kan zich vergissen: controleer altijd de velden met zekerheid
  *middel*/*laag* en de aandachtspunten.

### Bundel opnieuw bouwen

De API-aanroep staat in `ai/src/extract.mjs` (Anthropic SDK) en is gebundeld
in `extension/ai.bundle.js` (staat in de repository, dus niet nodig om de
extensie te gebruiken). Na een wijziging:

```
cd ai && npm install && npm run build
```

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
node test/ai.test.js                     # normalisatie + documentcheck op AI-voorstel
node test/ai-extract.test.mjs            # API-aanroep met nagebootste API (na npm install in ai/)
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node test/e2e-extensie.mjs   # extensie in Chromium (Playwright)
```

## Structuur

```
manifest.json                 browserextensie (Manifest V3, Edge/Chrome)
extension/content.js          paneel op de Portbase-pagina
extension/portbase-dom.js     leest de declaratie uit de Portbase-DOM
extension/background.js       service worker: levert kennisbank, opent de tool, roept Claude aan
extension/portbase-fill.js    vult het formulier "New declaration" met het AI-voorstel
extension/options.html/.js    instellingen (API-sleutel, model)
extension/ai.bundle.js        gebundelde Anthropic SDK + extract (gebouwd uit ai/)
ai/src/extract.mjs            uitlezen van documenten met Claude (structured output)
js/ggb-ai.js                  schema, prompt, normalisatie, koppeling met documentcheck
index.html                    GUI
css/style.css
js/rules.default.js           handmatige regelbank + documenttypen
js/engine.js                  regel-engine (browser + Node)
js/parser.js                  parser voor geplakte Portbase-tekst
js/render.js                  gedeelde weergave (webapp + extensie)
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
test/ai.test.js, test/ai-extract.test.mjs, test/e2e-extensie.mjs   tests voor AI invullen
test/fixtures/                gereduceerde Portbase-DOM (view-declaration en nagebootst new-declaration)
```
