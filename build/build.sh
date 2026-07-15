#!/usr/bin/env bash
# Build static site for en.avar.me (En↔Av dictionary).
#
# Usage:  bash build/build.sh [output_dir]
# Local:  python3 -m http.server -d dist 8000
#
# Sources: en-av.jsonl and av-en.jsonl from sources.avar.me (not kept in git).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${1:-$ROOT/dist}"
TEMPLATES_DIR="$ROOT/templates"
ASSETS_DIR="$ROOT/assets"

JSONL_EN_AV_URL="${JSONL_EN_AV_URL:-https://sources.avar.me/data/en-av.jsonl}"
JSONL_AV_EN_URL="${JSONL_AV_EN_URL:-https://sources.avar.me/data/av-en.jsonl}"
JSONL_EN_AV="$ROOT/en-av.jsonl"
JSONL_AV_EN="$ROOT/av-en.jsonl"

echo "=== 1. Fetch dictionary sources ==="
curl -fsSL "$JSONL_EN_AV_URL" -o "$JSONL_EN_AV"
wc -l "$JSONL_EN_AV"
curl -fsSL "$JSONL_AV_EN_URL" -o "$JSONL_AV_EN"
wc -l "$JSONL_AV_EN"

echo ""
echo "=== 2. Prepare output and copy templates ==="
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

cp "$TEMPLATES_DIR/styles.css" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/pages.css" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/about.html" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/robots.txt" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/sitemap.xml" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/app.js" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/index.html" "$OUTPUT_DIR/"

cp "$ASSETS_DIR/avar.me.png" "$OUTPUT_DIR/"
cp "$ASSETS_DIR/og-image.jpg" "$OUTPUT_DIR/"

echo ""
echo "=== 3. Build alphabet page ==="
python3 "$SCRIPT_DIR/build_alphabet.py" "$TEMPLATES_DIR/alphabet.html" "$OUTPUT_DIR/alphabet.html"

echo ""
echo "=== 4. build_data.py (en-av.jsonl → data/en-av/) ==="
DICTIONARY_JSONL="$JSONL_EN_AV" DICT_NAME="en-av" DOCS_ROOT="$OUTPUT_DIR" \
  python3 "$SCRIPT_DIR/build_data.py"

echo ""
echo "=== 5. build_data.py (av-en.jsonl → data/av-en/) ==="
DICTIONARY_JSONL="$JSONL_AV_EN" DICT_NAME="av-en" DOCS_ROOT="$OUTPUT_DIR" \
  python3 "$SCRIPT_DIR/build_data.py"

echo ""
echo "=== 6. Cache-bust (__ASSET_VERSION__ → build_id) ==="
export DOCS_ROOT="$OUTPUT_DIR"
python3 - <<'PY'
import json, os
from pathlib import Path

docs = Path(os.environ["DOCS_ROOT"])
manifest = json.loads((docs / "data/av-en/manifest.json").read_text(encoding="utf-8"))
build_id = manifest.get("build_id") or "build"
for name in ("index.html", "app.js", "styles.css"):
    path = docs / name
    text = path.read_text(encoding="utf-8")
    if "__ASSET_VERSION__" in text:
        path.write_text(text.replace("__ASSET_VERSION__", build_id), encoding="utf-8")
print(f"build_id={build_id}")
PY

if [ ! -f "$OUTPUT_DIR/index.html" ] || [ ! -d "$OUTPUT_DIR/data/av-en" ] || [ ! -d "$OUTPUT_DIR/data/en-av" ]; then
  echo "build.sh: incomplete output in $OUTPUT_DIR" >&2
  exit 1
fi

echo ""
echo "Build complete: $OUTPUT_DIR"
echo "Local preview:  python3 -m http.server -d $OUTPUT_DIR 8000"
