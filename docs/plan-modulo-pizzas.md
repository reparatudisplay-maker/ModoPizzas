# Plan Modulo Pizzas

## Objetivo

Crear y administrar pizzas por sabor, tamano, ingredientes, costo estimado, precio de venta, estado publico y disponibilidad segun inventario.

## Estructura Recomendada

Modulo: `Pizzas`

Subsecciones internas:

- `Sabores`
- `Tamanos`
- `Recetas`
- `Precios`
- `Disponibilidad`

## Flujo De Trabajo

1. Crear tamanos:
   - Porcion
   - Personal
   - Mediana
   - Grande
   - Otros configurables

2. Crear sabor:
   - Nombre, por ejemplo Hawaiana, Pepperoni, Pollo BBQ
   - Descripcion publica
   - Imagen opcional mas adelante
   - Alergenos
   - Visible en pagina publica: si/no
   - Activa: si/no

3. Armar receta por tamano:
   - Seleccionar sabor
   - Seleccionar tamano
   - Agregar productos desde inventario
   - Indicar cantidad usada
   - Solo mostrar productos activos
   - Alertar cuando un producto este agotado o con stock bajo

4. Calcular costo:
   - Cada producto usa su costo promedio desde compras
   - Formula base: `cantidad usada x costo promedio unitario`
   - Costo total de receta
   - Costo sugerido con merma opcional
   - Margen esperado

5. Asignar precio de venta:
   - Se asigna despues de tener receta y costo calculado
   - Precio manual sin decimales
   - Mostrar costo receta
   - Mostrar margen en pesos
   - Mostrar margen porcentual

6. Disponibilidad:
   - Disponible
   - Con stock bajo
   - No disponible
   - La disponibilidad puede afectar pagina publica y modulo de pedidos

## Reglas Importantes

- El precio de venta se define por tamano.
- Mitad y mitad cobra el sabor de mayor precio.
- La receta puede variar por tamano.
- Un mismo sabor puede tener ingredientes distintos segun tamano.
- El inventario no se descuenta al crear receta, solo al vender o preparar pedido.
- La receta sirve para calcular costo y luego descontar stock en ventas.
- El precio de venta definitivo debe definirse despues de calcular el costo de receta.
- Un precio manual provisional puede existir solo como borrador, pero no debe ser el flujo principal.

## Tablas Relacionadas

Ya existen bases que se pueden reutilizar:

- `pizza_flavors`
- `pizza_sizes`
- `pizza_flavor_prices`
- `recipes`
- `inventory_items`

Posibles ajustes o ampliaciones:

- `pizza_flavors`: sabor
- `pizza_sizes`: tamanos
- `recipes`: ingredientes por sabor/tamano
- `pizza_flavor_prices`: precio de venta por sabor/tamano

## Pantalla Recomendada

Ruta propuesta: `/panel/pizzas`

Vistas internas:

- `Sabores`
- `Tamanos`
- `Recetas`
- `Precios`

Para cada pizza se debe mostrar:

- Nombre del sabor
- Estado
- Visible al publico
- Tabla por tamano:
  - Tamano
  - Costo receta
  - Precio venta
  - Margen
  - Estado inventario
  - Editar receta

## Orden De Implementacion

1. Crear ruta `/panel/pizzas`.
2. Mover o conectar lo que ya existe en `/panel/menu`.
3. Crear interfaz de tamanos.
4. Crear interfaz de sabores.
5. Crear editor de receta por tamano.
6. Calcular costo automaticamente desde la receta.
7. Mostrar costo, costo con merma, margen y disponibilidad.
8. Crear editor de precio de venta por tamano.
9. Conectar con pedidos publicos y pedidos internos.
10. Descontar inventario al vender o preparar pedido.

## Recomendacion Inicial

El siguiente paso practico es construir primero `/panel/pizzas` con:

- Sabores
- Tamanos
- Recetas por tamano
- Calculo de costo

Luego agregar el editor de precios de venta, porque el precio debe apoyarse en el costo real de produccion.

## Ejemplo De Calculo

Pizza Pepperoni Mediana:

- Harina: 250 g
- Queso: 180 g
- Salsa: 80 ml
- Pepperoni: 120 g
- Caja: 1 unidad

El sistema calcula:

- Costo ingredientes: `$ 8.200`
- Costo empaque: `$ 900`
- Costo total: `$ 9.100`
- Merma 8%: `$ 728`
- Costo final estimado: `$ 9.828`

Luego se define:

- Precio venta: `$ 28.000`
- Ganancia estimada: `$ 18.172`
- Margen: `64,9%`
