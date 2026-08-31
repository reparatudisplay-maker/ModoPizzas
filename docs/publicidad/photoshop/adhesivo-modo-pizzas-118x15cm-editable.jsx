#target photoshop
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
