export type OrderKind = "delivery" | "pickup" | "local";

export type OrderStatus =
  | "draft"
  | "sent_to_whatsapp"
  | "confirmed"
  | "in_kitchen"
  | "in_preparation"
  | "prepared"
  | "on_the_way"
  | "delivered"
  | "cancelled"
  | "rejected"
  | "closed";

export type PizzaSize = {
  id: string;
  name: string;
  description: string;
  order: number;
};

export type PizzaFlavor = {
  id: string;
  name: string;
  description: string;
  allergens: string[];
  prices: Record<string, number>;
  featured?: boolean;
};

export type PizzaExtra = {
  id: string;
  name: string;
  price: number;
};

export type Combo = {
  id: string;
  name: string;
  description: string;
  price: number;
  items: string[];
};

export type OrderPizza = {
  id: string;
  sizeId: string;
  flavorAId: string;
  flavorBId?: string;
  crustId?: string;
  extraIds: string[];
  quantity: number;
  notes?: string;
};

export type CustomerDraft = {
  name: string;
  phone: string;
  address: string;
  neighborhood: string;
  deliveryNotes: string;
};

export type SiteSettings = {
  whatsappNumber: string;
  whatsappEnabled: boolean;
  whatsappButtonText: string;
  businessName: string;
};
