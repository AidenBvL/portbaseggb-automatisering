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

## Regelbank

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
`PRIVATT` private attestation, `CITES`, `COMM`, `OTHER`.

**De regelbank is een startset.** EU- en NVWA-eisen wijzigen regelmatig;
controleer de regels tegen de actuele wetgeving en pas ze aan.

## Tests

```
node test/engine.test.js
```

## Structuur

```
index.html            GUI
css/style.css
js/rules.default.js   standaard regelbank + documenttypen + landen
js/engine.js          regel-engine (browser + Node)
js/parser.js          parser voor geplakte Portbase-tekst
js/app.js             GUI-logica
test/engine.test.js   tests voor engine en parser
```
