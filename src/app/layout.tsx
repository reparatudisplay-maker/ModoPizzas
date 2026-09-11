import type { Metadata } from "next";
import "./globals.css";
import "./public-storefront.css";

export const metadata: Metadata = {
  title: { default: "ModoPizzas | Pizza horneada al momento", template: "%s | ModoPizzas" },
  description: "Pizza horneada al momento. Explora el menú, personaliza tu pizza y pide fácil.",
  openGraph: {
    title: "ModoPizzas | Enciende el antojo",
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
