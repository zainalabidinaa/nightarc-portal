/**
 * Client-side stream probe — mirrors Stremio's getContentType() approach.
 *
 * Uses a HEAD request (no body downloaded) to detect content-type from headers.
 * HEAD requests avoid CORS preflight issues that plague GET requests with custom
 * headers, and they work fine with IP-locked debrid redirects since they run in
 * the browser with the user's own session.
 *
 * If HEAD fails (405, timeout, CORS) → returns null → caller falls back to
 * URL-pattern heuristics and lets the player handle errors.
 */

export interface StreamProbeResult {
  /** Detected container/playlist type. */
  type: 'application/x-mpegurl' | 'video/mp4';
}

export async function probeStreamClient(
  url: string,
  options?: { headers?: Record<string, string>; timeoutMs?: number }
): Promise<StreamProbeResult | null> {
  const { headers: customHeaders, timeoutMs = 5000 } = options ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // HEAD request: just headers, no body — fast, no CORS preflight on simple requests
    const res = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
      headers: customHeaders ?? {},
    });

    if (!res.ok) return null;

    const ct = (res.headers.get('content-type') || '').toLowerCase();

    if (ct.includes('mpegurl') || ct.includes('x-mpegurl')) {
      return { type: 'application/x-mpegurl' };
    }

    // video/mp4, video/webm, video/x-*, application/octet-stream, etc.
    // If Content-Type is present and it's not HLS, treat as direct video
    if (ct.startsWith('video/') || ct.includes('mp4') || ct.includes('octet-stream')) {
      return { type: 'video/mp4' };
    }

    // Content-Type absent or generic — fall back to URL extension
    const lower = url.toLowerCase();
    if (lower.includes('.m3u8') || lower.includes('.m3u')) return { type: 'application/x-mpegurl' };
    if (lower.includes('.mp4')) return { type: 'video/mp4' };

    // Reachable but unidentified — assume MP4
    return { type: 'video/mp4' };
  } catch {
    // 405 Method Not Allowed, network error, abort — caller falls back to heuristics
    return null;
  } finally {
    clearTimeout(timer);
  }
}
