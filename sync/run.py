"""Volledige synchronisatie: TARIC downloaden en de kennisbank in data/ bouwen.

Gebruik: python3 sync/run.py [--maand JJJJ-MM] [--zip eigen-download.zip]
"""
import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from fetch_taric import fetch  # noqa: E402

if __name__ == '__main__':
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--maand')
    ap.add_argument('--zip', help='sla het downloaden over en gebruik deze (CIRCABC-)zip')
    ap.add_argument('--uit', default=os.path.join(os.path.dirname(HERE), 'data'))
    a = ap.parse_args()
    zip_pad = a.zip
    if not zip_pad:
        zip_pad, _ = fetch(a.maand, os.path.join(os.path.dirname(HERE), 'build', 'eu-taric.zip'))
    subprocess.check_call([sys.executable, os.path.join(HERE, 'build_taric.py'), '--zip', zip_pad, '--uit', a.uit])
