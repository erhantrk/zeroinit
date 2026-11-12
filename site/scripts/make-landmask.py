"""Rasterises Natural Earth 1:110m land (public domain) to a 720x360 equirectangular luminance PNG.
Usage: python3 -I scripts/make-landmask.py <ne_110m_land.geojson>
"""
import json, sys, pathlib
from PIL import Image, ImageDraw
root = pathlib.Path(__file__).resolve().parent.parent
data = json.load(open(sys.argv[1]))
W, H, S = 720, 360, 4
img = Image.new("L", (W * S, H * S), 0)
d = ImageDraw.Draw(img)
def px(lon, lat): return ((lon + 180) / 360 * W * S, (90 - lat) / 180 * H * S)
for f in data["features"]:
    g = f["geometry"]
    polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"]
    for poly in polys:
        for i, ring in enumerate(poly):
            d.polygon([px(*p[:2]) for p in ring], fill=255 if i == 0 else 0)
img = img.resize((W, H), Image.LANCZOS)
out = root / "public/assets/landmask.png"
out.parent.mkdir(parents=True, exist_ok=True)
img.save(out, optimize=True)
print(out, out.stat().st_size)
