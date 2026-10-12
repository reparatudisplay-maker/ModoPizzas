begin;

update public.print_templates
set
  elements = $$[
    {"id":"kitchen-header","type":"field","field":"kitchen_header","visible":true,"align":"left","font_size":"normal","bold":true,"italic":false,"underline":false,"spacing_after":1},
    {"id":"kitchen-order","type":"field","field":"kitchen_order","visible":true,"align":"left","font_size":"normal","bold":false,"italic":false,"underline":false,"spacing_after":1},
    {"id":"kitchen-pizzas","type":"field","field":"kitchen_pizzas","visible":true,"align":"left","font_size":"normal","bold":false,"italic":false,"underline":false,"spacing_after":1},
    {"id":"kitchen-delivery","type":"field","field":"kitchen_delivery","visible":true,"align":"left","font_size":"normal","bold":true,"italic":false,"underline":false,"spacing_after":1},
    {"id":"kitchen-summary","type":"field","field":"kitchen_summary","visible":true,"align":"left","font_size":"small","bold":false,"italic":false,"underline":false,"spacing_after":0}
  ]$$::jsonb,
  updated_at = now()
where kind = 'kitchen'
  and elements = '[]'::jsonb;

update public.print_templates
set
  elements = $$[
    {"id":"receipt-header","type":"field","field":"receipt_header","visible":true,"align":"center","font_size":"normal","bold":true,"italic":false,"underline":false,"spacing_after":1},
    {"id":"receipt-order","type":"field","field":"receipt_order","visible":true,"align":"center","font_size":"small","bold":false,"italic":false,"underline":false,"spacing_after":1},
    {"id":"receipt-items","type":"field","field":"receipt_items","visible":true,"align":"left","font_size":"normal","bold":false,"italic":false,"underline":false,"spacing_after":1},
    {"id":"receipt-totals","type":"field","field":"receipt_totals","visible":true,"align":"left","font_size":"normal","bold":true,"italic":false,"underline":false,"spacing_after":1},
    {"id":"receipt-payment","type":"field","field":"receipt_payment","visible":true,"align":"left","font_size":"normal","bold":false,"italic":false,"underline":false,"spacing_after":1},
    {"id":"receipt-footer","type":"field","field":"receipt_footer","visible":true,"align":"center","font_size":"small","bold":false,"italic":false,"underline":false,"spacing_after":0}
  ]$$::jsonb,
  updated_at = now()
where kind = 'receipt'
  and elements = '[]'::jsonb;

notify pgrst, 'reload schema';

commit;
