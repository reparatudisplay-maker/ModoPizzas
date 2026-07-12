# ModoPizzas

Sistema web para pizzeria: pedidos publicos, salida a WhatsApp, panel de venta, cocina, domicilios, inventario y reportes basicos.

## Stack previsto

- Next.js + React + TypeScript
- Supabase Auth, Postgres, Realtime y Storage
- Vercel para despliegue
- GitHub para versionamiento

## Ejecutar localmente

Este entorno no tenia Node/npm disponibles al crear la base. Cuando Node este instalado:

```bash
npm install
npm run dev
```

Copia `.env.example` a `.env.local` y completa las variables de Supabase.

## Reglas confirmadas

- Moneda: COP.
- Caja sin decimales.
- Compras e inventario con decimales.
- Formato numerico: punto para miles, coma para decimales.
- Mitad y mitad cobra el sabor de mayor precio.
- Tamanos iniciales: porcion, personal, mediana, grande.
- Sin mesas numeradas.
- Sin pagos online iniciales; pedido web finaliza por WhatsApp.
- Vendedor decide imprimir recibo, etiqueta o ambos.
- Facturacion electronica DIAN queda preparada para integracion futura.
