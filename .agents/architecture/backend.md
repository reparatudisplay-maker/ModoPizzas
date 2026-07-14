# Arquitectura backend

## Principios

- Toda mutación crítica debe validarse y autorizarse en servidor.
- No confiar en datos de rol enviados por el cliente.
- No exponer service role.
- Usar transacciones o funciones SQL cuando varias escrituras deban ser atómicas.

## Mutaciones

Cada mutación debe:

1. autenticar;
2. autorizar;
3. validar entrada;
4. ejecutar;
5. manejar duplicados;
6. devolver error útil;
7. invalidar o actualizar interfaz.

## Idempotencia

Aplicar en:

- creación de pedidos;
- pagos;
- descuentos de inventario;
- anulaciones;
- recepciones de compra.

Preferir:

- claves idempotentes;
- restricciones únicas;
- validación transaccional;
- transiciones de estado válidas.

## Errores

- No exponer SQL ni stack traces.
- Registrar contexto técnico en servidor.
- Mostrar mensajes claros al usuario.
