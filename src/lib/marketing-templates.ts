export type MarketingElementKind = "text" | "image" | "price" | "shape" | "cta" | "dynamic_pizza" | "dynamic_product" | "promotion";

export type MarketingElement = {
  id: string;
  kind: MarketingElementKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  locked?: boolean;
  zIndex: number;
  content?: string;
  sourceId?: string;
  sourceKind?: "pizza_price" | "sale_product" | "promotion";
  frozenPriceCop?: number | null;
  style: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: number;
    textAlign?: "left" | "center" | "right";
    color?: string;
    background?: string;
    borderColor?: string;
    borderWidth?: number;
    borderRadius?: number;
    opacity?: number;
    shadow?: boolean;
    letterSpacing?: number;
  };
  animation?: {
    in?: "none" | "appear" | "fade" | "slide" | "zoom";
    emphasis?: "none" | "pulse" | "soft_zoom" | "price_pop";
    out?: "none" | "fade" | "slide";
  };
};

export type MarketingSceneDraft = {
  id: string;
  name: string;
  duration_seconds: number;
  transition: "cut" | "fade" | "slide";
  background: { type: "color" | "gradient" | "image"; value: string };
  elements: MarketingElement[];
};

export type MarketingTemplate = {
  id: string;
  name: string;
  description: string;
  scene: MarketingSceneDraft;
};

function id(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function textElement(partial: Partial<MarketingElement>): MarketingElement {
  return {
    id: id("el"),
    kind: "text",
    label: "Texto",
    x: 8,
    y: 8,
    width: 30,
    height: 10,
    zIndex: 1,
    content: "TEXTO",
    animation: { in: "fade", emphasis: "none", out: "none" },
    ...partial,
    style: {
      fontFamily: "Inter",
      fontSize: 54,
      fontWeight: 800,
      textAlign: "left",
      color: "#fff8ed",
      background: "transparent",
      borderRadius: 0,
      opacity: 1,
      shadow: true,
      ...partial.style
    }
  };
}

function shapeElement(partial: Partial<MarketingElement>): MarketingElement {
  return {
    id: id("shape"),
    kind: "shape",
    label: "Forma",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    zIndex: 0,
    ...partial,
    style: {
      background: "rgba(0,0,0,.35)",
      borderRadius: 0,
      opacity: 1,
      ...partial.style
    }
  };
}

function imageElement(partial: Partial<MarketingElement>): MarketingElement {
  return {
    id: id("img"),
    kind: "image",
    label: "Imagen",
    x: 55,
    y: 12,
    width: 35,
    height: 62,
    zIndex: 2,
    animation: { in: "zoom", emphasis: "soft_zoom", out: "fade" },
    ...partial,
    style: {
      borderRadius: 28,
      opacity: 1,
      shadow: true,
      ...partial.style
    }
  };
}

export const marketingTemplates: MarketingTemplate[] = [
  {
    id: "visual-menu",
    name: "Menu visual",
    description: "Fotos protagonistas, sabores y precios grandes.",
    scene: {
      id: id("scene"),
      name: "MENU VISUAL",
      duration_seconds: 8,
      transition: "fade",
      background: { type: "gradient", value: "linear-gradient(135deg,#180f0b,#4c130b 55%,#f2b84b)" },
      elements: [
        shapeElement({ x: 4, y: 6, width: 44, height: 82, style: { background: "rgba(20,12,8,.72)", borderRadius: 28 } }),
        textElement({ label: "Titulo", content: "PIZZAS ARTESANALES", x: 8, y: 11, width: 38, height: 12, style: { fontSize: 58 } }),
        textElement({ label: "Precio", kind: "price", content: "DESDE $14.500", x: 8, y: 66, width: 34, height: 12, style: { fontSize: 48, color: "#ffd166" } }),
        imageElement({ label: "Foto pizza", kind: "dynamic_pizza", x: 50, y: 10, width: 43, height: 72 })
      ]
    }
  },
  {
    id: "compact-menu",
    name: "Menu compacto",
    description: "Mas referencias en pantalla con precios legibles.",
    scene: {
      id: id("scene"),
      name: "MENU COMPACTO",
      duration_seconds: 10,
      transition: "cut",
      background: { type: "color", value: "#15110f" },
      elements: [
        textElement({ content: "MENU DE PIZZAS", x: 5, y: 5, width: 42, height: 9, style: { fontSize: 42, color: "#fce8c4" } }),
        ...[0, 1, 2, 3, 4, 5].map((index) =>
          shapeElement({
            x: 5 + (index % 2) * 46,
            y: 18 + Math.floor(index / 2) * 24,
            width: 40,
            height: 17,
            zIndex: 1,
            style: { background: "rgba(255,255,255,.08)", borderRadius: 16, borderColor: "rgba(255,255,255,.12)", borderWidth: 1 }
          })
        )
      ]
    }
  },
  {
    id: "featured-product",
    name: "Producto destacado",
    description: "Una pizza o producto como protagonista.",
    scene: {
      id: id("scene"),
      name: "DESTACADO",
      duration_seconds: 8,
      transition: "fade",
      background: { type: "gradient", value: "linear-gradient(120deg,#0f1412,#173f2b 60%,#f97316)" },
      elements: [
        imageElement({ label: "Producto", kind: "dynamic_pizza", x: 6, y: 11, width: 48, height: 76, style: { borderRadius: 34 } }),
        textElement({ content: "LA FAVORITA DE HOY", x: 56, y: 20, width: 36, height: 12, style: { fontSize: 46, textAlign: "center" } }),
        textElement({ label: "Precio grande", kind: "price", content: "$25.000", x: 58, y: 48, width: 32, height: 15, style: { fontSize: 74, color: "#ffdf75", textAlign: "center" } })
      ]
    }
  },
  {
    id: "promotion",
    name: "Promocion",
    description: "Oferta, precio anterior, precio promocional y CTA.",
    scene: {
      id: id("scene"),
      name: "PROMOCION",
      duration_seconds: 10,
      transition: "slide",
      background: { type: "gradient", value: "linear-gradient(135deg,#2b0f0a,#9f2418)" },
      elements: [
        textElement({ label: "Oferta", kind: "promotion", content: "PROMO DEL DIA", x: 7, y: 10, width: 44, height: 14, style: { fontSize: 70, color: "#fff7ed" } }),
        textElement({ content: "ANTES $35.000", x: 9, y: 42, width: 30, height: 9, style: { fontSize: 34, color: "#ffd7c2" } }),
        textElement({ kind: "price", content: "HOY $29.000", x: 8, y: 54, width: 39, height: 14, style: { fontSize: 62, color: "#ffdf75" } }),
        imageElement({ label: "Imagen promocion", kind: "promotion", x: 56, y: 14, width: 35, height: 64 })
      ]
    }
  },
  {
    id: "carousel",
    name: "Carrusel",
    description: "Escena simple para secuencias de producto.",
    scene: {
      id: id("scene"),
      name: "CARRUSEL",
      duration_seconds: 6,
      transition: "fade",
      background: { type: "color", value: "#201512" },
      elements: [
        imageElement({ kind: "dynamic_pizza", x: 35, y: 8, width: 30, height: 54, style: { borderRadius: 999 } }),
        textElement({ content: "SABOR DESTACADO", x: 20, y: 66, width: 60, height: 10, style: { fontSize: 50, textAlign: "center" } }),
        textElement({ kind: "price", content: "$24.000", x: 33, y: 79, width: 34, height: 10, style: { fontSize: 50, color: "#ffd166", textAlign: "center" } })
      ]
    }
  },
  {
    id: "split-menu",
    name: "Menu dividido",
    description: "Dos grupos visuales equilibrados.",
    scene: {
      id: id("scene"),
      name: "MENU DIVIDIDO",
      duration_seconds: 9,
      transition: "cut",
      background: { type: "color", value: "#110f0e" },
      elements: [
        shapeElement({ x: 4, y: 8, width: 43, height: 80, style: { background: "#251713", borderRadius: 24 } }),
        shapeElement({ x: 53, y: 8, width: 43, height: 80, style: { background: "#2a2117", borderRadius: 24 } }),
        textElement({ content: "CLASICAS", x: 8, y: 14, width: 35, height: 10, style: { fontSize: 44 } }),
        textElement({ content: "ESPECIALES", x: 57, y: 14, width: 35, height: 10, style: { fontSize: 44 } })
      ]
    }
  },
  {
    id: "minimal",
    name: "Minimalista",
    description: "Tipografia y precios protagonistas.",
    scene: {
      id: id("scene"),
      name: "MINIMALISTA",
      duration_seconds: 8,
      transition: "fade",
      background: { type: "color", value: "#f7efe2" },
      elements: [
        textElement({ content: "MODO PIZZAS", x: 8, y: 12, width: 50, height: 10, style: { color: "#19130f", fontSize: 48, shadow: false } }),
        textElement({ content: "HAWAIANA", x: 8, y: 38, width: 42, height: 11, style: { color: "#19130f", fontSize: 68, shadow: false } }),
        textElement({ kind: "price", content: "$25.000", x: 8, y: 58, width: 34, height: 12, style: { color: "#d9281f", fontSize: 64, shadow: false } }),
        shapeElement({ x: 62, y: 10, width: 26, height: 76, style: { background: "#d9281f", borderRadius: 999 } })
      ]
    }
  }
];

export function cloneTemplateScene(template: MarketingTemplate): MarketingSceneDraft {
  return {
    ...template.scene,
    id: id("scene"),
    elements: template.scene.elements.map((element) => ({ ...element, id: id("el"), style: { ...element.style }, animation: { ...element.animation } }))
  };
}
