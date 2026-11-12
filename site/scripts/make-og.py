"""Draws public/og.png (1200x630) from the design tokens. Fonts: Geist (OFL)."""
from PIL import Image, ImageDraw, ImageFont
import sys, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
fonts = root / "node_modules/geist/dist/fonts"
PAPER, INK, MUTED = "#F6F5F1", "#111110", "#6B6A65"
W, H = 1200, 630
img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)
med = ImageFont.truetype(str(fonts / "geist-sans/Geist-Medium.ttf"), 76)
reg = ImageFont.truetype(str(fonts / "geist-sans/Geist-Regular.ttf"), 30)
mono = ImageFont.truetype(str(fonts / "geist-mono/GeistMono-Regular.ttf"), 26)
d.text((72, 64), "ZeroInit", font=reg, fill=INK)
y = 190
for line in ["An invoice gets its own", "address before it costs", "anything."]:
    d.text((72, y), line, font=med, fill=INK)
    y += 88
d.text((72, 548), "NEAR testnet only. Not audited.", font=mono, fill=MUTED)
# one outlined point: an address before an account
cx, cy = 1040, 150
d.ellipse((cx - 26, cy - 26, cx + 26, cy + 26), outline=INK, width=3)
d.ellipse((cx - 5, cy - 5, cx + 5, cy + 5), fill=INK)
img.save(root / "public/og.png", optimize=True)
