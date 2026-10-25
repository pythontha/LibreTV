import { describe, expect, it } from 'vitest';
import {
  CATEGORY_SYNONYMS,
  UNCATEGORIZED,
  canonicalCategory,
  filterGroupsByCategories,
  getCategoryOptions,
  groupCategories,
  pruneCategories,
  type CategoryGroupLike,
} from './category-filter';

const group = (...types: (string | undefined)[]): CategoryGroupLike => ({
  items: types.map((typeName) => ({ typeName })),
});

const names = (groups: CategoryGroupLike[]) => groups.map((g) => groupCategories(g).join('+'));

describe('groupCategories', () => {
  it('合并组内各来源的类别并去重', () => {
    expect(groupCategories(group('国产剧', '电视剧', '国产剧'))).toEqual(['国产剧', '电视剧']);
  });

  it('空白类别归入未分类', () => {
    expect(groupCategories(group(undefined, '  '))).toEqual([UNCATEGORIZED]);
  });
});

describe('getCategoryOptions', () => {
  it('按影片数降序统计，同组同类只计一次', () => {
    const options = getCategoryOptions([
      group('国产动漫', '国产动漫'),
      group('国产剧'),
      group('国产剧', '电影解说'),
    ]);
    expect(options).toEqual([
      { name: '国产剧', count: 2 },
      { name: '电影解说', count: 1 },
      { name: '国产动漫', count: 1 },
    ]);
  });

  it('同数量时按中文拼音顺序排列', () => {
    const options = getCategoryOptions([group('国产动漫'), group('电影解说')]);
    expect(options.map((o) => o.name)).toEqual(['电影解说', '国产动漫']);
  });

  it('空结果集返回空数组', () => {
    expect(getCategoryOptions([])).toEqual([]);
  });
});

describe('filterGroupsByCategories', () => {
  const groups = [group('国产动漫'), group('国产剧'), group('电影解说'), group(undefined)];

  it('未选类别时返回全部结果', () => {
    const all = filterGroupsByCategories(groups, new Set());
    expect(all).toHaveLength(4);
    // 返回新数组，调用方改数组不会污染原数据
    expect(all).not.toBe(groups);
  });

  it('单选只保留命中类别', () => {
    expect(names(filterGroupsByCategories(groups, new Set(['国产动漫'])))).toEqual(['国产动漫']);
  });

  it('多选按「任一命中」合并结果', () => {
    const picked = filterGroupsByCategories(groups, new Set(['国产动漫', '电影解说']));
    expect(names(picked)).toEqual(['国产动漫', '电影解说']);
  });

  it('组内第二个来源命中时同样保留', () => {
    const mixed = [group('国产剧', '国产动漫'), group('国产剧')];
    expect(filterGroupsByCategories(mixed, new Set(['国产动漫']))).toHaveLength(1);
  });

  it('无类型的结果可用未分类筛出', () => {
    expect(filterGroupsByCategories(groups, new Set([UNCATEGORIZED]))).toHaveLength(1);
  });

  it('没有任何命中时返回空数组', () => {
    expect(filterGroupsByCategories(groups, new Set(['不存在的类别']))).toEqual([]);
  });
});

describe('canonicalCategory（同义词归一）', () => {
  it('把各站的不同写法收敛到同一个类别名', () => {
    expect(canonicalCategory('中国动漫')).toBe('国产动漫');
    expect(canonicalCategory('大陆剧')).toBe('国产剧');
    expect(canonicalCategory('日本剧')).toBe('日剧');
    expect(canonicalCategory('记录片')).toBe('纪录片');
    expect(canonicalCategory('电影片')).toBe('电影');
    expect(canonicalCategory(' 理论片 ')).toBe('伦理片');
  });

  it('未收录的类别原样保留', () => {
    expect(canonicalCategory('动作片')).toBe('动作片');
    expect(canonicalCategory('古装仙侠')).toBe('古装仙侠');
  });

  it('空白类别归入未分类', () => {
    expect(canonicalCategory(undefined)).toBe(UNCATEGORIZED);
    expect(canonicalCategory('   ')).toBe(UNCATEGORIZED);
  });

  it('映射表保持单级跳转（目标不再是源）', () => {
    const sources = new Set(Object.keys(CATEGORY_SYNONYMS));
    for (const [from, to] of Object.entries(CATEGORY_SYNONYMS)) {
      expect(from).not.toBe(to);
      expect(sources.has(to)).toBe(false);
    }
  });

  it('归一后不再出现同义重复选项', () => {
    const options = getCategoryOptions([
      group('国产动漫'),
      group('中国动漫'),
      group('日本动漫'),
      group('日韩动漫'),
      group('动作片'),
    ]);
    expect(options).toEqual([
      { name: '国产动漫', count: 2 },
      { name: '日韩动漫', count: 2 },
      { name: '动作片', count: 1 },
    ]);
  });

  it('按统一类别名可以筛出别名写法的影片', () => {
    const groups = [group('中国动漫'), group('日本动漫'), group('国产剧')];
    expect(filterGroupsByCategories(groups, new Set(['国产动漫']))).toHaveLength(1);
    expect(filterGroupsByCategories(groups, new Set(['日韩动漫']))).toHaveLength(1);
    expect(filterGroupsByCategories(groups, new Set(['国产动漫', '日韩动漫']))).toHaveLength(2);
  });
});

describe('pruneCategories', () => {
  const options = [
    { name: '国产剧', count: 3 },
    { name: '电影解说', count: 1 },
  ];

  it('丢弃结果集中已消失的类别', () => {
    expect([...pruneCategories(new Set(['国产剧', '已消失']), options)]).toEqual(['国产剧']);
  });

  it('全部命中时保持选择不变', () => {
    expect([...pruneCategories(new Set(['国产剧', '电影解说']), options)].sort()).toEqual([
      '国产剧',
      '电影解说',
    ]);
  });

  it('空选择返回空集合', () => {
    expect(pruneCategories(new Set(), options).size).toBe(0);
  });
});
