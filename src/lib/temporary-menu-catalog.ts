export type TemporaryMenuFamily = "wings" | "lasagnas";

export type TemporaryMenuItem = {
  code: string;
  family: TemporaryMenuFamily;
  name: string;
  sku: string;
  price_cop: number;
  description: string;
  image_src: string | null;
  components: Array<{ name: string; quantity: string }>;
  beverage_presentation?: "250 ML" | "400 ML" | "1 L" | "1,5 L";
  beverage_choice_required?: boolean;
  allows_fries_substitution?: boolean;
};

// These are commercial snapshots for the temporary POS phase. The database
// migration validates the code and price again before a sale is persisted.
export const temporaryMenuCatalog: TemporaryMenuItem[] = [
  {
    code: "ALITAS-MINI",
    family: "wings",
    name: "ALITAS MINI",
    sku: "TMP-ALITAS-MINI",
    price_cop: 12900,
    description: "2 alitas + 100 G papas + gaseosa 250 ML",
    image_src: null,
    components: [{ name: "ALITAS ENTERAS", quantity: "2" }, { name: "PAPAS", quantity: "100 G" }, { name: "GASEOSA", quantity: "250 ML" }],
    beverage_presentation: "250 ML",
    beverage_choice_required: true,
    allows_fries_substitution: true
  },
  {
    code: "ALITAS-PERSONAL",
    family: "wings",
    name: "ALITAS PERSONAL",
    sku: "TMP-ALITAS-PERSONAL",
    price_cop: 20900,
    description: "4 alitas + 150 G papas + gaseosa 400 ML",
    image_src: null,
    components: [{ name: "ALITAS ENTERAS", quantity: "4" }, { name: "PAPAS", quantity: "150 G" }, { name: "GASEOSA", quantity: "400 ML" }],
    beverage_presentation: "400 ML",
    beverage_choice_required: true,
    allows_fries_substitution: true
  },
  {
    code: "ALITAS-MEDIANO",
    family: "wings",
    name: "ALITAS MEDIANO",
    sku: "TMP-ALITAS-MEDIANO",
    price_cop: 36900,
    description: "8 alitas + 300 G papas + gaseosa 1 L",
    image_src: null,
    components: [{ name: "ALITAS ENTERAS", quantity: "8" }, { name: "PAPAS", quantity: "300 G" }, { name: "GASEOSA", quantity: "1 L" }],
    beverage_presentation: "1 L",
    beverage_choice_required: true,
    allows_fries_substitution: true
  },
  {
    code: "ALITAS-GRANDE",
    family: "wings",
    name: "ALITAS GRANDE",
    sku: "TMP-ALITAS-GRANDE",
    price_cop: 64900,
    description: "16 alitas + 600 G papas + gaseosa 1,5 L",
    image_src: null,
    components: [{ name: "ALITAS ENTERAS", quantity: "16" }, { name: "PAPAS", quantity: "600 G" }, { name: "GASEOSA", quantity: "1,5 L" }],
    beverage_presentation: "1,5 L",
    beverage_choice_required: true,
    allows_fries_substitution: true
  },
  {
    code: "ALITA-SUELTA",
    family: "wings",
    name: "ALITA SUELTA",
    sku: "TMP-ALITA-SUELTA",
    price_cop: 3000,
    description: "1 alita entera",
    image_src: null,
    components: [{ name: "ALITA ENTERA", quantity: "1" }]
  },
  {
    code: "PAPAS-120G",
    family: "wings",
    name: "PORCIÓN DE PAPAS",
    sku: "TMP-PAPAS-120G",
    price_cop: 5500,
    description: "120 G de papas",
    image_src: null,
    components: [{ name: "PAPAS", quantity: "120 G" }]
  },
  {
    code: "LASANA-CARNE",
    family: "lasagnas",
    name: "LASAÑA DE CARNE",
    sku: "TMP-LASANA-CARNE",
    price_cop: 24900,
    description: "Lasaña de carne",
    image_src: null,
    components: [{ name: "LASAÑA DE CARNE", quantity: "1" }]
  }
];

export function temporaryItemsForFamily(family: TemporaryMenuFamily) {
  return temporaryMenuCatalog.filter((item) => item.family === family);
}
