import { describe, expect, it } from 'vitest';
import { filterRatedGroups, matchRatingCandidate, parseRatingQueries, ratingKey, titleIdentity, type RatingResult } from './ratings';

const seasons = [
  { id: '34885342', title: '人生切割术 第一季', year: '2022' },
  { id: '35783948', title: '人生切割术 第二季', year: '2025' },
];

describe('rating identity', () => {
  it('normalizes Chinese/English season numbers without stripping meaningful titles', () => {
    expect(titleIdentity('人生切割术 第2季').key).toBe(titleIdentity('人生切割术 第二季').key);
    expect(titleIdentity('Test Season 12').key).toBe(titleIdentity('Test S12').key);
    expect(titleIdentity('庆余年第十二季').season).toBe(12);
    expect(titleIdentity('Test 第一季').key).not.toBe(titleIdentity('Test 第二季').key);
  });
  it('requires year to resolve a missing season and rejects mismatching years', () => {
    expect(matchRatingCandidate({ title: '人生切割术' }, seasons)).toBeNull();
    expect(matchRatingCandidate({ title: '人生切割术', year: '2022' }, seasons)?.id).toBe('34885342');
    expect(matchRatingCandidate({ title: '人生切割术第二季', year: '2022' }, seasons)).toBeNull();
    expect(matchRatingCandidate({ title: '人生切割术 第2季', year: '2025' }, seasons)?.id).toBe('35783948');
  });
  it('rejects ambiguous remakes, trailers, commentary and fuzzy name matches', () => {
    const remakes = [{ id: '1', title: '同名', year: '1999' }, { id: '2', title: '同名', year: '2022' }];
    expect(matchRatingCandidate({ title: '同名' }, remakes)).toBeNull();
    expect(matchRatingCandidate({ title: '同名', year: '2022' }, remakes)?.id).toBe('2');
    for (const title of ['人生切割术解说', '人生切割术预告片', '人生切割术之谜']) {
      expect(matchRatingCandidate({ title, year: '2022' }, seasons)).toBeNull();
    }
  });
  it('validates batch size, title, year and body types', () => {
    for (const body of [null, {}, { items: [] }, { items: Array(13).fill({ title: 'a' }) }, { items: [{ title: '' }] }, { items: [{ title: 'a', year: 2022 }] }, { items: [{ title: 'a', year: '2022/2023' }] }]) {
      expect(parseRatingQueries(body)).toBeNull();
    }
    expect(parseRatingQueries({ items: [{ title: ' Test ', year: '2022', url: 'http://localhost' }] })).toEqual([{ title: 'Test', year: '2022' }]);
  });
  it('keeps unknown scores last and excludes them from minimum-score filters', () => {
    const groups = ['无评分', '八分', '九分', '另一八分'].map((name) => ({ name }));
    const ratings = new Map<string, RatingResult>();
    for (const [title, score] of [['八分', 8], ['九分', 9], ['另一八分', 8]] as const) {
      const query = { title };
      ratings.set(ratingKey(query), { query, status: 'matched', rating: { id: '1', title, year: '2022', score, count: 10, checkedAt: '' } });
    }
    expect(filterRatedGroups(groups, ratings, 'rating', 0).map((g) => g.name)).toEqual(['九分', '八分', '另一八分', '无评分']);
    expect(filterRatedGroups(groups, ratings, 'relevance', 8).map((g) => g.name)).toEqual(['八分', '九分', '另一八分']);
    expect(filterRatedGroups(groups, ratings, 'rating', 9).map((g) => g.name)).toEqual(['九分']);
    expect(groups[0].name).toBe('无评分');
  });
});
