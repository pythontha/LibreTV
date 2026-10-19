import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { fetchDoubanRating } from './douban-ratings';

beforeEach(() => vi.resetAllMocks());
const suggestion = [{ id: '34885342', title: '人生切割术 第一季', year: '2022', episode: '9' }];
const subject = { id: '34885342', title: '人生切割术 第一季', year: '2022', rating: { value: 9, count: 100, max: 10 } };
const json = (value: unknown) => new Response(JSON.stringify(value));

describe('Douban score lookup', () => {
  it('deduplicates simultaneous lookups, validates identity and caches a real score', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(json(suggestion)).mockResolvedValueOnce(json(subject));
    const query = { title: '人生切割术第一季', year: '2022' };
    const [a, b] = await Promise.all([fetchDoubanRating(query), fetchDoubanRating(query)]);
    expect(a.rating?.score).toBe(9);
    expect(b).toEqual(a);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
    expect(setCache).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ status: 'matched' }), 86400_000);
  });
  it('does not attach a score if the detail endpoint returns a different season', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(json(suggestion)).mockResolvedValueOnce(json({ ...subject, title: '人生切割术 第二季' }));
    expect((await fetchDoubanRating({ title: '人生切割术第一季', year: '2022' })).rating).toBeNull();
  });
  it('treats blocked responses and timeouts as temporarily unavailable', async () => {
    vi.mocked(fetchUpstream).mockRejectedValueOnce(new Error('timeout'));
    expect((await fetchDoubanRating({ title: '超时' })).status).toBe('unavailable');
    expect(setCache).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ rating: null }), 30_000);
  });
  it('does not turn absent/zero scores into ratings', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(json(suggestion)).mockResolvedValueOnce(json({ ...subject, rating: { value: 0, count: 0, max: 10 } }));
    expect((await fetchDoubanRating({ title: '人生切割术第一季', year: '2022' })).rating).toBeNull();
  });
  it('returns cached values without an upstream request', async () => {
    vi.mocked(getCache).mockReturnValueOnce({ rating: null, status: 'unmatched' });
    expect((await fetchDoubanRating({ title: 'Unknown' })).status).toBe('unmatched');
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});
