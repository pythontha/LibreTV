/**
 * 搜索结果的「类别」筛选（按采集站的 typeName）。
 *
 * 为什么按组内任一来源命中就算匹配：搜索结果是跨源同名聚合的，
 * 同一部片子在不同源里可能被标成「国产剧」或「电视剧」，若只取首个来源的类别，
 * 切换数据源后同一部片子会忽隐忽现，筛选结果也不稳定。
 */

/** 采集站没有给 typeName 时的归并桶 */
export const UNCATEGORIZED = '未分类';

/**
 * 跨站同义类别归一表（左：源站写法，右：统一后的名称）。
 *
 * 这张表按四个预置源（光速 / 暴风 / 量子 / 360）的真实分类词表整理，只合并
 * 「同一件事的不同写法」与明显的错别字，不做层级合并——例如「动漫」是总类、
 * 「国产动漫」是地区子类，两者保持独立，避免把用户明确想找的细分类别吞掉。
 *
 * 约束：右侧的值不得再是左侧的键（不做多级映射），由单元测试保证。
 */
export const CATEGORY_SYNONYMS: Readonly<Record<string, string>> = {
  // 总类：片 / 剧 的冗余后缀
  电影片: '电影',
  综艺片: '综艺',
  动漫片: '动漫',
  动画片: '动漫',
  连续剧: '电视剧',
  // 剧集：地区叫法
  大陆剧: '国产剧',
  港澳剧: '香港剧',
  韩国剧: '韩剧',
  日本剧: '日剧',
  泰国剧: '泰剧',
  // 动漫：地区叫法
  中国动漫: '国产动漫',
  日本动漫: '日韩动漫',
  // 错别字
  记录片: '纪录片',
  // 体育：总类
  体育: '体育赛事',
  // 成人向分类的两种叫法
  理论片: '伦理片',
  福利: '伦理片',
  // 短剧
  短剧大全: '短剧',
  年代穿越: '穿越年代',
  反转爽文: '反转爽剧',
  女恋总裁: '言情总裁',
  // 资讯
  电影资讯: '新闻资讯',
  娱乐新闻: '新闻资讯',
};

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

/** 把源站写法映射到统一类别名；未收录的写法原样保留，空白归入「未分类」 */
export function canonicalCategory(value: string | undefined): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return UNCATEGORIZED;
  return CATEGORY_SYNONYMS[text] ?? text;
}

/** 单个聚合组命中的全部类别（已归一、去重） */
export function groupCategories(group: CategoryGroupLike): string[] {
  const set = new Set<string>();
  for (const item of group.items) set.add(canonicalCategory(item.typeName));
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
