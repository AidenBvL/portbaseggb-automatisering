"""Download de maandelijkse EU TARIC-extractie.

Bronnen (in volgorde):
  1. Een lokaal opgegeven zip (bijv. zelf gedownload van CIRCABC, de officiële
     bron van DG TAXUD: https://circabc.europa.eu/ui/group/0e5f18c2-4b2f-42e9-aed4-dfe50ae1263b/library/64db9d0f-e7c9-4084-afe9-f47e70e53c10).
  2. De publieke GitHub-mirror rousseauxy/taric-opendata, die dezelfde
     CIRCABC-bestanden maandelijks als release-asset publiceert
     (eu-JJJJ-MM / eu-taric-JJJJ-MM.zip). Geen account nodig.

Gebruik:  python3 sync/fetch_taric.py [--maand 2026-09] [--uit pad.zip]
"""
import argparse
import os
import sys
import urllib.request
from datetime import date

MIRROR = 'https://github.com/rousseauxy/taric-opendata/releases/download/eu-{m}/eu-taric-{m}.zip'


def maand_kandidaten(maand=None):
    if maand:
        return [maand]
    d = date.today()
    out = []
    for i in range(3):
        y, m = d.year, d.month - i
        while m < 1:
            m += 12
            y -= 1
        out.append('%04d-%02d' % (y, m))
    return out


def download(url, dest):
    req = urllib.request.Request(url, headers={'User-Agent': 'ggb-documentcheck-sync'})
    with urllib.request.urlopen(req, timeout=120) as r, open(dest, 'wb') as f:
        total = 0
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    return total


def fetch(maand=None, uit='build/eu-taric.zip'):
    os.makedirs(os.path.dirname(uit) or '.', exist_ok=True)
    fouten = []
    for m in maand_kandidaten(maand):
        url = MIRROR.format(m=m)
        try:
            print('Downloaden', url)
            size = download(url, uit)
            if size < 10 << 20:
                raise IOError('bestand verdacht klein (%d bytes)' % size)
            print('OK: %s (%.1f MB) -> %s' % (m, size / 1e6, uit))
            with open(uit + '.bron.txt', 'w') as f:
                f.write(url + '\n')
            return uit, m
        except Exception as e:  # noqa: BLE001
            fouten.append('%s: %s' % (url, e))
    raise SystemExit('Geen TARIC-extractie kunnen downloaden:\n  ' + '\n  '.join(fouten))


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--maand', help='JJJJ-MM (standaard: huidige maand, met terugval op de 2 vorige)')
    p.add_argument('--uit', default='build/eu-taric.zip')
    a = p.parse_args()
    fetch(a.maand, a.uit)
