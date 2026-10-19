import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/api-guard', async () => ({ ...await vi.importActual('@/lib/api-guard'), guardRequest: vi.fn() }));
vi.mock('@/lib/douban-ratings', () => ({ fetchDoubanRating: vi.fn() }));
import { guardRequest } from '@/lib/api-guard';
import { fetchDoubanRating } from '@/lib/douban-ratings';
import { POST } from './route';

beforeEach(() => vi.resetAllMocks());
const request = (body: string) => new Request('http://localhost/api/ratings', { method: 'POST', body });
describe('ratings route', () => {
  it('requires authentication before fetching anything', async () => {
    vi.mocked(guardRequest).mockReturnValueOnce(new Response('Unauthorized', { status: 401 }) as never);
    expect((await POST(request('{}'))).status).toBe(401);
    expect(fetchDoubanRating).not.toHaveBeenCalled();
  });
  it('rejects invalid and oversized requests', async () => {
    for (const body of ['invalid', '{}', JSON.stringify({ items: Array(13).fill({ title: 'a' }) })]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request('x'.repeat(17000)))).status).toBe(413);
    expect(fetchDoubanRating).not.toHaveBeenCalled();
  });
  it('returns independent rating results without public HTTP caching', async () => {
    vi.mocked(fetchDoubanRating).mockResolvedValueOnce({ query: { title: 'a' }, rating: null, status: 'unmatched' });
    const res = await POST(request(JSON.stringify({ items: [{ title: 'a' }] })));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect((await res.json()).results).toHaveLength(1);
  });
});
