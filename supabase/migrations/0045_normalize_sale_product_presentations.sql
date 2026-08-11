with normalized_references as (
  select
    id,
    case
      when presentation_unit = 'l' then presentation_quantity * 1000
      when presentation_unit = 'kg' then presentation_quantity * 1000
      when presentation_unit = 'ml' and presentation_quantity > 0 and presentation_quantity < 10 then presentation_quantity * 1000
      when presentation_unit = 'g' and presentation_quantity > 0 and presentation_quantity < 10 then presentation_quantity * 1000
      else presentation_quantity
    end as normalized_quantity,
    case
      when presentation_unit in ('l', 'ml') then 'ml'::public.stock_unit
      when presentation_unit in ('kg', 'g') then 'g'::public.stock_unit
      else presentation_unit
    end as normalized_unit
  from public.inventory_items
  where item_kind in ('sale_product', 'supply')
    and presentation_quantity is not null
    and presentation_unit in ('g', 'kg', 'ml', 'l')
)
update public.inventory_items item
set
  presentation_quantity = normalized_references.normalized_quantity,
  presentation_unit = normalized_references.normalized_unit
from normalized_references
where item.id = normalized_references.id
  and (
    item.presentation_quantity is distinct from normalized_references.normalized_quantity
    or item.presentation_unit is distinct from normalized_references.normalized_unit
  );

with normalized_purchase_lines as (
  select
    pi.id,
    case
      when pi.presentation_unit = 'l' then pi.presentation_quantity * 1000
      when pi.presentation_unit = 'kg' then pi.presentation_quantity * 1000
      when pi.presentation_unit = 'ml' and pi.presentation_quantity > 0 and pi.presentation_quantity < 10 then pi.presentation_quantity * 1000
      when pi.presentation_unit = 'g' and pi.presentation_quantity > 0 and pi.presentation_quantity < 10 then pi.presentation_quantity * 1000
      else pi.presentation_quantity
    end as normalized_quantity,
    case
      when pi.presentation_unit in ('l', 'ml') then 'ml'::public.stock_unit
      when pi.presentation_unit in ('kg', 'g') then 'g'::public.stock_unit
      else pi.presentation_unit
    end as normalized_unit
  from public.purchase_items pi
  join public.inventory_items ii on ii.id = pi.inventory_item_id
  where ii.item_kind in ('sale_product', 'supply')
    and pi.presentation_quantity is not null
    and pi.presentation_unit in ('g', 'kg', 'ml', 'l')
)
update public.purchase_items line
set
  presentation_quantity = normalized_purchase_lines.normalized_quantity,
  presentation_unit = normalized_purchase_lines.normalized_unit
from normalized_purchase_lines
where line.id = normalized_purchase_lines.id
  and (
    line.presentation_quantity is distinct from normalized_purchase_lines.normalized_quantity
    or line.presentation_unit is distinct from normalized_purchase_lines.normalized_unit
  );

notify pgrst, 'reload schema';
