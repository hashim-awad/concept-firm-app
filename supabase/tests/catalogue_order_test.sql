-- Local test: the catalogue accepts Studio's decimal Order values (e.g. 51.5).
\set ON_ERROR_STOP 1
select test.check('decimal sort order accepted', test.try($$insert into public.catalogue_items (service_line_id, code, name, sort_order)
  select id, 'PTX-999', 'Dummy service', 51.5 from public.service_lines where key = 'corporate'$$) = 'OK');
select test.check('kept as 51.5', (select sort_order from public.catalogue_items where code = 'PTX-999') = 51.5);
