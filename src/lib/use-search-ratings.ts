'use client';

import { useQueries } from '@tanstack/react-query';
import { api } from './client-api';
import { ratingKey, type RatingQuery, type RatingResult } from './ratings';

export function useSearchRatings(groups: Array<{ name: string; year?: string }>, enabled: boolean) {
  const unique = [...new Map(groups.map((g) => {
    const query: RatingQuery = { title: g.name.slice(0, 120), year: /^(18|19|20|21)\d{2}$/.test(g.year ?? '') ? g.year : undefined };
    return [ratingKey(query), query] as const;
  })).values()];
  const batches: RatingQuery[][] = [];
  for (let i = 0; i < unique.length; i += 12) batches.push(unique.slice(i, i + 12));
  const queries = useQueries({ queries: batches.map((items) => ({
    queryKey: ['search-ratings', items],
    queryFn: ({ signal }: { signal: AbortSignal }) => api.ratings(items, signal),
    enabled, staleTime: 3600_000, retry: false,
  })) });
  const ratings = new Map<string, RatingResult>();
  queries.forEach((q) => q.data?.results.forEach((r) => ratings.set(ratingKey(r.query), r)));
  return {
    ratings,
    loading: enabled && queries.some((q) => q.isPending || q.isFetching),
    failed: queries.some((q) => q.isError) || [...ratings.values()].some((r) => r.status === 'unavailable'),
    retry: () => { queries.forEach((q) => { void q.refetch(); }); },
  };
}
