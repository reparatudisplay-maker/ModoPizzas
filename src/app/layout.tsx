import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ModoPizzas",
  description: "Sistema web para pedidos y operacion de pizzeria."
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
