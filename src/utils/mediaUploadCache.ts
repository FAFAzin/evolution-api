import { createHash } from 'crypto';

/**
 * Per-instance cache for uploaded WhatsApp media.
 *
 * Baileys' own `prepareWAMessageMedia` ships a `mediaCache` option, but it only
 * engages when the media input is a `{ url }` object (see `cacheableKey` in
 * `baileys/lib/Utils/messages.js`) and keys strictly by that URL string — it never
 * looks at content bytes. This fork sends funnel media as raw Buffers (base64
 * decoded), so Baileys' cache never triggers and every send re-encrypts and
 * re-uploads the whole file to WhatsApp's media CDN, even when the exact same
 * content was just sent to the previous contact.
 *
 * This module reimplements the same idea Baileys uses for its own cache hits
 * (decode a previously-encoded `proto.Message`, then apply the per-message
 * fields on top) but keys by a content hash so Buffer inputs are covered too,
 * and scopes everything per WhatsApp instance so uploads are never shared
 * across tenants.
 */

/** Generic insertion-ordered map with a TTL per entry and a hard entry cap (LRU-ish: reading refreshes recency). */
class TtlLruMap<V> {
  private readonly store = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  get(key: string): V | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= this.now()) {
      this.store.delete(key);
      return undefined;
    }

    // Refresh recency for a simple LRU eviction order.
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V): void {
    this.store.delete(key);
    this.store.set(key, { value, expiresAt: this.now() + this.ttlMs });

    while (this.store.size > this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.store.delete(oldestKey);
    }
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }
}

export interface MediaUploadCacheStats {
  hits: number;
  misses: number;
  bytesSaved: number;
  invalidations: number;
}

export interface MediaUploadCacheOptions {
  /** Time-to-live for a cached upload, in milliseconds. */
  ttlMs: number;
  /** Hard cap on the number of cached entries (per instance). */
  maxEntries?: number;
  /** Whether the cache is active at all (the kill switch). When false, get() always misses and set() is a no-op. */
  enabled?: boolean;
  /** Minimum interval between two INFO summary log lines, in milliseconds. */
  summaryIntervalMs?: number;
  /** Injectable clock, for tests. */
  now?: () => number;
}

const DEFAULT_MAX_ENTRIES = 500;
const DEFAULT_SUMMARY_INTERVAL_MS = 30 * 60 * 1000;

/**
 * Holds the encoded `proto.Message` bytes Baileys produced for a previous
 * upload (the same shape Baileys itself caches: url, directPath, mediaKey,
 * fileSha256, fileEncSha256, fileLength, mediaKeyTimestamp, plus
 * duration/waveform/thumbnail when present), keyed by content hash.
 */
export class MediaUploadCache {
  private readonly store: TtlLruMap<Buffer>;
  private readonly enabled: boolean;
  private readonly summaryIntervalMs: number;
  private readonly now: () => number;
  private lastSummaryAt = 0;
  private lastSummaryStats: MediaUploadCacheStats = { hits: 0, misses: 0, bytesSaved: 0, invalidations: 0 };

  public readonly stats: MediaUploadCacheStats = { hits: 0, misses: 0, bytesSaved: 0, invalidations: 0 };

  constructor(options: MediaUploadCacheOptions) {
    this.enabled = options.enabled ?? true;
    this.now = options.now ?? (() => Date.now());
    this.summaryIntervalMs = options.summaryIntervalMs ?? DEFAULT_SUMMARY_INTERVAL_MS;
    this.store = new TtlLruMap<Buffer>(options.ttlMs, options.maxEntries ?? DEFAULT_MAX_ENTRIES, this.now);
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  /** Returns the cached encoded proto.Message bytes for this key, or undefined on a miss. `contentSize` is only used to track bytesSaved. */
  public get(key: string, contentSize = 0): Buffer | undefined {
    if (!this.enabled) return undefined;

    const hit = this.store.get(key);
    if (hit) {
      this.stats.hits++;
      this.stats.bytesSaved += contentSize;
    } else {
      this.stats.misses++;
    }
    return hit;
  }

  public set(key: string, protoBytes: Buffer): void {
    if (!this.enabled) return;
    this.store.set(key, protoBytes);
  }

  public delete(key: string): void {
    const existed = this.store.delete(key);
    if (existed) this.stats.invalidations++;
  }

  public size(): number {
    return this.store.size;
  }

  /**
   * Returns a one-line summary for the caller to log at INFO, throttled to at
   * most once per `summaryIntervalMs`, and only when something happened since
   * the last summary. Returns null when there is nothing to say yet.
   */
  public maybeSummarize(instanceName: string): string | null {
    const now = this.now();
    if (now - this.lastSummaryAt < this.summaryIntervalMs) return null;

    const { hits, misses, bytesSaved, invalidations } = this.stats;
    const unchanged =
      hits === this.lastSummaryStats.hits &&
      misses === this.lastSummaryStats.misses &&
      bytesSaved === this.lastSummaryStats.bytesSaved &&
      invalidations === this.lastSummaryStats.invalidations;
    if (unchanged) return null;

    this.lastSummaryAt = now;
    this.lastSummaryStats = { hits, misses, bytesSaved, invalidations };

    const savedMB = (bytesSaved / (1024 * 1024)).toFixed(1);
    return `[media-cache] inst=${instanceName} hits=${hits} misses=${misses} savedMB=${savedMB} invalidations=${invalidations}`;
  }
}

/** Small helper to remember which cache key a recently-sent message used, so a `messages.media-update` retry request (WA asking us to re-upload) can invalidate the right entry even though it only carries a message key, not the content hash. */
export class RecentSendKeyMap {
  private readonly store: TtlLruMap<string>;

  constructor(ttlMs: number, maxEntries = DEFAULT_MAX_ENTRIES, now?: () => number) {
    this.store = new TtlLruMap<string>(ttlMs, maxEntries, now);
  }

  public track(messageId: string, cacheKey: string): void {
    if (!messageId) return;
    this.store.set(messageId, cacheKey);
  }

  public resolve(messageId: string): string | undefined {
    return this.store.get(messageId);
  }
}

export function hashBuffer(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface MediaCacheKeyParams {
  mediaType: string;
  /** Content hash (preferred) or, for `{ url }` inputs the code doesn't already download, the URL string itself. */
  identity: string;
  /** Anything else that changes the uploaded bytes for the same content, e.g. ptt/encoding for audio. */
  variant?: string;
}

export function buildMediaCacheKey({ mediaType, identity, variant }: MediaCacheKeyParams): string {
  return variant ? `${mediaType}:${variant}:${identity}` : `${mediaType}:${identity}`;
}

/** Identity for a media input that is either a URL string or a base64-encoded payload. Callers that already downloaded URL bytes should hash those instead of calling this. */
export function identityForBase64OrUrl(mediaOrUrl: string, isUrl: boolean): string {
  if (isUrl) return `url:${mediaOrUrl}`;
  return `sha256:${hashBuffer(Buffer.from(mediaOrUrl, 'base64'))}`;
}
