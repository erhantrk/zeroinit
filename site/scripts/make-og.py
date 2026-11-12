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
# the wordmark (docs/img/logo-light.png, transparent) at the top left
logo = Image.open(root.parent / "docs/img/logo-light.png").convert("RGBA")
lh = 84
logo = logo.resize((round(logo.width * lh / logo.height), lh), Image.LANCZOS)
img.paste(logo, (56, 44), logo)
y = 190
for line in ["An invoice gets its own", "address before it costs", "anything."]:
    d.text((72, y), line, font=med, fill=INK)
    y += 88
d.text((72, 548), "NEAR testnet only. Not audited.", font=mono, fill=MUTED)
# the mark at the top right
mark = Image.open(root.parent / "docs/img/mark.png").convert("RGBA").resize((112, 112), Image.LANCZOS)
img.paste(mark, (W - 72 - 112, 48), mark)
img.save(root / "public/og.png", optimize=True)
