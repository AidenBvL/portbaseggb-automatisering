"""Zet de EU TARIC-maandextractie om naar de kennisbank van de GGB Documentcheck.

Invoer : de CIRCABC-zip (of een uitgepakte map) met o.a.
         'Taric measures <datum>.xlsx', 'Measure exclusions.xlsx',
         'Geographical areas composition/description.xlsx',
         'Box 44 codes of the SAD.xlsx', 'Nomenclature EN.xlsx'.
Uitvoer: data/taric-controls.js   controlemaatregelen per goederencode (+ .json)
         data/rules.taric.js      automatisch afgeleide GGB-regels
         data/landen.js           landnamen (NL) uit TARIC
         data/nomenclatuur.js     goederenomschrijvingen (EN) voor de gebruikte codes
         data/taric-meta.json     bron, extractiedatum, aantallen

Gebruik: python3 sync/build_taric.py --zip build/eu-taric.zip [--uit data]
"""
import argparse
import collections
import glob
import json
import os
import re
import sys
import tempfile
import zipfile
from datetime import date

sys.path.insert(0, os.path.dirname(__file__))
from xlsx_reader import all_rows, rows, to_iso_date  # noqa: E402

# Hoofdstukken die voor GGB-aanvragen relevant zijn (levensmiddelen, diervoeder,
# dierlijke (bij)producten).
HOOFDSTUKKEN = {'%02d' % i for i in range(1, 25)} | {'30', '35', '41', '42', '43', '51'}

# Niet-tarifaire maatregeltypen die documenten of verboden bij invoer meebrengen.
CONTROLE_TYPEN = {
    '277', '410', '415', '465', '475', '705', '707', '710', '712', '713', '714',
    '719', '722', '730', '731', '732', '745', '746', '750', '760', '762', '763',
}

COND_RE = re.compile(
    r'^\s*([A-Z])\s*(?:cert:\s*([A-Z])-(\d{3}))?\s*([\d.,]+\s*[A-Z/]*)?\s*\((\d{2})\)\s*:?\s*(.*?)\s*$'
)


def vind(dir_, patroon):
    kandidaten = glob.glob(os.path.join(dir_, patroon))
    if not kandidaten:
        raise SystemExit('Bestand niet gevonden in extractie: ' + patroon)
    return sorted(kandidaten)[-1]


def parse_voorwaarden(tekst):
    tekst = (tekst or '').strip()
    if not tekst.startswith('Cond:'):
        return [], tekst
    out = []
    for deel in tekst[5:].split(';'):
        deel = deel.strip()
        if not deel:
            continue
        m = COND_RE.match(deel)
        if not m:
            out.append({'raw': deel})
            continue
        v = {'cond': m.group(1), 'actie': m.group(5)}
        if m.group(2):
            v['cert'] = m.group(2) + m.group(3)
        if m.group(4):
            v['bedrag'] = m.group(4).strip()
        if m.group(6):
            v['recht'] = m.group(6)
        out.append(v)
    return out, ''


def laad_extractie(dir_):
    vandaag = date.today().isoformat()
    print('Landen en landengroepen lezen...')
    landen = {}
    groep_naam = {}
    for r in rows(vind(dir_, 'Geographical areas description.xlsx')):
        if len(r) < 4 or r[1] != 'NL' or (len(r) > 6 and r[6]):
            continue
        if re.match(r'^[A-Z]{2}$', r[0]):
            landen[r[0]] = r[3]
        else:
            groep_naam[r[0]] = r[3]
    groepen = collections.defaultdict(set)
    for r in rows(vind(dir_, 'Geographical areas composition.xlsx')):
        if len(r) < 11 or r[2] != 'EN' or r[9] or r[10]:
            continue
        groepen[r[0]].add(r[5])

    print('Documentcodes (vak 44) lezen...')
    box44 = collections.defaultdict(dict)
    for r in rows(vind(dir_, 'Box 44 codes of the SAD.xlsx')):
        if len(r) >= 3 and r[1] in ('NL', 'EN') and not (len(r) > 5 and r[5]):
            box44[r[0]][r[1].lower()] = r[2]

    print('Uitsluitingen lezen...')
    uitsluitingen = collections.defaultdict(set)
    for r in rows(vind(dir_, 'Measure exclusions.xlsx')):
        if len(r) < 11 or r[0] == 'Goods code':
            continue
        uitsluitingen[(r[0].strip(), r[8].strip(), r[9].strip())].add(r[10].strip())

    print('Maatregelen lezen (dit duurt even)...')
    maatregeltypen = {}
    profielen = {}
    profiel_lijst = []
    goederen = collections.defaultdict(list)
    alle_codes = set()
    extractie_datum = None
    mf = vind(dir_, 'Taric measures*.xlsx')
    m = re.search(r'(\d{2})(\d{2})(\d{4})', os.path.basename(mf))
    if m:
        extractie_datum = '%s-%s-%s' % (m.group(3), m.group(2), m.group(1))
    n = 0
    for r in all_rows(mf):
        n += 1
        if len(r) < 12 or r[0] == 'Goods code':
            continue
        code = r[0].strip()
        if code[:2] not in HOOFDSTUKKEN:
            continue
        alle_codes.add(code)
        typ = r[11].strip()
        if typ not in CONTROLE_TYPEN:
            continue
        einde = to_iso_date(r[4])
        if einde and einde < vandaag:
            continue
        start = to_iso_date(r[3])
        oorsprong = r[10].strip()
        maatregeltypen[typ] = r[7].strip()
        voorwaarden, recht = parse_voorwaarden(r[9])
        # Uitsluitingen staan op het niveau waar de maatregel is gedefinieerd
        # (bijv. 0306170000), de maatregelrijen op de declarabele 10-cijferige code.
        uitg = set()
        for lengte in range(2, 11):
            uitg |= uitsluitingen.get((code[:lengte].ljust(10, '0'), oorsprong, typ), set())
        uitg = sorted(uitg)
        sleutel = json.dumps([typ, oorsprong, r[8].strip(), start, einde, voorwaarden, recht, uitg], sort_keys=True)
        idx = profielen.get(sleutel)
        if idx is None:
            idx = len(profiel_lijst)
            profielen[sleutel] = idx
            profiel_lijst.append({
                'type': typ,
                'typeNaam': r[7].strip(),
                'oorsprong': oorsprong,
                'oorsprongNaam': landen.get(oorsprong) or groep_naam.get(oorsprong) or r[6].strip(),
                'basis': r[8].strip(),
                'start': start,
                'einde': einde,
                'voorwaarden': voorwaarden,
                'recht': recht,
                'uitgesloten': uitg,
            })
        if idx not in goederen[code]:
            goederen[code].append(idx)
    print('  %d rijen gelezen, %d profielen, %d goederencodes met controlemaatregelen' % (n, len(profiel_lijst), len(goederen)))

    # 10-cijferige codes samenvouwen naar 8 cijfers als alle onderverdelingen gelijk zijn.
    per8 = collections.defaultdict(dict)
    for code in alle_codes:
        per8[code[:8]][code] = tuple(sorted(goederen.get(code, [])))
    compact = {}
    for c8, kinderen in per8.items():
        waarden = set(kinderen.values())
        if len(waarden) == 1:
            w = waarden.pop()
            if w:
                compact[c8] = list(w)
        else:
            for c10, w in kinderen.items():
                if w:
                    compact[c10] = list(w)

    print('Nomenclatuur (EN) lezen...')
    nomenclatuur = {}
    for r in rows(vind(dir_, 'Nomenclature EN.xlsx')):
        if len(r) < 7 or r[0] == 'Goods code' or r[2]:
            continue
        code = r[0].split(' ')[0]
        if code[:2] in HOOFDSTUKKEN:
            nomenclatuur[code] = r[6].strip()

    gebruikte_codes = set()
    for p in profiel_lijst:
        for v in p['voorwaarden']:
            if v.get('cert'):
                gebruikte_codes.add(v['cert'])
    gebruikte_groepen = {p['oorsprong'] for p in profiel_lijst if p['oorsprong'] in groepen}

    return {
        'bron': 'EU TARIC maandextractie (DG TAXUD, CIRCABC)',
        'extractieDatum': extractie_datum,
        'gegenereerd': vandaag,
        'maatregeltypen': maatregeltypen,
        'documentcodes': {c: box44.get(c, {}) for c in sorted(gebruikte_codes)},
        'landengroepen': {g: {'naam': groep_naam.get(g, g), 'leden': sorted(groepen[g])} for g in sorted(gebruikte_groepen)},
        'profielen': profiel_lijst,
        'goederen': dict(sorted(compact.items())),
    }, landen, nomenclatuur


# ---------------------------------------------------------------------------
# Regels afleiden
# ---------------------------------------------------------------------------

def certs(profiel):
    return sorted({v['cert'] for v in profiel['voorwaarden'] if v.get('cert')})


def y_codes(profiel):
    return [c for c in certs(profiel) if c.startswith('Y')]


def regel_sjabloon(p, kb):
    """Vertaalt één TARIC-profiel naar documenten/meldingen voor de GGB-check."""
    typ = p['type']
    cert_set = set(certs(p))
    docs = p['typeNaam'] + ' (TARIC ' + typ + ', ' + p['basis'] + ')'
    vrijst = ', '.join(y_codes(p))
    vrijst_tekst = (' Vrijstellingscodes: ' + vrijst + '.') if vrijst else ''

    if typ == '410':
        if not ({'N853', 'C640', 'C085'} & cert_set):
            return None
        wat = 'GGB-P (CHED-P, N853)' if 'N853' in cert_set else 'GGB-A (CHED-A, C640)'
        return {
            'type': 'PRD',
            'documenten': [{
                'type': 'HC', 'niveau': 'verplicht',
                'opmerking': 'Veterinaire controle: bij invoer is een ' + wat + ' vereist. Het GGB wordt in Portbase opgesteld op basis van het officiële gezondheidscertificaat van het derde land.' + vrijst_tekst
            }],
        }
    if typ == '719':
        return {
            'type': '*',
            'documenten': [{
                'type': 'CATCH', 'niveau': 'aandacht',
                'opmerking': 'IUU-controle (Ver. (EG) 1005/2008): vangstcertificaat (C673) voor wildgevangen visserijproducten. Niet vereist bij aquacultuur of producten buiten de verordening (Y927).'
            }],
        }
    if typ == '750':
        return {
            'type': '*',
            'documenten': [{
                'type': 'COI', 'niveau': 'aandacht',
                'opmerking': 'Alleen bij biologische producten: controlecertificaat (COI, C644) via TRACES. Niet-biologisch: code Y929.'
            }],
        }
    if typ == '710':
        return {
            'type': '*',
            'documenten': [{
                'type': 'CITES', 'niveau': 'aandacht',
                'opmerking': 'Alleen als de soort onder CITES valt: invoervergunning (C400). Anders code Y900.'
            }],
        }
    if typ == '415':
        return {
            'type': 'LNV',
            'documenten': [{
                'type': 'PHYTO', 'niveau': 'verplicht',
                'opmerking': 'Officiële controle planten: fytosanitair certificaat en GGB-PP (CHED-PP, C085) vereist.' + vrijst_tekst
            }],
        }
    if 'C678' in cert_set:
        return {
            'type': 'LNV',
            'documenten': [
                {'type': 'OFFCERT', 'niveau': 'aandacht',
                 'opmerking': 'Product/land valt onder Uitv. Ver. (EU) 2019/1793 (GGB-D, C678 vereist). Bijlage I: alleen GGB-D en verhoogde controlefrequentie. Bijlage II: daarnaast officieel certificaat (bijlage IV) én analyseverslag. Controleer in welke bijlage de combinatie staat.'},
                {'type': 'LAB', 'niveau': 'aandacht', 'verwijstNaar': 'OFFCERT',
                 'opmerking': 'Alleen bij bijlage II van Ver. (EU) 2019/1793: analyseverslag van een geaccrediteerd laboratorium dat verwijst naar het officieel certificaat.'},
            ],
        }
    if typ == '277':
        return {'type': '*', 'meldingen': [{'niveau': 'fout', 'tekst': 'Invoerverbod volgens TARIC (' + docs + ').' + vrijst_tekst}]}
    if typ in ('760', '762', '763'):
        return {'type': '*', 'meldingen': [{'niveau': 'aandacht', 'tekst': 'Importcontrole/sanctiemaatregel volgens TARIC (' + docs + '). Documentcodes: ' + ', '.join(certs(p)) + '.'}]}
    return {'type': '*', 'meldingen': [{'niveau': 'info', 'tekst': docs + '. Documentcodes: ' + (', '.join(certs(p)) or 'geen') + '.'}]}


def bouw_regels(kb):
    groepen = kb['landengroepen']
    per_regel = collections.OrderedDict()
    for code, idxs in kb['goederen'].items():
        for i in idxs:
            p = kb['profielen'][i]
            sj = regel_sjabloon(p, kb)
            if not sj:
                continue
            sleutel = json.dumps([p['type'], p['oorsprong'], p['basis'], sj, p['uitgesloten']], sort_keys=True)
            if sleutel not in per_regel:
                if p['oorsprong'] in groepen:
                    landen = '*' if p['oorsprong'] in ('1008', '1011') else groepen[p['oorsprong']]['leden']
                else:
                    landen = [p['oorsprong']]
                per_regel[sleutel] = {
                    'id': 'taric-%s-%s-%s' % (p['type'], p['oorsprong'], re.sub(r'[^0-9A-Za-z]+', '', p['basis'])),
                    'naam': '%s – %s (%s)' % (p['typeNaam'], p['oorsprongNaam'], p['basis']),
                    'type': sj['type'],
                    'gn': [],
                    'animo': '*',
                    'landen': landen,
                    'landenExclude': p['uitgesloten'],
                    'documenten': sj.get('documenten', []),
                    'meldingen': sj.get('meldingen', []),
                    'bron': 'TARIC %s %s; extractie %s' % (p['type'], p['basis'], kb['extractieDatum'] or kb['gegenereerd']),
                    'bronType': 'taric',
                    'geldigVanaf': p['start'],
                    'geldigTot': p['einde'],
                }
            r = per_regel[sleutel]
            if code not in r['gn']:
                r['gn'].append(code)
    regels = list(per_regel.values())
    # Unieke ids afdwingen
    gezien = collections.Counter()
    for r in regels:
        gezien[r['id']] += 1
        if gezien[r['id']] > 1:
            r['id'] += '-%d' % gezien[r['id']]
        r['gn'] = sorted(r['gn'])
    return regels


def schrijf_js(pad, naam, obj):
    with open(pad, 'w', encoding='utf-8') as f:
        f.write('/* Automatisch gegenereerd door sync/build_taric.py – niet handmatig bewerken. */\n')
        f.write('window.%s = ' % naam)
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--zip', help='CIRCABC-zip met de maandextractie')
    ap.add_argument('--dir', help='reeds uitgepakte map')
    ap.add_argument('--uit', default='data')
    a = ap.parse_args()
    if not a.zip and not a.dir:
        ap.error('geef --zip of --dir op')

    tmp = None
    dir_ = a.dir
    if a.zip:
        tmp = tempfile.mkdtemp(prefix='taric-')
        print('Uitpakken', a.zip, '->', tmp)
        with zipfile.ZipFile(a.zip) as z:
            z.extractall(tmp)
        dir_ = tmp

    kb, landen, nomenclatuur = laad_extractie(dir_)
    regels = bouw_regels(kb)
    gebruikte_codes = set(kb['goederen'])
    nomen = {c: d for c, d in nomenclatuur.items() if c in gebruikte_codes or c[:8] in gebruikte_codes or any(g.startswith(c) for g in gebruikte_codes)}

    os.makedirs(a.uit, exist_ok=True)
    schrijf_js(os.path.join(a.uit, 'taric-controls.js'), 'GGB_TARIC', kb)
    with open(os.path.join(a.uit, 'taric-controls.json'), 'w', encoding='utf-8') as f:
        json.dump(kb, f, ensure_ascii=False, indent=1)
    schrijf_js(os.path.join(a.uit, 'rules.taric.js'), 'GGB_RULES_TARIC', regels)
    with open(os.path.join(a.uit, 'rules.taric.json'), 'w', encoding='utf-8') as f:
        json.dump(regels, f, ensure_ascii=False, indent=1)
    schrijf_js(os.path.join(a.uit, 'landen.js'), 'GGB_LANDEN', landen)
    schrijf_js(os.path.join(a.uit, 'nomenclatuur.js'), 'GGB_NOMENCLATUUR', nomen)
    # JSON-varianten voor de browserextensie (die laadt data via fetch).
    with open(os.path.join(a.uit, 'landen.json'), 'w', encoding='utf-8') as f:
        json.dump(landen, f, ensure_ascii=False, separators=(',', ':'))
    with open(os.path.join(a.uit, 'nomenclatuur.json'), 'w', encoding='utf-8') as f:
        json.dump(nomen, f, ensure_ascii=False, separators=(',', ':'))
    meta = {
        'bron': kb['bron'], 'extractieDatum': kb['extractieDatum'], 'gegenereerd': kb['gegenereerd'],
        'aantalProfielen': len(kb['profielen']), 'aantalGoederencodes': len(kb['goederen']),
        'aantalRegels': len(regels), 'aantalLanden': len(landen), 'aantalNomenclatuur': len(nomen),
    }
    with open(os.path.join(a.uit, 'taric-meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(json.dumps(meta, ensure_ascii=False, indent=1))
    if tmp:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
