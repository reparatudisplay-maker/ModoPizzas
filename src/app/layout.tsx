import type { Metadata } from "next";
import "./globals.css";
import "./public-storefront.css";

export const metadata: Metadata = {
  title: { default: "Modo Pizzas | Pizza horneada al momento", template: "%s | Modo Pizzas" },
  description: "Pizza horneada al momento. Explora el menú, personaliza tu pizza y pide fácil.",
  openGraph: {
    title: "Modo Pizzas | Pizza horneada al momento",
    description: "Pizza horneada al momento. Pide fácil, disfruta más.",
    type: "website"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
