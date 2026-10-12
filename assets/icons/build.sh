#!/bin/sh
# Regenerates the raster icons in public/ from the SVG sources. Needs rsvg-convert and ImageMagick (brew install librsvg imagemagick).
set -e
cd "$(dirname "$0")"
OUT=../../public
TMP=$(mktemp -d)
rsvg-convert -w 16 -h 16 favicon-16.svg -o "$TMP/16.png"
rsvg-convert -w 32 -h 32 "$OUT/favicon.svg" -o "$TMP/32.png"
rsvg-convert -w 48 -h 48 "$OUT/favicon.svg" -o "$TMP/48.png"
magick "$TMP/16.png" "$TMP/32.png" "$TMP/48.png" "$OUT/favicon.ico"
rsvg-convert -w 180 -h 180 apple-touch-icon.svg -o "$OUT/apple-touch-icon.png"
rm -rf "$TMP"
echo "favicon.ico (16/32/48) and apple-touch-icon.png (180) written to public/"
