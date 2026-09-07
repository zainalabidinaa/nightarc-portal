-- CatalogSourceEditor.tsx's addCatalog() has always inserted an `addon_id` on
-- folder_catalogs (to attribute a catalog source to the addon it was picked
-- from, and let the admin UI show a real addon name instead of "Unknown
-- addon"), but this column was never actually created — every insert
-- through that path has been silently failing. Nullable and set-null on
-- delete since this is portal-side bookkeeping only: the app itself matches
-- a catalog_id against whatever addons are installed at runtime and never
-- reads this column.
alter table public.folder_catalogs
  add column if not exists addon_id uuid references public.installed_addons(id) on delete set null;

create index if not exists folder_catalogs_addon_id_idx
  on public.folder_catalogs (addon_id)
  where addon_id is not null;
