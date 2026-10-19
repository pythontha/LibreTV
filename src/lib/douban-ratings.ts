import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { matchRatingCandidate, ratingKey, type RatingQuery, type RatingResult, type RatingCandidate } from './ratings';

const UA = 'Mozilla/5.0';
const inflight = new Map<string, Promise<Omit<RatingResult, 'query'>>>();
let active = 0;
const waiting: Array<() => void> = [];

async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (active >= 3) {
    if (waiting.length >= 80) throw new Error('评分请求繁忙');
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else active++;
  try { return await job(); }
  finally {
    const next = waiting.shift();
    if (next) next(); // Transfer this slot directly to the next waiter.
    else active--;
  }
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetchUpstream(url, {
    timeoutMs: 6000,
    headers: { 'User-Agent': UA, Referer: 'https://m.douban.com/', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Douban HTTP ${res.status}`);
  return res.json();
}

interface Subject {
  id?: string; title?: string; year?: string; type?: string;
  rating?: { value?: number; count?: number; max?: number };
}

async function lookup(query: RatingQuery): Promise<Omit<RatingResult, 'query'>> {
  const raw = await getJson(`https://movie.douban.com/j/subject_suggest?q=${encodeURIComponent(query.title)}`);
  if (!Array.isArray(raw)) throw new Error('Invalid suggestions');
  const candidates: RatingCandidate[] = raw.filter((v) => v && typeof v.id === 'string' && typeof v.title === 'string')
    .map((v) => ({ id: v.id, title: v.title, year: String(v.year ?? ''), alias: v.sub_title, episode: v.episode }));
  const candidate = matchRatingCandidate(query, candidates);
  if (!candidate) return { rating: null, status: 'unmatched' };
  const type = Number(candidate.episode) > 0 ? 'tv' : 'movie';
  const subject = await getJson(`https://m.douban.com/rexxar/api/v2/${type}/${candidate.id}`) as Subject;
  // Revalidate the returned subject; redirects or stale suggestion data must not attach a wrong score.
  if (String(subject.id) !== candidate.id || !subject.title || !subject.year ||
      !matchRatingCandidate(query, [{ id: candidate.id, title: subject.title, year: subject.year }])) {
    return { rating: null, status: 'unmatched' };
  }
  const score = subject.rating?.value;
  const count = subject.rating?.count;
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0 || score > 10 ||
      typeof count !== 'number' || !Number.isInteger(count) || count <= 0 || subject.rating?.max !== 10) {
    return { rating: null, status: 'unmatched' };
  }
  return { status: 'matched', rating: {
    id: candidate.id, title: subject.title, year: subject.year, score, count, checkedAt: new Date().toISOString(),
  } };
}

export async function fetchDoubanRating(query: RatingQuery): Promise<RatingResult> {
  const key = `rating:${ratingKey(query)}`;
  const cached = getCache<Omit<RatingResult, 'query'>>(key);
  if (cached) return { ...cached, query };
  let promise = inflight.get(key);
  if (!promise) {
    promise = limited(() => lookup(query)).catch(() => ({ rating: null, status: 'unavailable' as const }))
      .then((result) => {
        setCache(key, result, result.status === 'unavailable' ? 30_000 : result.rating ? 86400_000 : 21600_000);
        return result;
      }).finally(() => inflight.delete(key));
    inflight.set(key, promise);
  }
  return { ...await promise, query };
}
