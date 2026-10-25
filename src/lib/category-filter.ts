/**
 * 搜索结果的「类别」筛选（按采集站的 typeName）。
 *
 * 为什么按组内任一来源命中就算匹配：搜索结果是跨源同名聚合的，
 * 同一部片子在不同源里可能被标成「国产剧」或「电视剧」，若只取首个来源的类别，
 * 切换数据源后同一部片子会忽隐忽现，筛选结果也不稳定。
 */

/** 采集站没有给 typeName 时的归并桶 */
export const UNCATEGORIZED = '未分类';

export interface CategoryItemLike {
  typeName?: string;
}

export interface CategoryGroupLike {
  items: CategoryItemLike[];
}

export interface CategoryOption {
  name: string;
  /** 该类别下的影片（聚合组）数量 */
  count: number;
}

function normalizeCategory(value: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text || UNCATEGORIZED;
}

/** 单个聚合组命中的全部类别（去重） */
export function groupCategories(group: CategoryGroupLike): string[] {
  const set = new Set<string>();
  for (const item of group.items) set.add(normalizeCategory(item.typeName));
  return [...set];
}

/**
 * 生成类别选项：按影片数从多到少排列，同数量按中文名称排序。
 * 一个组在同一类别下只计一次，避免同片多源把计数放大。
 */
export function getCategoryOptions(groups: readonly CategoryGroupLike[]): CategoryOption[] {
  const counts = new Map<string, number>();
  for (const group of groups) {
    for (const name of groupCategories(group)) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** 多选筛选：选中集合为空表示「全部」；否则保留命中任一选中类别的组 */
export function filterGroupsByCategories<T extends CategoryGroupLike>(
  groups: readonly T[],
  selected: ReadonlySet<string>
): T[] {
  if (selected.size === 0) return [...groups];
  return groups.filter((group) => groupCategories(group).some((name) => selected.has(name)));
}

/**
 * 结果集变化后（切换搜索词、源失效导致类别消失）丢弃已不存在的选项，
 * 否则筛选条件会残留并导致莫名其妙的空结果。
 */
export function pruneCategories(
  selected: ReadonlySet<string>,
  options: readonly CategoryOption[]
): Set<string> {
  if (selected.size === 0) return new Set();
  const available = new Set(options.map((option) => option.name));
  return new Set([...selected].filter((name) => available.has(name)));
}
