/**
 * Baileys' `getWAUploadToServer` (see `baileys/lib/Utils/messages-media.js`) only applies a
 * per-attempt upload timeout when the caller passes `mediaUploadTimeoutMs` through
 * `prepareWAMessageMedia`'s options — this fork's own call site never set it, so on the Node
 * runtime `uploadWithNodeHttp` calls `http.request({ timeout: undefined })`, which installs no
 * socket-inactivity timeout at all. A stalled proxy connection could hang indefinitely instead
 * of failing over to the next CDN host.
 *
 * Scale the timeout with payload size so small images don't wait 10 minutes to fail, and large
 * videos over a slow proxy aren't cut off before they can finish.
 */
const FLOOR_MS = 60_000;
const CAP_MS = 10 * 60_000;
const MS_PER_64KB = 1_000;
const BLOCK_SIZE_BYTES = 64 * 1024;

/**
 * @param byteLength Size of the content being uploaded, in bytes. Pass `undefined` when the
 * size isn't known upfront (e.g. a `{ url }` input Baileys downloads internally) — the cap is
 * used as a conservative ceiling in that case rather than under-timing a potentially large file.
 */
export function computeMediaUploadTimeoutMs(byteLength: number | undefined): number {
  if (byteLength === undefined || byteLength <= 0) {
    return CAP_MS;
  }

  const scaled = FLOOR_MS + Math.ceil(byteLength / BLOCK_SIZE_BYTES) * MS_PER_64KB;
  return Math.min(scaled, CAP_MS);
}
