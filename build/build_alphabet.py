#!/usr/bin/env python3
"""
Build alphabet.html with data from my_alphabet.csv
"""

import csv
import os
import sys

def main():
    if len(sys.argv) != 3:
        print("Usage: build_alphabet.py <template_file> <output_file>")
        sys.exit(1)
    
    template_file = sys.argv[1]
    output_file = sys.argv[2]
    project_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alphabet_file = os.path.join(project_dir, 'my_alphabet.csv')
    
    # Read alphabet data
    rows = []
    with open(alphabet_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f, delimiter=';')
        header = next(reader)  # skip header
        for row in reader:
            if len(row) >= 7:
                cyrillic = row[1]
                avarme = row[2]
                scientific = row[4]
                typing = row[6]
                historical = row[7] if len(row) > 7 else ''
                umarilov = row[9] if len(row) > 9 else ''
                turk = row[10] if len(row) > 10 else ''
                said = row[11] if len(row) > 11 else ''
                google = row[12] if len(row) > 12 else ''
                frequency = row[13] if len(row) > 13 else ''
                freq_wiki = row[14] if len(row) > 14 else ''
                
                if cyrillic:
                    rows.append({
                        'cyrillic': cyrillic,
                        'avarme': avarme,
                        'scientific': scientific,
                        'typing': typing,
                        'historical': historical,
                        'umarilov': umarilov,
                        'turk': turk,
                        'said': said,
                        'google': google,
                        'frequency': frequency,
                        'freq_wiki': freq_wiki
                    })
    
    # Sort by Avar Cyrillic alphabet order
    avar_alphabet_order = [
        'а', 'б', 'в', 'г', 'гъ', 'гь', 'гӀ', 'д', 'е', 'ж', 'з', 'и', 'й',
        'к', 'кӀ', 'къ', 'кь', 'л', 'лъ', 'лӀ', 'м', 'н', 'о', 'п', 'р', 'с',
        'т', 'тӀ', 'у', 'ф', 'х', 'хъ', 'хь', 'хӀ', 'ц', 'цӀ', 'ч', 'чӀ',
        'ш', 'щ', 'ъ', 'э', 'ю', 'я', 'ё'
    ]
    order_map = {letter: idx for idx, letter in enumerate(avar_alphabet_order)}
    rows.sort(key=lambda r: order_map.get(r['cyrillic'], 999))
    
    # Generate table rows HTML
    table_html = '\n'.join([
        f'                        <tr><td>{r["cyrillic"]}</td><td>{r["avarme"]}</td><td>{r["scientific"]}</td><td>{r["typing"]}</td><td>{r["historical"]}</td><td>{r["umarilov"]}</td><td>{r["turk"]}</td><td>{r["said"]}</td><td>{r["google"]}</td><td class="freq">{r["frequency"]}</td><td class="freq">{r["freq_wiki"]}</td></tr>'
        for r in rows
    ])
    
    # Read template and replace placeholder
    with open(template_file, 'r', encoding='utf-8') as f:
        template = f.read()
    
    output = template.replace(
        '<!-- Will be populated by build script -->',
        table_html
    )
    
    # Write output
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(output)
    
    print(f"Built alphabet page with {len(rows)} letters")

if __name__ == "__main__":
    main()
