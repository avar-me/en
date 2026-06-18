#!/usr/bin/env python3
"""
Build dictionary JSON from remote JSONL source with transliteration to Latin script.
"""

import json
import os
import sys
import csv
import urllib.request
from pathlib import Path

DATA_URL = "https://sources.avar.me/data/en-av.jsonl"

PALOCHKAS = [
    chr(0x406), chr(0x456),
    chr(0x4cf), chr(0x4c0), chr(0x4c1),
    "1", "i", "I", "|", "!"
]
P_INTERNAL = "I"

def normalize_palochka(text):
    for p in PALOCHKAS:
        text = text.replace(p, P_INTERNAL)
    return text

def load_mapping(project_dir):
    mapping = {}
    mapping_file = os.path.join(project_dir, 'my_alphabet.csv')

    if not os.path.exists(mapping_file):
        print(f"Error: {mapping_file} not found.", file=sys.stderr)
        sys.exit(1)

    with open(mapping_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        next(reader)
        for row in reader:
            if len(row) >= 3:
                cyr = row[1]
                lat = row[2]
                if not cyr:
                    continue
                norm_cyr = normalize_palochka(cyr.lower())
                mapping[norm_cyr] = lat
    return mapping

def transliterate(word, mapping, sorted_keys):
    norm_word = normalize_palochka(word.lower())

    result = []
    fully_transliterated = True
    i = 0

    while i < len(norm_word):
        match_found = False
        for key in sorted_keys:
            if norm_word.startswith(key, i):
                result.append(mapping[key])
                i += len(key)
                match_found = True
                break

        if not match_found:
            char = norm_word[i]
            if char == P_INTERNAL or 'Ѐ' <= char <= 'ӿ':
                fully_transliterated = False
            result.append(char)
            i += 1

    return "".join(result), fully_transliterated

def main():
    if len(sys.argv) != 2:
        print("Usage: build_dictionary.py <output_file>")
        sys.exit(1)

    output_file = sys.argv[1]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    mapping = load_mapping(project_dir)
    sorted_keys = sorted(mapping.keys(), key=len, reverse=True)

    print(f"Fetching data from {DATA_URL}...")
    req = urllib.request.Request(DATA_URL, headers={"User-Agent": "en.avar.me-builder/1.0"})
    with urllib.request.urlopen(req) as resp:
        content = resp.read().decode('utf-8')

    dictionary = []
    skipped = []

    for lineno, line in enumerate(content.splitlines(), 1):
        line = line.strip()
        if not line:
            continue

        try:
            entry = json.loads(line)
            word = entry.get('word', '')
            pos = entry.get('pos', '')
            avar_cyr = entry.get('avar', '')

            avar_lat, ok = transliterate(avar_cyr, mapping, sorted_keys)

            if not ok:
                skipped.append({"line": lineno, "entry": entry, "avar_transliterated": avar_lat})
                continue

            dictionary.append({'en': word, 'pos': pos, 'av': avar_lat, 'av_cyr': avar_cyr})
        except json.JSONDecodeError:
            print(f"Warning: Could not parse line {lineno}", file=sys.stderr)

    dictionary.sort(key=lambda x: x['en'].lower())

    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(dictionary, f, ensure_ascii=False, separators=(',', ':'))

    skipped_path = output_file + ".skipped.jsonl"
    with open(skipped_path, 'w', encoding='utf-8') as f:
        for item in skipped:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")

    print(f"Built dictionary with {len(dictionary)} entries")
    if skipped:
        print(f"Skipped {len(skipped)} entries (not fully transliterated)")

if __name__ == "__main__":
    main()
