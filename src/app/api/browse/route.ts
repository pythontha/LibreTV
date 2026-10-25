import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import {
  aggregateCategories,
  matchTypeIds,
  parseClassList,
  resolvePageCount,
  type ClassEntry,
} from '@/lib/browse';
import type { BrowseCategoriesResponse, BrowseResponse, SearchResultItem, SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

/** 分类目变化极慢，缓存 10 分钟可省掉每次浏览都拉一遍 ac=list */
const CLASS_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_SOURCES = 20;
const MAX_PAGE = 200;
/** 单个源最多同时命中多少个同义分类（如既有「国产动漫」又有「中国动漫」） */
const MAX_TYPE_IDS = 8;

interface BrowseBody {
  sources?: SourceConfig[];
  /** 为空表示只取分类目录 */
  category?: string;
  page?: number;
  filterAdult?: boolean;
}

const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');

async function loadClasses(source: SourceConfig): Promise<ClassEntry[]> {
  const base = normalizeUrl(source.url);
  const cacheKey = `browse-classes:${base}`;
  const cached = getCache<ClassEntry[]>(cacheKey);
  if (cached) return cached;
  const res = await fetchUpstream(`${base}?ac=list`, {
    timeoutMs: 9000,
    headers: cmsRequestHeaders(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const classes = parseClassList(await res.json());
  // 空分类也缓存：源站偶发返回空列表时不要反复重试
  setCache(cacheKey, classes, CLASS_CACHE_TTL_MS);
  return classes;
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: BrowseBody;
  try {
    body = (await req.json()) as BrowseBody;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }

  const sources = (Array.isArray(body.sources) ? body.sources : []).filter(
    (source): source is SourceConfig =>
      Boolean(source) && typeof source.url === 'string' && /^https?:\/\//.test(source.url)
  );
  if (sources.length === 0) {
    return NextResponse.json({ error: '没有可用的点播源' }, { status: 400 });
  }
  if (sources.length > MAX_SOURCES) {
    return NextResponse.json({ error: '源数量过多' }, { status: 400 });
  }

  // 与搜索一致：用户可控地址必须先过 SSRF 校验
  for (const source of sources) {
    const verdict = await checkUpstreamAllowed(source.url);
    if (!verdict.ok) {
      return NextResponse.json({ error: `源地址被拒绝: ${verdict.reason}` }, { status: 400 });
    }
  }

  const category = typeof body.category === 'string' ? body.category.trim().slice(0, 40) : '';

  // 目录模式：只返回「有哪些类别可浏览」
  if (!category) {
    const settled = await Promise.allSettled(
      sources.map(async (source) => ({ key: source.key, classes: await loadClasses(source) }))
    );
    const perSource = settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
    const payload: BrowseCategoriesResponse = { categories: aggregateCategories(perSource) };
    return NextResponse.json(payload);
  }

  // 浏览模式：按分类翻页
  const page = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(body.page) || 1)));
  const filterAdult = body.filterAdult === true;
  const failures: BrowseResponse['failures'] = [];
  const items: SearchResultItem[] = [];
  const seen = new Set<string>();
  const pageCounts: unknown[] = [];

  await Promise.all(
    sources.map(async (source) => {
      try {
        const classes = await loadClasses(source);
        const typeIds = matchTypeIds(classes, category).slice(0, MAX_TYPE_IDS);
        if (typeIds.length === 0) {
          failures.push({ sourceKey: source.key, error: '该源没有这个分类' });
          return;
        }
        const responses = await Promise.all(
          typeIds.map(async (typeId) => {
            const res = await fetchUpstream(
              `${normalizeUrl(source.url)}?ac=videolist&t=${encodeURIComponent(typeId)}&pg=${page}`,
              { timeoutMs: 9000, headers: cmsRequestHeaders() }
            );
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return (await res.json()) as unknown;
          })
        );
        for (const data of responses) {
          pageCounts.push((data as { pagecount?: unknown })?.pagecount);
          for (const item of parseSearchList(data, source)) {
            const key = `${item.sourceKey}_${item.vodId}`;
            if (seen.has(key)) continue;
            seen.add(key);
            items.push(item);
          }
        }
      } catch (err) {
        const timedOut =
          err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
        failures.push({
          sourceKey: source.key,
          error: timedOut ? '请求超时' : err instanceof Error ? err.message : '请求失败',
          timedOut,
        });
      }
    })
  );

  const payload: BrowseResponse = {
    list: filterAdultResults(items, filterAdult),
    failures,
    page,
    pageCount: resolvePageCount(pageCounts),
  };
  return NextResponse.json(payload);
}
