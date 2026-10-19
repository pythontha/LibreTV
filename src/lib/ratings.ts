/** Shared identity and sorting rules; this file contains no server-only imports. */
export interface RatingQuery { title: string; year?: string }
export interface DoubanRating {
  id: string;
  title: string;
  year: string;
  score: number;
  count: number;
  checkedAt: string;
}
export interface RatingResult {
  query: RatingQuery;
  rating: DoubanRating | null;
  status: 'matched' | 'unmatched' | 'unavailable';
}
export interface RatingCandidate { id: string; title: string; year: string; alias?: string; episode?: string }

function seasonNumber(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const digits = '零一二三四五六七八九';
  if (value === '两') return 2;
  if (value.includes('十')) {
    const [tens, ones] = value.split('十');
    return (tens ? digits.indexOf(tens) : 1) * 10 + (ones ? digits.indexOf(ones) : 0);
  }
  return digits.indexOf(value);
}

export function titleIdentity(title: string) {
  let text = title.normalize('NFKC').toLowerCase().trim();
  // Only remove known language/quality suffixes; commentary, trailers and editions stay distinct.
  text = text.replace(/[（(]?(?:国语|粤语|英语|中字|高清|4k|1080p)[）)]?$/i, '').trim();
  let season: number | undefined;
  text = text.replace(/第([零一二三四五六七八九十两\d]+)季|\bseason\s*(\d+)\b|\bs(\d{1,2})\b/gi, (_, cn, en, short) => {
    season = seasonNumber(cn ?? en ?? short);
    return '';
  });
  const base = text.replace(/[^\p{L}\p{N}]/gu, '');
  return { base, season, key: `${base}|${season ?? ''}` };
}

export function ratingKey(query: RatingQuery): string {
  return `${titleIdentity(query.title).key}|${/^(18|19|20|21)\d{2}$/.test(query.year ?? '') ? query.year : ''}`;
}

/** Exact title/alias + exact year when supplied. Never silently pick a different season. */
export function matchRatingCandidate(query: RatingQuery, candidates: RatingCandidate[]): RatingCandidate | null {
  const wanted = titleIdentity(query.title);
  const matches = candidates.filter((c) => {
    if (!/^\d+$/.test(c.id) || (query.year && query.year !== c.year)) return false;
    return [c.title, c.alias].filter(Boolean).some((name) => {
      const found = titleIdentity(name!);
      if (wanted.base !== found.base) return false;
      if (wanted.season !== undefined) return wanted.season === found.season;
      // A source may omit “第一季”, but only an explicit year can disambiguate it.
      return found.season === undefined || Boolean(query.year);
    });
  });
  const unique = [...new Map(matches.map((c) => [c.id, c])).values()];
  return unique.length === 1 ? unique[0] : null;
}

export function filterRatedGroups<T extends { name: string; year?: string }>(
  groups: T[], ratings: Map<string, RatingResult>, sort: 'relevance' | 'rating', minimum: number
): T[] {
  const score = (group: T) => ratings.get(ratingKey({ title: group.name, year: group.year }))?.rating?.score;
  const filtered = groups.filter((g) => !minimum || (score(g) ?? -1) >= minimum);
  return sort === 'rating' ? [...filtered].sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1)) : filtered;
}

export function parseRatingQueries(body: unknown): RatingQuery[] | null {
  if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items)) return null;
  if (!body.items.length || body.items.length > 12) return null;
  const items: RatingQuery[] = [];
  for (const item of body.items) {
    if (!item || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 120) return null;
    if (item.year !== undefined && (typeof item.year !== 'string' || !/^(?:18|19|20|21)\d{2}$/.test(item.year))) return null;
    items.push({ title: item.title.trim(), ...(item.year ? { year: item.year } : {}) });
  }
  return items;
}
