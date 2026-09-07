import { useCallback, useEffect, useRef, useState } from 'react';
import type { InstalledAddon } from '../types';

export const AIO_MANIFEST_URL =
  'https://aiometadata.fortheweak.cloud/stremio/1bf2cd94-2057-4992-9ed7-a8464f12e4a4/manifest.json';

export interface ManifestCatalog {
  id: string;
  type: string;
  name: string;
  genres: string[];
  genreRequired: boolean;
}

interface ManifestState {
  name: string;
  catalogs: ManifestCatalog[];
  fetchedAt: Date;
  catalogCount: number;
}

function parseCatalogs(raw: any[]): ManifestCatalog[] {
  return raw
    .map((c) => {
      const genreExtra = (c.extra ?? []).find((e: any) => e.name === 'genre');
      return {
        id: c.id as string,
        type: c.type as string,
        name: c.name as string,
        genres: (genreExtra?.options ?? []).filter((g: string) => g !== 'None'),
        genreRequired: genreExtra?.isRequired === true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function useAddonManifest(url = AIO_MANIFEST_URL) {
  const [state, setState] = useState<ManifestState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasUpdate, setHasUpdate] = useState(false);
  const prevCount = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch_ = useCallback(async (isPolled = false) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const catalogs = parseCatalogs(json.catalogs ?? []);
      const count = catalogs.length;

      if (isPolled && prevCount.current !== null && count !== prevCount.current) {
        setHasUpdate(true);
      }
      prevCount.current = count;

      setState({ name: json.name ?? 'Addon', catalogs, fetchedAt: new Date(), catalogCount: count });
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [url]);

  const refresh = useCallback(() => {
    setHasUpdate(false);
    setLoading(true);
    fetch_(false);
  }, [fetch_]);

  useEffect(() => {
    fetch_(false);
    timerRef.current = setInterval(() => fetch_(true), 5 * 60 * 1000); // poll every 5 min
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetch_]);

  const catalogById = useCallback(
    (id: string) => state?.catalogs.find((c) => c.id === id) ?? null,
    [state],
  );

  return { manifest: state, loading, error, hasUpdate, refresh, catalogById };
}

/**
 * Fetches every distinct addon a folder's catalogs actually reference, so
 * each row can show its own real catalog name and staleness — instead of
 * `useAddonManifest`'s single active manifest, which only matches whichever
 * addon happens to be selected in the picker and leaves every other row's
 * catalog id shown raw (e.g. "streaming_netflix_originals_series" instead of
 * "Netflix Originals").
 */
export function useAllAddonManifests(addons: InstalledAddon[] | undefined) {
  const [byAddonId, setByAddonId] = useState<Record<string, ManifestCatalog[]>>({});
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const urlsKey = (addons ?? []).map((a) => `${a.id}:${a.addon_url}`).join(',');

  useEffect(() => {
    if (!addons || addons.length === 0) { setByAddonId({}); return; }
    let cancelled = false;
    setLoadingIds(new Set(addons.map((a) => a.id)));

    Promise.all(addons.map(async (a) => {
      try {
        const res = await fetch(a.addon_url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        return [a.id, parseCatalogs(json.catalogs ?? [])] as const;
      } catch {
        return [a.id, null] as const;
      }
    })).then((results) => {
      if (cancelled) return;
      const next: Record<string, ManifestCatalog[]> = {};
      for (const [id, catalogs] of results) {
        if (catalogs) next[id] = catalogs;
      }
      setByAddonId(next);
      setLoadingIds(new Set());
    });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsKey]);

  const catalogFor = useCallback(
    (addonId: string | null | undefined, catalogId: string): ManifestCatalog | null => {
      if (!addonId) return null;
      return byAddonId[addonId]?.find((c) => c.id === catalogId) ?? null;
    },
    [byAddonId],
  );

  return { catalogFor, loadingIds };
}
