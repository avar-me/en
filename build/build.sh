#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="${1:-$PROJECT_DIR/dist}"
TEMPLATES_DIR="$PROJECT_DIR/templates"
ASSETS_DIR="$PROJECT_DIR/assets"

echo "Building English-Avar Dictionary website..."
mkdir -p "$OUTPUT_DIR"

# Build dictionary JSON (fetches data from remote source)
echo "Building dictionary data..."
python3 "$SCRIPT_DIR/build_dictionary.py" "$OUTPUT_DIR/dictionary.json"

# Build alphabet page
echo "Building alphabet page..."
python3 "$SCRIPT_DIR/build_alphabet.py" "$TEMPLATES_DIR/alphabet.html" "$OUTPUT_DIR/alphabet.html"

# Copy app.js with cache-busting version
APP_JS_VERSION=$(date +%s)
APP_JS_NAME="app.${APP_JS_VERSION}.js"
cp "$TEMPLATES_DIR/app.js" "$OUTPUT_DIR/$APP_JS_NAME"

# Copy index.html with versioned app.js reference
sed "s|app\.js|$APP_JS_NAME|g" "$TEMPLATES_DIR/index.html" > "$OUTPUT_DIR/index.html"

# Copy static files
cp "$TEMPLATES_DIR/about.html" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/styles.css" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/robots.txt" "$OUTPUT_DIR/"
cp "$TEMPLATES_DIR/sitemap.xml" "$OUTPUT_DIR/"

# Copy assets
cp "$ASSETS_DIR/avar.me.png" "$OUTPUT_DIR/"
cp "$ASSETS_DIR/og-image.jpg" "$OUTPUT_DIR/"

echo "Build complete! Output in $OUTPUT_DIR/"
