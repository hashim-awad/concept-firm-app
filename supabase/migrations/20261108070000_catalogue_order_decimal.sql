-- Studio's Service Catalog "Order" column uses decimals (e.g. 51.5, an item slotted between
-- 51 and 52). The app stored the catalogue's sort order as a whole number, so the import
-- refused that row. Prices are not affected: they are stored in cents in item_prices.
alter table public.catalogue_items alter column sort_order type numeric(10,3) using sort_order::numeric;
