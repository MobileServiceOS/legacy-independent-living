"""Generate PWA icons from the brand mark (public/brand/logo-mark.png)."""
from PIL import Image, ImageDraw

SRC = "public/brand/logo-mark.png"
CREAM = (251, 248, 241, 255)  # --paper
mark = Image.open(SRC).convert("RGBA")

def icon(size, pad_ratio, round_bg=False, out=None):
    canvas = Image.new("RGBA", (size, size), CREAM)
    inner = int(size * (1 - 2 * pad_ratio))
    m = mark.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    canvas.alpha_composite(m, (off, off))
    if round_bg:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, size - 1, size - 1], radius=size // 5, fill=255)
        canvas.putalpha(mask)
    canvas.save(out, optimize=True)

icon(192, 0.06, out="public/icons/icon-192.png")
icon(512, 0.06, out="public/icons/icon-512.png")
icon(512, 0.16, out="public/icons/maskable-512.png")   # safe zone for Android masks
icon(180, 0.08, out="public/icons/apple-touch-icon.png")
icon(64, 0.02, out="public/icons/favicon-64.png")
icon(32, 0.0, out="public/icons/favicon-32.png")
print("icons written")
