from __future__ import annotations

import base64
import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "photoshop"
SOURCE = Path(r"C:\Users\DG\AppData\Local\Temp\codex-clipboard-30454db2-12e1-434f-98ae-a38a142e620a.png")

W_CM = 118
H_CM = 15
DPI = 300
W = round(W_CM / 2.54 * DPI)
H = round(H_CM / 2.54 * DPI)

BLACK = (4, 4, 4, 255)
WHITE = (248, 246, 239, 255)
RED = (218, 20, 22, 255)
DARK_RED = (116, 10, 15, 255)
CHEESE = (244, 184, 53, 255)

FONT_IMPACT = Path(r"C:\Windows\Fonts\impact.ttf")
FONT_ARIAL_BOLD = Path(r"C:\Windows\Fonts\arialbd.ttf")


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def fit_font(text: str, max_width: int, start: int, min_size: int = 24, path: Path = FONT_IMPACT) -> ImageFont.FreeTypeFont:
    size = start
    while size >= min_size:
        candidate = font(path, size)
        box = ImageDraw.Draw(Image.new("RGBA", (10, 10))).textbbox((0, 0), text, font=candidate, stroke_width=max(1, size // 18))
        if box[2] - box[0] <= max_width:
            return candidate
        size -= 4
    return font(path, min_size)


def text_size(text: str, fnt: ImageFont.FreeTypeFont, stroke: int = 0) -> tuple[int, int]:
    box = ImageDraw.Draw(Image.new("RGBA", (10, 10))).textbbox((0, 0), text, font=fnt, stroke_width=stroke)
    return box[2] - box[0], box[3] - box[1]


def draw_centered(draw: ImageDraw.ImageDraw, xy: tuple[int, int], text: str, fnt: ImageFont.FreeTypeFont, fill, stroke_fill=None, stroke_width=0):
    tw, th = text_size(text, fnt, stroke_width)
    draw.text((xy[0] - tw // 2, xy[1] - th // 2), text, font=fnt, fill=fill, stroke_fill=stroke_fill, stroke_width=stroke_width)


def brush_rect(layer: Image.Image, box: tuple[int, int, int, int], color, seed: int) -> None:
    random.seed(seed)
    draw = ImageDraw.Draw(layer)
    x1, y1, x2, y2 = box
    for _ in range(34):
        y = random.randint(y1, y2)
        h = random.randint(12, 34)
        jitter_left = random.randint(-40, 30)
        jitter_right = random.randint(-30, 50)
        draw.rounded_rectangle((x1 + jitter_left, y, x2 + jitter_right, y + h), radius=5, fill=color)
    for _ in range(240):
        x = random.randint(x1 - 70, x2 + 70)
        y = random.randint(y1 - 32, y2 + 32)
        r = random.randint(2, 10)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(color[0], color[1], color[2], random.randint(80, 210)))


def add_grunge(layer: Image.Image, seed: int) -> None:
    random.seed(seed)
    draw = ImageDraw.Draw(layer)
    for _ in range(900):
        x = random.randint(0, W)
        y = random.randint(70, H - 80)
        r = random.randint(1, 7)
        color = RED if random.random() < 0.62 else WHITE
        alpha = random.randint(20, 90)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=(color[0], color[1], color[2], alpha))
    for _ in range(75):
        x = random.randint(0, W)
        y = random.randint(80, H - 120)
        length = random.randint(40, 180)
        draw.line((x, y, x + length, y + random.randint(-10, 10)), fill=(RED[0], RED[1], RED[2], random.randint(40, 130)), width=random.randint(2, 8))


def make_pizza_asset() -> Image.Image:
    src = Image.open(SOURCE).convert("RGBA")
    crop = src.crop((1246, 198, 1635, 548))
    crop = crop.resize((2700, 2288), Image.Resampling.LANCZOS)
    crop = crop.filter(ImageFilter.UnsharpMask(radius=2, percent=135, threshold=3))

    # Soft oval mask keeps the original pizza photo but hides screenshot edges.
    mask = Image.new("L", crop.size, 0)
    md = ImageDraw.Draw(mask)
    md.ellipse((-120, -95, crop.width + 180, crop.height + 290), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(24))
    crop.putalpha(mask)
    return crop


def draw_icons(draw: ImageDraw.ImageDraw, y: int) -> None:
    labels = [("MASA", "FRESCA"), ("INGREDIENTES", "SELECCIONADOS"), ("HECHA", "CON PASION")]
    x = 4450
    small = font(FONT_ARIAL_BOLD, 112)
    for idx, (a, b) in enumerate(labels):
        cx = x + idx * 1380
        if idx:
            draw.line((cx - 230, y - 150, cx - 230, y + 170), fill=(230, 230, 230, 110), width=8)
        if idx == 0:
            draw.ellipse((cx - 420, y - 108, cx - 210, y + 102), outline=RED, width=18)
            draw.arc((cx - 392, y - 136, cx - 238, y + 18), 190, 350, fill=WHITE, width=14)
        elif idx == 1:
            draw.ellipse((cx - 400, y - 115, cx - 250, y + 115), outline=RED, width=16)
            draw.ellipse((cx - 315, y - 115, cx - 165, y + 115), outline=RED, width=16)
            draw.line((cx - 342, y + 95, cx - 210, y - 92), fill=RED, width=13)
        else:
            draw.line((cx - 350, y + 80, cx - 442, y - 10, cx - 405, y - 100, cx - 298, y - 97, cx - 248, y - 10, cx - 350, y + 80), fill=RED, width=18, joint="curve")
        draw.text((cx - 120, y - 115), a, font=small, fill=WHITE)
        draw.text((cx - 120, y + 12), b, font=small, fill=RED)


def make_preview() -> Image.Image:
    bg = Image.new("RGBA", (W, H), BLACK)
    d = ImageDraw.Draw(bg)
    d.rectangle((0, 0, W, 64), fill=(0, 0, 0, 255))
    d.rectangle((0, H - 64, W, H), fill=(0, 0, 0, 255))
    d.line((0, 74, W, 74), fill=(35, 35, 35, 255), width=4)
    d.line((0, H - 74, W, H - 74), fill=(35, 35, 35, 255), width=4)

    fx = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    add_grunge(fx, 18)
    brush_rect(fx, (920, 1235, 3020, 1625), DARK_RED, 42)
    brush_rect(fx, (11110, 1315, 13540, 1660), DARK_RED, 64)
    bg.alpha_composite(fx)

    pizza = make_pizza_asset()
    bg.alpha_composite(pizza, (7985, 152))

    smoke = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(smoke)
    random.seed(4)
    for _ in range(42):
        x = random.randint(7950, 10650)
        y = random.randint(120, 580)
        r = random.randint(65, 180)
        sd.ellipse((x - r, y - r, x + r, y + r), fill=(230, 230, 230, random.randint(10, 34)))
    smoke = smoke.filter(ImageFilter.GaussianBlur(28))
    bg.alpha_composite(smoke)

    draw = ImageDraw.Draw(bg)

    left_white = fit_font("PIZZA", 1550, 440)
    left_red = fit_font("CALIENTE", 2900, 560)
    cta = fit_font("PIDE AQUI >>", 1550, 235, path=FONT_ARIAL_BOLD)
    draw.text((790, 520), "PIZZA", font=left_white, fill=WHITE, stroke_fill=(0, 0, 0, 255), stroke_width=12)
    draw.text((715, 825), "CALIENTE", font=left_red, fill=RED, stroke_fill=(0, 0, 0, 255), stroke_width=10)
    draw.text((1180, 1318), "PIDE AQUI >>", font=cta, fill=WHITE, stroke_fill=DARK_RED, stroke_width=8)

    hot_1 = fit_font("RECIEN SALIDAS", 3900, 410)
    hot_2 = fit_font("DEL HORNO", 4600, 610)
    draw_centered(draw, (6100, 580), "RECIEN SALIDAS", hot_1, WHITE, (0, 0, 0, 255), 11)
    draw_centered(draw, (6270, 1010), "DEL HORNO", hot_2, RED, (0, 0, 0, 255), 10)
    draw.line((4300, 1265, 8010, 1226), fill=RED, width=28)
    draw_icons(draw, 1510)

    right_1 = fit_font("ELIGE TU", 2300, 500)
    right_2 = fit_font("FAVORITA", 2600, 520)
    right_3 = fit_font("MAS QUESO, MAS SABOR", 2050, 190, path=FONT_ARIAL_BOLD)
    draw.rounded_rectangle((10960, 380, 13630, 1490), radius=26, outline=RED, width=20)
    draw.text((11200, 560), "ELIGE TU", font=right_1, fill=WHITE, stroke_fill=(0, 0, 0, 255), stroke_width=9)
    draw.text((11180, 870), "FAVORITA", font=right_2, fill=RED, stroke_fill=(0, 0, 0, 255), stroke_width=9)
    draw.text((11310, 1402), "MAS QUESO, MAS SABOR", font=right_3, fill=WHITE, stroke_fill=DARK_RED, stroke_width=7)

    for x, y, a in [(3890, 420, -26), (4070, 500, 0), (8130, 430, 25), (8265, 520, 0), (13250, 270, 0)]:
        length = 170 if x < 10000 else 230
        dx = int(math.cos(math.radians(a)) * length)
        dy = int(math.sin(math.radians(a)) * length)
        draw.line((x, y, x + dx, y + dy), fill=RED, width=22)

    return bg.convert("RGB")


def make_svg(pizza_rel: str) -> str:
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="1180mm" height="150mm" viewBox="0 0 1180 150">
  <title>Adhesivo Modo Pizzas 118 x 15 cm</title>
  <rect width="1180" height="150" fill="#040404"/>
  <rect y="5" width="1180" height="140" fill="#040404"/>
  <path d="M92 87 C124 75 166 75 205 84 C242 92 290 87 326 75 L326 122 C274 138 205 128 152 132 C120 134 96 127 70 119 Z" fill="#740a0f"/>
  <path d="M940 89 C978 76 1039 79 1080 86 C1125 94 1146 89 1170 78 L1170 130 C1121 143 1064 135 1004 138 C974 139 946 133 920 124 Z" fill="#740a0f"/>
  <image href="{pizza_rel}" x="676" y="13" width="245" height="125" preserveAspectRatio="xMidYMid meet"/>
  <text x="67" y="61" font-family="Impact, Arial Black, sans-serif" font-size="37" fill="#f8f6ef">PIZZA</text>
  <text x="60" y="95" font-family="Impact, Arial Black, sans-serif" font-size="47" fill="#da1416">CALIENTE</text>
  <text x="132" y="121" font-family="Arial Black, Arial, sans-serif" font-size="24" fill="#f8f6ef">PIDE AQUI &gt;&gt;</text>
  <text x="517" y="61" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="35" fill="#f8f6ef">RECIEN SALIDAS</text>
  <text x="530" y="99" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="52" fill="#da1416">DEL HORNO</text>
  <line x1="364" y1="107" x2="680" y2="104" stroke="#da1416" stroke-width="3"/>
  <text x="575" y="131" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-size="13" fill="#f8f6ef">MASA FRESCA  |  INGREDIENTES SELECCIONADOS  |  HECHA CON PASION</text>
  <rect x="928" y="31" width="228" height="92" rx="3" fill="none" stroke="#da1416" stroke-width="2.5"/>
  <text x="949" y="65" font-family="Impact, Arial Black, sans-serif" font-size="42" fill="#f8f6ef">ELIGE TU</text>
  <text x="946" y="99" font-family="Impact, Arial Black, sans-serif" font-size="49" fill="#da1416">FAVORITA</text>
  <text x="958" y="122" font-family="Arial Black, Arial, sans-serif" font-size="18" fill="#f8f6ef">MAS QUESO, MAS SABOR</text>
</svg>
'''


def make_jsx() -> str:
    return r'''#target photoshop
app.displayDialogs = DialogModes.NO;

var baseFolder = File($.fileName).parent;
var pizzaFile = File(baseFolder + "/assets/pizza-porcion.png");
var outputFile = File(baseFolder + "/adhesivo-modo-pizzas-118x15cm-editable.psd");

var doc = app.documents.add(UnitValue(118, "cm"), UnitValue(15, "cm"), 300, "Adhesivo Modo Pizzas 118x15cm", NewDocumentMode.CMYK, DocumentFill.BLACK);

function cmyk(c, m, y, k) {
  var color = new SolidColor();
  color.cmyk.cyan = c;
  color.cmyk.magenta = m;
  color.cmyk.yellow = y;
  color.cmyk.black = k;
  return color;
}

var rojo = cmyk(0, 95, 90, 5);
var rojoOscuro = cmyk(25, 100, 90, 35);
var blanco = cmyk(0, 0, 3, 0);
var negro = cmyk(70, 60, 55, 95);

function fillRect(name, x1, y1, x2, y2, color) {
  var layer = doc.artLayers.add();
  layer.name = name;
  doc.selection.select([[UnitValue(x1, "cm"), UnitValue(y1, "cm")], [UnitValue(x2, "cm"), UnitValue(y1, "cm")], [UnitValue(x2, "cm"), UnitValue(y2, "cm")], [UnitValue(x1, "cm"), UnitValue(y2, "cm")]]);
  doc.selection.fill(color);
  doc.selection.deselect();
  return layer;
}

function textLayer(name, content, x, y, sizePt, color, fontName) {
  var layer = doc.artLayers.add();
  layer.kind = LayerKind.TEXT;
  layer.name = name;
  layer.textItem.contents = content;
  layer.textItem.position = [UnitValue(x, "cm"), UnitValue(y, "cm")];
  layer.textItem.size = UnitValue(sizePt, "pt");
  layer.textItem.color = color;
  layer.textItem.font = fontName || "Impact";
  return layer;
}

fillRect("fondo negro a sangre", 0, 0, 118, 15, negro);
fillRect("pincel rojo izquierda CTA", 8.5, 8.6, 28.2, 12.3, rojoOscuro);
fillRect("pincel rojo derecha slogan", 95.0, 8.7, 115.5, 12.1, rojoOscuro);
fillRect("linea superior seguridad", 0, 0.58, 118, 0.64, cmyk(70, 60, 55, 75));
fillRect("linea inferior seguridad", 0, 14.36, 118, 14.42, cmyk(70, 60, 55, 75));

if (pizzaFile.exists) {
  app.open(pizzaFile);
  app.activeDocument.selection.selectAll();
  app.activeDocument.selection.copy();
  app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
  app.activeDocument = doc;
  doc.paste();
  app.activeDocument.activeLayer.name = "porcion de pizza / raster editable";
  app.activeDocument.activeLayer.translate(UnitValue(67.5, "cm"), UnitValue(0.5, "cm"));
}

textLayer("texto PIZZA", "PIZZA", 6.8, 5.1, 108, blanco, "Impact");
textLayer("texto CALIENTE", "CALIENTE", 6.0, 8.1, 132, rojo, "Impact");
textLayer("CTA PIDE AQUI", "PIDE AQUI >>", 10.0, 12.9, 54, blanco, "Arial-BoldMT");
textLayer("centro RECIEN SALIDAS", "RECIEN SALIDAS", 40.4, 5.3, 100, blanco, "Impact");
textLayer("centro DEL HORNO", "DEL HORNO", 40.7, 8.7, 142, rojo, "Impact");
fillRect("subrayado DEL HORNO", 35.9, 10.68, 67.9, 10.92, rojo);
textLayer("atributos", "MASA FRESCA  |  INGREDIENTES SELECCIONADOS  |  HECHA CON PASION", 41.0, 12.98, 33, blanco, "Arial-BoldMT");
textLayer("derecha ELIGE TU", "ELIGE TU", 94.9, 5.6, 102, blanco, "Impact");
textLayer("derecha FAVORITA", "FAVORITA", 94.6, 8.55, 108, rojo, "Impact");
textLayer("derecha slogan", "MAS QUESO, MAS SABOR", 95.8, 13.45, 39, blanco, "Arial-BoldMT");

doc.saveAs(outputFile, new PhotoshopSaveOptions(), true, Extension.LOWERCASE);
'''


def write_outputs() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    assets = OUT / "assets"
    assets.mkdir(exist_ok=True)

    pizza = make_pizza_asset()
    pizza_asset = assets / "pizza-porcion.png"
    pizza.save(pizza_asset)

    preview = make_preview()
    png = OUT / "adhesivo-modo-pizzas-118x15cm-300dpi.png"
    preview.save(png, dpi=(DPI, DPI), optimize=True)

    web = preview.resize((2600, round(2600 * H / W)), Image.Resampling.LANCZOS)
    web.save(OUT / "adhesivo-modo-pizzas-preview-web.png", optimize=True)

    cmyk = preview.convert("CMYK")
    cmyk.save(OUT / "adhesivo-modo-pizzas-118x15cm-cmyk.tif", compression="tiff_lzw", dpi=(DPI, DPI))

    pdf = OUT / "adhesivo-modo-pizzas-118x15cm-print.pdf"
    c = canvas.Canvas(str(pdf), pagesize=(W_CM * cm, H_CM * cm))
    c.drawImage(str(png), 0, 0, width=W_CM * cm, height=H_CM * cm, preserveAspectRatio=False, mask=None)
    c.showPage()
    c.save()

    svg = OUT / "adhesivo-modo-pizzas-118x15cm-master.svg"
    svg.write_text(make_svg("assets/pizza-porcion.png"), encoding="utf-8")

    jsx = OUT / "adhesivo-modo-pizzas-118x15cm-editable.jsx"
    jsx.write_text(make_jsx(), encoding="utf-8")

    guide = OUT / "adhesivo-modo-pizzas-118x15cm-notas.txt"
    guide.write_text(
        "Medida final: 118 cm x 15 cm\n"
        "Resolucion PNG/TIFF: 13937 x 1772 px a 300 ppp\n"
        "Formato editable Photoshop: ejecutar el JSX en Photoshop para crear un PSD con textos por capas.\n"
        "Recomendacion: pedir a la litografia confirmacion de sangrado; si solicitan sangrado, agregar 3 mm por lado.\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    write_outputs()
