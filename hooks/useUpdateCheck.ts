/**
 * useUpdateCheck — fetches the latest Cebian release from GitHub and compares
 * against the currently installed extension version.
 *
 * Result is cached in localStorage for 6 hours to avoid hitting the API on
 * every About-page mount. Call `recheck()` to force-refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { compareVersions, GITHUB_RELEASES_API_URL, releaseDownloadUrl, releaseVersion, selectDownloadableRelease } from '@/lib/github-releases';

const distribution = import.meta.env.FIREFOX ? 'firefox' : 'chrome';
const CACHE_KEY = `cebian:updateCheck:${GITHUB_RELEASES_API_URL}:${distribution}`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'upToDate'; current: string; latest: string }
  | { kind: 'updateAvailable'; current: string; latest: string; downloadUrl: string }
  | { kind: 'error' };

interface CacheEntry {
  checkedAt: number;
  tag: string;
}

function readCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry;
    if (typeof parsed.checkedAt !== 'number' || typeof parsed.tag !== 'string' || !releaseVersion(parsed.tag)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(entry: CacheEntry): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota / disabled storage
  }
}

function buildStatus(current: string, tag: string): UpdateStatus {
  const latest = releaseVersion(tag);
  return compareVersions(latest, current) > 0
    ? { kind: 'updateAvailable', current, latest, downloadUrl: releaseDownloadUrl(tag, distribution) }
    : { kind: 'upToDate', current, latest };
}

function initialStatus(current: string): UpdateStatus {
  const cached = readCache();
  if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
    return buildStatus(current, cached.tag);
  }
  return { kind: 'idle' };
}

export function useUpdateCheck() {
  const current = chrome.runtime.getManifest().version;
  const [status, setStatus] = useState<UpdateStatus>(() => initialStatus(current));
  const inflightRef = useRef(false);
  const mountedRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  const runCheck = useCallback(
    async (force: boolean) => {
      if (inflightRef.current) return;

      if (!force) {
        const cached = readCache();
        if (cached && Date.now() - cached.checkedAt < CACHE_TTL_MS) {
          if (mountedRef.current) setStatus(buildStatus(current, cached.tag));
          return;
        }
      }

      inflightRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      if (mountedRef.current) setStatus({ kind: 'checking' });
      try {
        const res = await fetch(GITHUB_RELEASES_API_URL, {
          headers: { Accept: 'application/vnd.github+json' },
          credentials: 'omit',
          cache: force ? 'no-store' : 'default',
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const tag = selectDownloadableRelease(await res.json(), distribution);
        if (!tag) throw new Error('No compatible downloadable release');
        writeCache({ checkedAt: Date.now(), tag });
        if (mountedRef.current) setStatus(buildStatus(current, tag));
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('[useUpdateCheck] update check failed:', err);
        if (mountedRef.current) setStatus({ kind: 'error' });
      } finally {
        inflightRef.current = false;
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [current],
  );

  useEffect(() => {
    mountedRef.current = true;
    void runCheck(false);
    return () => {
      mountedRef.current = false;
    };
  }, [runCheck]);

  const recheck = useCallback(() => runCheck(true), [runCheck]);

  return { status, current, recheck };
}

