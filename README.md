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

In het paneel op de Portbase-pagina, tabblad **AI invullen** (drie stappen:
*Documenten → Controleren → Invullen*, bovenaan zichtbaar):

1. Sleep het **gezondheidscertificaat (HC)** en eventueel labrapport,
   vangstcertificaat, factuur, paklijst en B/L in het paneel (PDF, JPG, PNG,
   WEBP). Extra info die niet in de documenten staat (bijv. ETA) kun je in het
   tekstvak zetten.
2. **Uitlezen met AI** – de gekozen AI (Claude, ChatGPT of Gemini; of
   handmatig via een chat, zie hieronder) leest de documenten en geeft per
   GGB-veld een voorstel met bron (bijv. "HC vak I.1") en zekerheid
   (hoog/middel/laag). De extensie normaliseert datums (dd-mm-jjjj),
   landcodes, GN-codes en gewichten, controleert containernummers
   (ISO 6346-controlecijfer) en meldt tegenstrijdigheden tussen documenten
   onder *Aandachtspunten*.
3. **Welke documenten in de GGB komen** bepaalt de extensie (alleen wat
   *verplicht* is; *ter beoordeling*, zoals een vangstcertificaat, vink je
   zelf aan als de NVWA het wil zien) met dezelfde
   regels als de documentcheck (TARIC + NVWA) op basis van GN-code en land
   van oorsprong: meestal alleen het **gezondheidscertificaat**, soms ook
   een labrapport of officieel certificaat. Factuur, paklijst en B/L worden
   wel uitgelezen (bron voor B/L-nummer, containers, gewichten), maar niet
   als document opgenomen. Per document zie je de reden ("Vereist (Ver.
   2019/1793) volgens de regels" / "Niet gevraagd…") en kun je het vinkje
   *Opnemen in GGB* aanpassen. Het **Portbase-documenttype** wordt exact
   gekozen, ook de variant per verordening, bijv. *Health certificate
   (636)*, *Certified lab report (162)*, of bij Ver. 2019/1793 *Official
   certificate 2019/1793 (100)* + *Certified lab report 2019/1793 (4)*;
   corrigeren kan met de keuzelijst (volledige Portbase-lijst).
   Het **HC-nummer** is altijd de **IMSOC-referentie** (TRACES, vak I.2.a,
   bijv. `IMPORT.EU.IN.2026.0012345`), niet de *certificate reference*
   (vak I.2). Die laatste staat apart in het voorstel en telt mee als
   verwijzing van een labrapport naar het HC. Ontbreekt de IMSOC-referentie,
   dan meldt het paneel dat onder *Aandachtspunten*.
4. Op het voorstel draait direct de **documentcheck**: welke documenten zijn
   voor deze GN-code/land vereist (TARIC + NVWA-regels) en zitten ze bij de
   upload, inclusief de verwijzing van het labrapport naar het HC.
   Het voorstel begint met een **samenvatting** (type, oorsprong, grenspost,
   B/L, HC-nummer, goederen, containers, ETA) en een balk met de
   **zekerheid** van de velden. Velden met zekerheid middel/laag zijn
   gekleurd; **Alleen te controleren** verbergt de rest. De blokken
   (Algemeen, Organisaties, Containers, Documenten, Goederenitems) zijn in te
   klappen. Onder elk datumveld staat hoe de datum in Portbase komt.
   **Exporteren** downloadt het voorstel als JSON; **Nieuw** maakt het paneel
   leeg. Het laatste voorstel wordt lokaal bewaard en kan na herladen van de
   pagina met **Herstellen** worden teruggezet (documenten opnieuw toevoegen
   als ze geüpload moeten worden).
5. Pas waarden aan waar nodig en klik **Invullen in Portbase** (onderaan het
   paneel, altijd zichtbaar) (op "New
   declaration" of een bewerkbare declaratie). De extensie vult:
   declaratietype, B/L, bestemming, land van oorsprong/lading, I.18, I.16,
   vervoermiddel + naam + nationaliteit, ETA, containers + zegels,
   (keuzelijsten met de echte Portbase-opties, bijv. *Sea transport*,
   *Human consumption*, *Frozen*, *Carton (CT)*; na elke keuze controleert de
   extensie of Portbase die heeft overgenomen, met als terugval kiezen met
   de pijltjestoetsen + Enter),
   **cargo handler** (altijd *Cory Brothers B.V.*), **EU standard** en per
   goederenitem **Consumer package indicator** (altijd *Yes*),
   documentregels voor de documenten die in de GGB horen (type, nummer,
   datum, land, **en uploadt het bijbehorende bestand**) en goederenitems (gewichten, colli, verpakking,
   batch, erkenningsnummer). Ontbrekende documentregels/goederenitems worden
   aangemaakt met *Add document* / *Add goods item*. **Datums** worden in de
   notatie van het formulier ingevuld: standaard **MM/DD/YYYY** (bijv.
   `11/29/2026`), in te stellen bij *Opties → Invullen in Portbase*.
   Tijdens het invullen zie je een voortgangsbalk met de huidige stap (en
   hoe lang er al op Portbase gewacht wordt) en kun je op **Stop** klikken.
   Het verslag is te filteren op *ingevuld*, *handmatig*, enz.
6. **Zoekvensters worden automatisch afgehandeld** (uit te zetten met het
   vinkje onder *Invullen in Portbase*): exporteur, importeur, plaats van
   bestemming, inrichting van oorsprong (documenten en goederenitems),
   grenscontrolepost, GN-code en de bijbehorende **Animo-code**. Per venster:
   land invullen, zoeken, de juiste regel kiezen en **Save in het venster**.
   De extensie werkt in het tempo van Portbase: na *Search* wacht ze tot de
   resultaten van de API er staan en niet meer veranderen (een tussentijds
   "No results" telt niet), en pas als Portbase de gekozen regel echt als
   gekozen toont, klikt ze op *Save*. Daarna controleert ze dat het veld de
   keuze toont; zo niet, dan staat het veld als *handmatig* in het verslag.
   - *Organisaties*: dezelfde naam komt vaak meerdere keren voor (bijv. 5×
     "Quang Phu Seafood…" met een andere activiteit en een ander adres). De
     extensie scoort elke regel op naam (exact, op B.V./Ltd na) of
     erkenningsnummer, en daarnaast op rol (*EX – exporter*, *import*,
     *PP/ES* voor de inrichting), adres, plaats en sector (vis →
     *fishing*). De inrichting van oorsprong wordt gezocht op het
     erkenningsnummer uit HC vak I.11 (*Place of dispatch*, bijv. DL 1022).
   - *Goederenomschrijving* vult de extensie niet in: Portbase doet dat zelf
     na het kiezen van de GN-code.
   - *GN-code*: zoeken op de **code zoals op het HC** (HS-code, bijv.
     *160232*) **plus de wetenschappelijke naam** van het HC (bijv. *Gallus
     gallus*), zoals de declarant; geen resultaat of geen passende regel:
     de volledige GN-code, dan 6, dan 4 cijfers, daarna zonder naam; kiezen
     op GN-code en soort, en bij meerdere producttypes op kenmerken uit het HC
     en de Animo-code (bijv. *Wild stock* of Animo 102108 → *Wilde dieren*,
     *Farmed* of 206107 → *Gefokte dieren*; *preparation* → *Vleesbereiding*), en
     bij meerdere producttypes op de aard van het product en de omschrijving
     van de Animo-code (bijv. *wild gevangen* vs *aquacultuur*).
   - *Animo-code*: de AI kiest die **altijd** uit de Portbase-lijst, met een
     keuzehulp in de prompt (productgroep, MC/diervoeder/technisch, vers of
     bereid, aquacultuur of wild gevangen, gekoeld/bevroren of ambient; bijv.
     kip vleesbereiding 201105, kweekgarnalen 206107, wild gevangen inktvis
     102108); in het venster wordt de code opgezocht en gekozen.
   - **Wachten op Portbase**: na *Search* wacht de extensie tot het
     zoekverzoek van Portbase terug is en de resultaten (of *No results*)
     niet meer veranderen; geen vaste korte time-out meer, alleen de
     ingestelde maximale wachttijd (standaard 2 minuten). Portbase toont
     tijdens het zoeken vaak al *No results*; daarom kijkt
     `extension/page-net.js` of er nog een verzoek van de pagina loopt
     (alleen tijdstippen, geen adressen of inhoud).
   - **Trefwoorden na "No results"**: organisaties op de naam zonder
     rechtsvorm (B.V., Co., Ltd) en leestekens, de eerste woorden, losse
     kenmerkende woorden, het erkenningsnummer zonder letters en de plaats;
     GN-code op het geslacht uit de Latijnse naam en woorden uit de
     omschrijving; Animo op woorden uit de omschrijving van de code.
     Resultaten die niet op de naam/het nummer lijken tellen niet als treffer.
   - Alleen een **duidelijke winnaar** wordt gekozen en opgeslagen. Anders
     klikt de extensie *Cancel* en staat het veld als *handmatig* in het
     verslag, met **Zoek in Portbase** (opent het venster met de zoekterm en
     markeert de kandidaten).
   - *Destination* wordt *Import* als de documenten niets anders zeggen.

De declaratie zelf wordt **nooit** opgeslagen of verzonden (*Save*/*Send*
onderaan het formulier): de declarant controleert en verstuurt zelf. Alleen
in de zoekvensters klikt de extensie op *Save* om de gekozen regel over te
nemen.

### Instellen: AI-aanbieder kiezen

Rechtsklik op het extensie-icoon → **Opties** (of `edge://extensions` →
Details → Extensieopties). De instellingenpagina heeft vijf onderdelen:

- **AI-aanbieder** – kies **Claude** (Anthropic), **ChatGPT** (OpenAI),
  **Gemini** (Google) of **Handmatig**. Per aanbieder bewaar je een eigen
  API-sleutel en model, zodat je kunt wisselen zonder opnieuw in te vullen.
  **Modellen ophalen** test de sleutel en haalt de modellen op die bij die
  sleutel horen (de lijst komt live van de aanbieder; er staan geen
  verouderde modelnamen in de extensie). Standaard: Claude
  `claude-opus-5-5`, Gemini `gemini-pro-latest`; bij ChatGPT kies je na
  het ophalen (het nieuwste chatmodel wordt voorgesteld). Bij Claude stel je
  ook de grondigheid in. Wijzigingen worden direct opgeslagen.
- **Invullen in Portbase** – datumnotatie van het formulier (MM/DD/YYYY of
  DD-MM-YYYY), maximale wachttijd op een zoekresultaat, en of er na
  *No results* op trefwoorden verder gezocht wordt.
- **Handmatige prompt** – de prompt bekijken, kopiëren of downloaden.
- **Privacy & gegevens** – wat er waarheen gaat; alle sleutels wissen.
- **Over** – versie en wat de extensie wel/niet automatisch doet.

Sleutels blijven lokaal in de browser en gaan alleen naar de bijbehorende
aanbieder. Instellingen van een eerdere versie (alleen Claude) worden
automatisch overgenomen.

### Handmatig via een chat (zonder API-sleutel)

In het paneel, tabblad **AI invullen → Handmatig (chat)**:

1. Selecteer de documenten (voor de bestandsnamen en het latere uploaden in
   Portbase) en vul eventueel extra info in.
2. **Kopieer prompt** – de prompt bevat de instructies, je bestandsnamen,
   je extra info en het JSON-schema.
3. Plak de prompt in ChatGPT, Gemini of Claude en voeg **dezelfde
   documenten** toe.
4. Plak het antwoord in *Plak het JSON-antwoord* en klik **Verwerken**.
   Tekst of een ```json-blok rond het antwoord is geen probleem; ook kale
   waarden (zonder bron/zekerheid) worden geaccepteerd.

Daarna werkt alles hetzelfde: documentcheck, voorstel aanpassen,
**Invullen in Portbase** en de zoekdialogen.

**Privacy:** bij *Uitlezen* gaan de geselecteerde documenten naar de API
van de gekozen aanbieder. In de handmatige modus verstuurt de extensie
niets. Controleer of dit past binnen de afspraken van je organisatie.

### Van HC naar Portbase

De AI gebruikt een vaste vertaling van de vakken van het HC (TRACES-model)
naar de GGB: I.1 → exporteur, I.5 → importeur (niet I.6 *operator
responsible*), I.11 → inrichting van oorsprong (met approval number),
I.12 → plaats van bestemming (met approval number, kan in een ander
EU-land liggen), I.15 → vervoermiddel (naam + vlag), I.16 → grenscontrolepost,
I.2.a → nummer van het HC (IMSOC-referentie), I.18 → transportconditie, I.19 → containers, I.20 → *certified as or for*,
I.22 → *Import*, I.27 → goederenitems.

**Goederenitems zijn identiek aan het HC**: elke regel van I.27 (#1, #2, …)
wordt één goederenitem, in dezelfde volgorde, ook als GN-code en soort
gelijk zijn. Het HC geeft per regel alleen het nettogewicht; het totale
brutogewicht (I.26) wordt daarom naar rato van het nettogewicht over de
regels verdeeld (1 decimaal, de som klopt exact). Per goederenitem worden
ook de container (*Equipment number*) en het erkenningsnummer gekozen; de
*Consumer package indicator* blijft op de standaardwaarde van Portbase.

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
- De **Animo-code** kiest de AI uit de Portbase-lijst (`ANIMO_CODES` in
  `js/ggb-ai.js`); controleer die in het voorstel. Of de Animo-dialoog in
  Portbase vanzelf opent na de GN-code of via een knop, is niet bekend; de
  extensie probeert beide.
- Het **inspectiecentrum** vult de declarant zelf in.
- AI kan zich vergissen: controleer altijd de velden met zekerheid
  *middel*/*laag* en de aandachtspunten.

### Bundel opnieuw bouwen

De API-aanroepen staan in `ai/src/` (`extract.mjs`: Claude via de Anthropic
SDK; `aanbieders.mjs`: ChatGPT en Gemini via hun REST-API, plus het ophalen
van modellen) en zijn gebundeld
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
node test/ai-extract.test.mjs            # Claude-aanroep met nagebootste API (na npm install in ai/)
node test/ai-aanbieders.test.mjs         # ChatGPT, Gemini, modellenlijst (na npm install in ai/)
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 node test/e2e-extensie.mjs   # extensie in Chromium (Playwright)
```

## Structuur

```
manifest.json                 browserextensie (Manifest V3, Edge/Chrome)
extension/content.js          paneel op de Portbase-pagina
extension/portbase-dom.js     leest de declaratie uit de Portbase-DOM
extension/background.js       service worker: levert kennisbank, opent de tool, roept Claude aan
extension/portbase-fill.js    vult het formulier "New declaration" met het AI-voorstel
extension/page-net.js         (in de pagina) houdt bij of Portbase nog een verzoek open heeft
extension/options.html/.css/.js  instellingen (aanbieder, sleutels, modellen, prompt, privacy)
extension/ai.bundle.js        gebundelde Anthropic SDK + extract (gebouwd uit ai/)
ai/src/extract.mjs            uitlezen van documenten met Claude (structured output)
ai/src/aanbieders.mjs         ChatGPT en Gemini, verdeler per aanbieder, modellen ophalen
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
