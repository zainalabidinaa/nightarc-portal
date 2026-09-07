import { useMemo, useState } from 'react';
import type { FolderCatalog, InstalledAddon } from '../../types';
import { useAddonManifest, useAllAddonManifests, AIO_MANIFEST_URL } from '../../hooks/useAddonManifest';
import { useCatalogPreview, useCatalogHealth } from '../../hooks/useCatalogPreview';
import { Button } from '../ui/Button';

interface Props {
  catalogs: FolderCatalog[];
  onAdd: (catalogId: string, mediaType: string, genre: string | null, addonId: string | null) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  /** When provided, the user picks which of their own addons to browse.
   *  Omitted by the admin CatalogPage, which browses the shared AIOMetadata
   *  config exactly as before. */
  addons?: InstalledAddon[];
}

// Fallback when an addon has no `addon_name` set — the hostname alone reads
// far better than the raw manifest URL, which for a signed/token-scoped
// manifest can run to hundreds of characters (a JWT in the path).
function shortenAddonUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function CatalogSourceEditor({ catalogs, onAdd, onDelete, addons }: Props) {
  const [selectedAddonId, setSelectedAddonId] = useState<string>(addons?.[0]?.id ?? '');
  const activeAddon = addons?.find((a) => a.id === selectedAddonId) ?? null;
  const manifestUrl = addons ? (activeAddon?.addon_url ?? '') : AIO_MANIFEST_URL;
  const { manifest, loading, error, hasUpdate, refresh, catalogById } = useAddonManifest(manifestUrl);
  // Every existing row's own addon (not just whichever one is selected in the
  // picker above) — lets each row show its real catalog name/staleness.
  const { catalogFor: catalogForRow } = useAllAddonManifests(addons);

  const [search, setSearch] = useState('');
  const [selectedCatalogId, setSelectedCatalogId] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [adding, setAdding] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // Manual entry, for catalog ids the manifest doesn't (and can't) list —
  // e.g. `tmdb.upcoming`, served by Moonlit itself rather than the addon.
  // Without this there was no way to attach one short of a direct DB insert.
  const [customMode, setCustomMode] = useState(false);
  const [customCatalogId, setCustomCatalogId] = useState('');
  const [customType, setCustomType] = useState('series');
  const [customGenre, setCustomGenre] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);

  async function handleAddCustom() {
    const id = customCatalogId.trim();
    if (!id) return;
    setAddingCustom(true);
    await onAdd(id, customType, customGenre.trim() || null, activeAddon?.id ?? null);
    setCustomCatalogId('');
    setCustomGenre('');
    setCustomMode(false);
    setShowPicker(false);
    setAddingCustom(false);
  }

  const selectedCatalog = manifest?.catalogs.find((c) => c.id === selectedCatalogId) ?? null;

  const filteredCatalogs = useMemo(() => {
    if (!manifest) return [];
    const q = search.toLowerCase();
    return manifest.catalogs.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.type.includes(q) || c.id.includes(q),
    );
  }, [manifest, search]);

  async function handleAdd() {
    if (!selectedCatalogId || !selectedCatalog) return;
    const genreRequired = selectedCatalog.genreRequired;
    if (genreRequired && !selectedGenre) return;
    setAdding(true);
    await onAdd(selectedCatalogId, selectedCatalog.type, selectedGenre || null, activeAddon?.id ?? null);
    setSelectedCatalogId('');
    setSelectedGenre('');
    setSearch('');
    setShowPicker(false);
    setAdding(false);
  }

  return (
    <div>
      {/* header */}
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="rounded-full border border-accent/40 bg-accent-light px-3 py-1 font-mono text-[11px] font-semibold text-accent">
            AIOMetadata
          </span>
          {loading && <span className="font-mono text-[11px] text-faint animate-pulse">Loading manifest…</span>}
          {error && <span className="font-mono text-[11px] text-red-400">Manifest error: {error}</span>}
          {!loading && manifest && (
            <span className="font-mono text-[11px] text-faint">
              {manifest.catalogCount} catalogs · refreshed {manifest.fetchedAt.toLocaleTimeString()}
            </span>
          )}
          {hasUpdate && (
            <span className="rounded-full bg-accent px-2 py-0.5 font-mono text-[10px] font-bold text-[#2a1206]">
              UPDATED
            </span>
          )}
        </div>
        <button
          onClick={refresh}
          className="font-mono text-[11px] text-faint hover:text-accent transition-colors"
          title="Re-fetch manifest now"
        >
          ↺ refresh
        </button>
      </div>

      {/* existing catalog entries */}
      {catalogs.length > 0 && (
        <div className="mb-4 grid gap-2">
          {catalogs.map((c) => {
            const sourceAddon = addons?.find((a) => a.id === c.addon_id) ?? null;
            // Prefer this row's own addon manifest (works regardless of what's
            // selected in the picker); fall back to the single active/AIO
            // manifest for legacy rows with no addon_id recorded.
            const ownMeta = catalogForRow(c.addon_id, c.catalog_id);
            const meta = c.addon_id ? ownMeta : catalogById(c.catalog_id);
            const checkable = c.addon_id
              ? true
              : !loading && !error && manifest !== null && (!addons || !sourceAddon);
            return (
              <SourceRow
                key={c.id}
                catalog={c}
                displayName={meta?.name ?? c.catalog_id}
                addonName={sourceAddon?.addon_name ?? shortenAddonUrl(sourceAddon?.addon_url) ?? null}
                addonUrl={sourceAddon?.addon_url ?? (addons ? null : AIO_MANIFEST_URL)}
                isStale={checkable ? meta === null : null}
                // `genre === 'None'` is Moonlit's "no genre selected" sentinel
                // (see the genre <select>'s "None" option above) — a required
                // genre with that value is exactly the `trakt.anticipated.shows`
                // situation: the addon silently drops nearly everything.
                genreRequiredButUnset={!!meta?.genreRequired && (!c.genre || c.genre === 'None')}
                onDelete={onDelete}
              />
            );
          })}
        </div>
      )}

      {/* add new */}
      {!showPicker ? (
        <button
          onClick={() => setShowPicker(true)}
          disabled={loading || !!error}
          className="w-full rounded-2xl border border-dashed border-border py-4 text-sm text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
        >
          + Add catalog source
        </button>
      ) : (
        <div className="rounded-2xl border border-accent/20 bg-surface-2 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted">
              {customMode ? 'Custom catalog id' : 'Select catalog'}
            </p>
            <button
              onClick={() => setCustomMode((v) => !v)}
              className="font-mono text-[10px] text-faint hover:text-accent transition-colors"
            >
              {customMode ? '← back to search' : "can't find it? add by id"}
            </button>
          </div>

          {customMode ? (
            <div>
              <p className="mb-3 text-xs text-muted">
                For a catalog id the manifest doesn't list — e.g. a Moonlit-served synthetic
                source like <code className="text-accent">tmdb.upcoming</code>, not an
                AIOMetadata catalog.
              </p>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-muted">
                Catalog id
              </label>
              <input
                type="text"
                placeholder="tmdb.upcoming"
                value={customCatalogId}
                onChange={(e) => setCustomCatalogId(e.target.value)}
                className="mb-3 w-full rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent placeholder:text-faint"
              />
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-muted">
                Type
              </label>
              <select
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                className="mb-3 w-full rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent"
              >
                <option value="movie">movie</option>
                <option value="series">series</option>
                <option value="all">all</option>
              </select>
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-muted">
                Genre (optional)
              </label>
              <input
                type="text"
                placeholder="None"
                value={customGenre}
                onChange={(e) => setCustomGenre(e.target.value)}
                className="mb-3 w-full rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent placeholder:text-faint"
              />
              <div className="flex gap-2">
                <Button size="sm" loading={addingCustom} disabled={!customCatalogId.trim()} onClick={handleAddCustom}>
                  Add source
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setShowPicker(false); setCustomMode(false); }}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
          <>
          {addons && (
            <div className="mb-3">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-muted">
                Addon
              </label>
              <select
                value={selectedAddonId}
                onChange={(e) => { setSelectedAddonId(e.target.value); setSelectedCatalogId(''); }}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent"
              >
                {addons.length === 0 && <option value="">No add-ons installed</option>}
                {addons.map((a) => (
                  <option key={a.id} value={a.id}>{a.addon_name ?? a.addon_url}</option>
                ))}
              </select>
            </div>
          )}

          {/* search */}
          <input
            type="text"
            placeholder="Search 1174 catalogs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="mb-2 w-full rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent placeholder:text-faint"
          />

          {/* catalog list */}
          <div className="mb-3 h-52 overflow-y-auto rounded-xl border border-border bg-bg">
            {filteredCatalogs.length === 0 ? (
              <p className="py-6 text-center font-mono text-[11px] text-faint">No catalogs match</p>
            ) : (
              filteredCatalogs.map((c) => (
                <button
                  key={`${c.type}:${c.id}`}
                  onClick={() => { setSelectedCatalogId(c.id); setSelectedGenre(''); }}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2 ${
                    selectedCatalogId === c.id ? 'bg-accent-light' : ''
                  }`}
                >
                  <span className={`flex-none rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                    c.type === 'movie' ? 'bg-cyan/10 text-cyan' :
                    c.type === 'series' ? 'bg-magenta/10 text-magenta' :
                    'bg-accent/10 text-accent'
                  }`}>{c.type}</span>
                  <span className="flex-1 truncate text-[12px] text-text">{c.name}</span>
                  {selectedCatalogId === c.id && <span className="text-accent text-xs">✓</span>}
                </button>
              ))
            )}
          </div>

          {/* genre filter — shown only when catalog is selected and has genres */}
          {selectedCatalog && selectedCatalog.genres.length > 0 && (
            <div className="mb-3">
              <label className="mb-1.5 block font-mono text-[10px] uppercase tracking-widest text-muted">
                Genre filter{selectedCatalog.genreRequired ? ' (required)' : ''}
              </label>
              <select
                value={selectedGenre}
                onChange={(e) => setSelectedGenre(e.target.value)}
                className="w-full rounded-xl border border-border bg-bg px-3 py-2 font-mono text-[12px] text-text outline-none focus:border-accent"
              >
                <option value="">None</option>
                {[...selectedCatalog.genres].sort().map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
              {selectedCatalog.genreRequired && !selectedGenre && (
                <p className="mt-1 font-mono text-[10px] text-red-400">This catalog requires a genre selection</p>
              )}
            </div>
          )}

          <div className="flex gap-2">
            <Button
              size="sm"
              loading={adding}
              disabled={!selectedCatalogId || (selectedCatalog?.genreRequired && !selectedGenre)}
              onClick={handleAdd}
            >
              Add source
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowPicker(false); setSearch(''); setSelectedCatalogId(''); }}>
              Cancel
            </Button>
          </div>
          </>
          )}
        </div>
      )}
    </div>
  );
}

interface SourceRowProps {
  catalog: FolderCatalog;
  displayName: string;
  addonName: string | null;
  addonUrl: string | null;
  /** null = the check could not run (manifest still loading or unreachable). */
  isStale: boolean | null;
  /** True when the addon marks this catalog's genre filter required and the
   *  folder source has none set — the addon then silently returns almost
   *  nothing rather than erroring, so this can't be seen from the item count
   *  alone once it's already low. */
  genreRequiredButUnset: boolean;
  onDelete: (id: string) => Promise<void>;
}

export function SourceRow({ catalog, displayName, addonName, addonUrl, isStale, genreRequiredButUnset, onDelete }: SourceRowProps) {
  const [expanded, setExpanded] = useState(false);
  const { items, loading, error } = useCatalogPreview(
    addonUrl, catalog.media_type, catalog.catalog_id, expanded,
  );
  // Probed once on mount, independent of `expanded` — the whole point is
  // making a dead catalog visible without the admin needing to dig for it.
  const health = useCatalogHealth(addonUrl, catalog.media_type, catalog.catalog_id);

  return (
    <div className="rounded-xl border border-border bg-surface-2 px-4 py-3">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-none font-mono text-[11px] text-faint hover:text-accent"
          aria-label={expanded ? 'Hide preview' : 'Show preview'}
        >
          {expanded ? '▾' : '▸'}
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-text truncate">{displayName}</p>
          <p className="font-mono text-[10px] text-faint">
            {catalog.catalog_id}
            <span className="ml-2 text-muted">{addonName ?? 'Unknown addon'}</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-none">
          {isStale === true && (
            <span className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-red-400/10 text-red-400">
              stale
            </span>
          )}
          {health.status === 'ok' && (
            <span
              title={`Addon returned ${health.count} item${health.count === 1 ? '' : 's'} for this catalog`}
              className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${
                health.count === 0 ? 'bg-red-400/10 text-red-400' :
                health.count < 10 ? 'bg-amber-400/10 text-amber-400' :
                'bg-green-400/10 text-green-400'
              }`}
            >
              {health.count} items
            </span>
          )}
          {genreRequiredButUnset && (
            <span
              title="This catalog requires a genre filter and the source has none set — the addon returns almost nothing without one"
              className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-amber-400/10 text-amber-400"
            >
              genre required
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${
            catalog.media_type === 'movie' ? 'bg-cyan/10 text-cyan' :
            catalog.media_type === 'series' ? 'bg-magenta/10 text-magenta' :
            'bg-accent/10 text-accent'
          }`}>{catalog.media_type}</span>
          {catalog.genre && (
            <span className="rounded px-1.5 py-0.5 font-mono text-[9px] bg-surface border border-border text-muted">
              {catalog.genre}
            </span>
          )}
          <button
            onClick={() => onDelete(catalog.id)}
            className="ml-1 font-mono text-[11px] text-faint hover:text-red-400 transition-colors"
          >
            ✕
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 border-t border-border pt-3">
          {loading && <p className="font-mono text-[10px] text-faint">Loading preview…</p>}
          {error && <p className="font-mono text-[10px] text-red-400">Preview failed: {error}</p>}
          {items && items.length === 0 && (
            <p className="font-mono text-[10px] text-faint">Catalog returned no items</p>
          )}
          {items && items.length > 0 && (
            <div className="flex gap-2 overflow-x-auto">
              {items.map((it) => (
                <div key={it.id} className="w-16 flex-none">
                  {it.poster
                    ? <img src={it.poster} alt={it.name} className="w-16 rounded" />
                    : <div className="h-24 w-16 rounded bg-surface" />}
                  <p className="mt-1 truncate font-mono text-[9px] text-faint">{it.name}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
