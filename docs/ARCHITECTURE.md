# Arquitectura ModoPizzas

## Alcance MVP

- Web publica para menu, promociones y pedido con salida a WhatsApp.
- Panel interno para vendedor, cocina, mensajero, gerente y administrador.
- Sin pagos online en la primera version.
- Sin factura electronica DIAN en la primera version.
- Preparado para pagos online y facturacion electronica futura.
- Sin mesas numeradas.
- Solo online.

## Reglas de negocio

- Caja y ventas usan enteros COP, sin decimales.
- Compras, gastos e inventario aceptan decimales.
- Formato: punto para miles y coma para decimales.
- Pizzas mitad y mitad cobran el sabor de mayor precio.
- Tamanos iniciales: porcion, personal, mediana y grande.
- El numero de WhatsApp se configura en `site_settings`.
- Para domicilio son obligatorios nombre, telefono y direccion.
- Para recoger o local, los datos del cliente son opcionales.
- El vendedor decide imprimir recibo, etiqueta o ambos.

## Estados de pedido

```text
draft
sent_to_whatsapp
confirmed
in_kitchen
in_preparation
prepared
on_the_way
delivered
cancelled
rejected
closed
```

## Impresion

Recibo POS 58mm:

- Negocio
- Numero de pedido
- Fecha y hora
- Cliente si existe
- Productos
- Metodo de pago
- Total sin decimales

Etiqueta 80x130mm:

- Numero de pedido
- Nombre del cliente si existe
- Datos de envio cuando sea domicilio
- Productos a preparar
- Sabores y mitad/mitad
- Bordes, adiciones y notas
- QR o codigo de pedido en fase posterior

## Supabase

La migracion inicial crea las tablas principales y activa RLS en todas. Las politicas publicas solo permiten leer menu, promociones, ajustes visibles y paginas legales. Las operaciones internas se deben completar con acciones de servidor y politicas especificas por rol antes de produccion.

No usar `user_metadata` para permisos. Los roles viven en `user_roles` y deben administrarse desde servidor o desde el panel de administrador.
