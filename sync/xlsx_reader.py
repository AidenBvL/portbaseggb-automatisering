"""Minimale XLSX-lezer (alleen standaardbibliotheek) voor de TARIC-extracties.

Leest rij voor rij (streaming) zodat ook het 68 MB grote maatregelenbestand
zonder veel geheugen verwerkt kan worden.
"""
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import date, timedelta

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
_COL = re.compile(r'([A-Z]+)')


def _col_index(ref):
    letters = _COL.match(ref).group(1)
    n = 0
    for ch in letters:
        n = n * 26 + ord(ch) - 64
    return n - 1


def sheet_names(path):
    with zipfile.ZipFile(path) as z:
        wb = z.read('xl/workbook.xml').decode('utf-8')
    return re.findall(r'<sheet [^>]*name="([^"]+)"', wb)


def rows(path, sheet=1):
    """Levert elke rij als lijst met strings (lege cellen = '')."""
    with zipfile.ZipFile(path) as z:
        shared = []
        if 'xl/sharedStrings.xml' in z.namelist():
            root = ET.parse(z.open('xl/sharedStrings.xml')).getroot()
            for si in root.iter(NS + 'si'):
                shared.append(''.join(t.text or '' for t in si.iter(NS + 't')))
        with z.open('xl/worksheets/sheet%d.xml' % sheet) as f:
            for _, el in ET.iterparse(f):
                if el.tag != NS + 'row':
                    continue
                out = []
                for c in el.findall(NS + 'c'):
                    i = _col_index(c.get('r'))
                    while len(out) < i:
                        out.append('')
                    v = c.find(NS + 'v')
                    t = c.get('t')
                    if v is None:
                        isel = c.find(NS + 'is')
                        val = ''.join(x.text or '' for x in isel.iter(NS + 't')) if isel is not None else ''
                    elif t == 's':
                        val = shared[int(v.text)]
                    else:
                        val = v.text or ''
                    out.append(val)
                yield out
                el.clear()


def all_rows(path):
    """Alle sheets achter elkaar (het maatregelenbestand is over 2 sheets verdeeld)."""
    for i in range(1, len(sheet_names(path)) + 1):
        for r in rows(path, i):
            yield r


_EXCEL_EPOCH = date(1899, 12, 30)


def to_iso_date(value):
    """'15-09-2026' of Excel-serienummer '46023' -> '2026-09-15'; leeg -> None."""
    value = (value or '').strip()
    if not value:
        return None
    m = re.match(r'^(\d{2})-(\d{2})-(\d{4})$', value)
    if m:
        return '%s-%s-%s' % (m.group(3), m.group(2), m.group(1))
    if re.match(r'^\d+(\.\d+)?$', value):
        return (_EXCEL_EPOCH + timedelta(days=int(float(value)))).isoformat()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', value)
    if m:
        return value[:10]
    return value
