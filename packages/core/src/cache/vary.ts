/**
 * Parse a Vary header value into normalised (lowercased) header names.
 * Returns ['*'] for Vary: * (meaning the response varies on everything).
 */
export function parseVaryHeader(
  varyHeader: string | null | undefined,
): Array<string> {
  if (!varyHeader) return [];
  const trimmed = varyHeader.trim();
  if (trimmed === '*') return ['*'];
  return trimmed
    .split(',')
    .map((f) => f.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Extract the values of Vary-listed headers from a request.
 * Stored alongside the cache entry so we can compare on lookup.
 */
export function captureVaryValues(
  varyFields: Array<string>,
  requestHeaders: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {};
  for (const field of varyFields) {
    // Normalise to lowercase for matching
    const lower = field.toLowerCase();
    values[lower] = requestHeaders[lower] ?? requestHeaders[field];
  }
  return values;
}

/**
 * Check whether a cached entry's Vary values match the current request.
 *
 * Returns false if:
 *  - Vary includes '*' (never matches — always revalidate)
 *  - Any Vary-listed header has a different value in the current request
 */
export function varyMatches(
  cachedVaryValues: Record<string, string | undefined> | undefined,
  cachedVaryHeader: string | undefined,
  currentRequestHeaders: Record<string, string | undefined>,
): boolean {
  if (!cachedVaryHeader) return true; // No Vary = always matches
  const fields = parseVaryHeader(cachedVaryHeader);
  if (fields.length === 0) return true;
  if (fields[0] === '*') return false; // Vary: * never matches

  if (!cachedVaryValues) return false; // Had Vary but no stored values — miss

  for (const field of fields) {
    const lower = field.toLowerCase();
    const cachedVal = cachedVaryValues[lower];
    const currentVal =
      currentRequestHeaders[lower] ?? currentRequestHeaders[field];
    if (cachedVal !== currentVal) return false;
  }
  return true;
}
