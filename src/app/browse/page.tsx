'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Header } from '@/components/header';
import { DetailModal } from '@/components/detail-modal';
import { AggregatedCard, aggregateResults } from '@/components/video-card';
import { useAppStore, resolveSource, isInDisabledSubscription, isSourceDisabled } from '@/lib/store';
import { api } from '@/lib/client-api';
import type { BrowseResponse, SearchResultItem } from '@/lib/types';
import { mergeBrowseItems } from '@/lib/browse';
import { cn, validateSourceUrl } from '@/lib/utils';
import { EmptyState } from '@/components/states';
import { SiteFooter } from '@/components/site-footer';

/** 首屏先展示的分类数量，其余折叠，避免几十个胶囊糊满一屏 */
const PINNED_CATEGORIES = 12;

export default function BrowsePage() {
  return (
    <Suspense>
      <BrowseContent />
    </Suspense>
  );
}

interface BrowseResult {
  list: SearchResultItem[];
  pageCount: number;
  failures: BrowseResponse['failures'];
}

function BrowseContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const category = (searchParams.get('cat') || '').trim();

  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const sourceHealth = useAppStore((s) => s.sourceHealth);
  const subscriptions = useAppStore((s) => s.subscriptions);

  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  const [pages, setPages] = useState(1);
  const [showAllCategories, setShowAllCategories] = useState(false);

  const selectedSources = useMemo(() => {
    const seen = new Set<string>();
    return selectedKeys
      .map((key) => resolveSource({ customAPIs, envSources }, key))
      .filter((s): s is NonNullable<typeof s> => {
        if (!s || !validateSourceUrl(s.url) || seen.has(s.key)) return false;
        seen.add(s.key);
        return true;
      })
      .filter((s) => !isSourceDisabled({ sourceHealth }, s.key))
      .filter((s) => !isInDisabledSubscription({ subscriptions }, s.key));
  }, [customAPIs, envSources, selectedKeys, sourceHealth, subscriptions]);

  const categoriesQuery = useQuery({
    queryKey: ['browse-categories', selectedKeys],
    queryFn: ({ signal }) => api.browseCategories(selectedSources, signal),
    enabled: selectedSources.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const browseQuery = useQuery<BrowseResult>({
    queryKey: ['browse', category, selectedKeys, yellowFilter, pages],
    queryFn: async ({ signal }) => {
      // 翻页是「加载更多」语义：一次性取 1..pages 并合并，保证顺序稳定
      const responses = await Promise.all(
        Array.from({ length: pages }, (_, index) =>
          api.browse(category, selectedSources, index + 1, yellowFilter, signal)
        )
      );
      let list: SearchResultItem[] = [];
      let pageCount = 1;
      const failures: BrowseResponse['failures'] = [];
      for (const response of responses) {
        list = mergeBrowseItems(list, response.list);
        pageCount = Math.max(pageCount, response.pageCount);
        failures.push(...response.failures);
      }
      return { list, pageCount, failures };
    },
    enabled: Boolean(category) && selectedSources.length > 0,
    staleTime: 60 * 1000,
  });

  // 换分类或换源时回到第 1 页
  useEffect(() => setPages(1), [category, selectedKeys]);

  const list = useMemo(() => browseQuery.data?.list ?? [], [browseQuery.data]);
  const groups = useMemo(() => aggregateResults(list), [list]);
  const pageCount = browseQuery.data?.pageCount ?? 1;
  const failures = browseQuery.data?.failures ?? [];
  const categories = categoriesQuery.data?.categories ?? [];
  const visibleCategories = showAllCategories ? categories : categories.slice(0, PINNED_CATEGORIES);
  const sourceName = (key: string) =>
    customAPIs.find((source) => source.key === key)?.name ??
    envSources.find((source) => source.key === key)?.name ??
    key;

  const pickCategory = (name: string) => {
    router.push(`/browse?cat=${encodeURIComponent(name)}`, { scroll: false });
    setShowAllCategories(false);
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="relative flex-1 max-w-6xl w-full mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-content mb-1">分类浏览</h1>
          <p className="text-sm text-muted">
            选一个类别，直接浏览当前点播源里的全部影片，无需输入关键词。
          </p>
        </div>

        {categoriesQuery.isLoading ? (
          <div className="flex flex-wrap gap-2 mb-6">
            {Array.from({ length: PINNED_CATEGORIES }).map((_, index) => (
              <div key={index} className="h-7 w-20 rounded-full bg-chip animate-pulse" />
            ))}
          </div>
        ) : categories.length > 0 ? (
          <div className="mb-6">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="可浏览的类别">
              <span className="text-xs text-faint">类别</span>
              {visibleCategories.map((item) => (
                <button
                  key={item.name}
                  type="button"
                  aria-pressed={item.name === category}
                  onClick={() => pickCategory(item.name)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-xs transition-colors',
                    item.name === category
                      ? 'bg-accent text-on-accent'
                      : 'bg-chip text-muted hover:text-content hover:bg-hover'
                  )}
                  title={`${item.sources} 个源提供该分类`}
                >
                  {item.name}
                </button>
              ))}
            </div>
            {categories.length > PINNED_CATEGORIES && (
              <button
                type="button"
                className="mt-2 text-xs text-accent hover:underline"
                onClick={() => setShowAllCategories((value) => !value)}
              >
                {showAllCategories ? '收起' : `全部分类（${categories.length}）`}
              </button>
            )}
          </div>
        ) : selectedSources.length > 0 ? (
          <p className="text-sm text-faint mb-6">未能读取到分类目录，请稍后重试或检查点播源。</p>
        ) : null}

        {selectedSources.length === 0 ? (
          <div className="border border-dashed border-line rounded-xl p-10 text-center max-w-lg mx-auto">
            <h3 className="text-content font-medium mb-2">尚未勾选点播源</h3>
            <p className="text-sm text-muted leading-relaxed">
              点击右上角「设置」勾选点播源后，再回来按分类浏览。
            </p>
          </div>
        ) : !category ? (
          <p className="text-sm text-muted py-10 text-center">请选择上方任意类别开始浏览。</p>
        ) : (
          <section aria-label="分类结果">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-sm text-muted">
                「<span className="text-content">{category}</span>」分类
                <span className="text-faint">
                  （{groups.length} 部影片 · {list.length} 条结果
                  {failures.length > 0 && `，${failures.length} 个源不可用`}）
                </span>
              </h2>
              {list.length > 0 && (
                <span className="text-xs text-faint">
                  第 {pages}/{Math.max(pageCount, pages)} 页
                </span>
              )}
            </div>

            {failures.length > 0 && (
              <div className="mb-3 text-xs bg-chip rounded-lg px-3 py-2 flex flex-wrap gap-x-3 gap-y-1">
                <span className="text-faint">以下源未返回该分类：</span>
                {failures.map((failure) => (
                  <span key={failure.sourceKey} className={failure.timedOut ? 'text-warning' : 'text-faint'}>
                    {failure.timedOut ? '⏱' : '✗'} {sourceName(failure.sourceKey)} {failure.error}
                  </span>
                ))}
              </div>
            )}

            {browseQuery.isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div key={index} className="card flex h-28 overflow-hidden">
                    <div className="w-[105px] sm:w-[120px] shrink-0 bg-chip animate-pulse" />
                    <div className="flex-1 p-2.5 space-y-2">
                      <div className="h-4 w-3/4 rounded bg-chip animate-pulse" />
                      <div className="h-3 w-1/2 rounded bg-chip animate-pulse" />
                      <div className="h-3 w-full rounded bg-chip animate-pulse" />
                    </div>
                  </div>
                ))}
              </div>
            ) : groups.length === 0 ? (
              <EmptyState
                icon="search"
                title="该分类下没有取到影片"
                description="换一个类别，或在设置中确认点播源可用"
                className="!py-16"
              />
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
                  {groups.map((group) => (
                    <AggregatedCard
                      key={group.key}
                      group={group}
                      sources={selectedSources}
                      onOpen={(item) => setDetailItem(item)}
                    />
                  ))}
                </div>
                {pages < pageCount && (
                  <div className="flex justify-center mt-4">
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => setPages((value) => value + 1)}
                      disabled={browseQuery.isFetching}
                    >
                      {browseQuery.isFetching ? '加载中…' : '加载更多'}
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>

      <SiteFooter />
      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
