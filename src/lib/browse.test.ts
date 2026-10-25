import { describe, expect, it } from 'vitest';
import {
  aggregateCategories,
  matchTypeIds,
  mergeBrowseItems,
  parseClassList,
  resolvePageCount,
  type ClassEntry,
} from './browse';
import type { SearchResultItem } from './types';

const item = (sourceKey: string, vodId: string, name = `片${vodId}`): SearchResultItem => ({
  sourceKey,
  sourceName: sourceKey,
  vodId,
  name,
});

describe('parseClassList', () => {
  it('解析正常的 ac=list 分类数组', () => {
    const data = {
      class: [
        { type_id: 1, type_name: '电影' },
        { type_id: '2', type_name: '连续剧' },
      ],
    };
    expect(parseClassList(data)).toEqual([
      { id: '1', name: '电影' },
      { id: '2', name: '连续剧' },
    ]);
  });

  it('丢弃 type_id 非数字、名称为空或缺失的条目', () => {
    const data = {
      class: [
        { type_id: 0, type_name: '' },
        { type_id: 'abc', type_name: '坏ID' },
        { type_id: 3, type_name: '   ' },
        { type_name: '没有ID' },
        { type_id: 4, type_name: '动作片' },
      ],
    };
    expect(parseClassList(data)).toEqual([{ id: '4', name: '动作片' }]);
  });

  it('重复条目只保留一次', () => {
    const data = {
      class: [
        { type_id: 5, type_name: '动漫' },
        { type_id: 5, type_name: '动漫' },
      ],
    };
    expect(parseClassList(data)).toHaveLength(1);
  });

  it('结构异常时返回空数组', () => {
    expect(parseClassList(null)).toEqual([]);
    expect(parseClassList({})).toEqual([]);
    expect(parseClassList({ class: 'nope' })).toEqual([]);
  });
});

describe('matchTypeIds', () => {
  const classes: ClassEntry[] = [
    { id: '10', name: '电影' },
    { id: '20', name: '中国动漫' },
    { id: '21', name: '国产动漫' },
    { id: '30', name: '大陆剧' },
  ];

  it('同义分类都会命中（中国动漫/国产动漫 → 国产动漫）', () => {
    expect(matchTypeIds(classes, '国产动漫')).toEqual(['20', '21']);
  });

  it('按归一后的名字匹配（大陆剧 → 国产剧）', () => {
    expect(matchTypeIds(classes, '国产剧')).toEqual(['30']);
  });

  it('找不到时返回空数组', () => {
    expect(matchTypeIds(classes, '纪录片')).toEqual([]);
  });

  it('空类别返回空数组', () => {
    expect(matchTypeIds(classes, '  ')).toEqual([]);
  });
});

describe('aggregateCategories', () => {
  it('同名类别跨源合并并统计源数量', () => {
    const result = aggregateCategories([
      {
        key: 'a',
        classes: [
          { id: '1', name: '中国动漫' },
          { id: '2', name: '动作片' },
        ],
      },
      {
        key: 'b',
        classes: [
          { id: '1', name: '国产动漫' },
          { id: '2', name: '动作片' },
        ],
      },
      { key: 'c', classes: [{ id: '1', name: '动作片' }] },
    ]);
    expect(result[0]).toEqual({ name: '动作片', sources: 3 });
    expect(result.find((c) => c.name === '国产动漫')).toEqual({ name: '国产动漫', sources: 2 });
    expect(result.some((c) => c.name === '中国动漫')).toBe(false);
  });

  it('源数量相同时按中文名称排序', () => {
    const result = aggregateCategories([
      { key: 'a', classes: [{ id: '1', name: '国产剧' }] },
      { key: 'b', classes: [{ id: '1', name: '纪录片' }] },
    ]);
    expect(result.map((c) => c.name)).toEqual(['国产剧', '纪录片']);
  });

  it('没有分类时返回空数组', () => {
    expect(aggregateCategories([{ key: 'a', classes: [] }])).toEqual([]);
  });
});

describe('mergeBrowseItems', () => {
  it('追加新条目并保持原顺序', () => {
    const merged = mergeBrowseItems([item('a', '1')], [item('a', '2')]);
    expect(merged.map((i) => i.vodId)).toEqual(['1', '2']);
  });

  it('按 源+影片ID 去重（翻页时源站会重复返回同一条）', () => {
    const merged = mergeBrowseItems([item('a', '1'), item('b', '1')], [item('a', '1'), item('b', '1')]);
    expect(merged).toHaveLength(2);
  });

  it('不同源的相同 ID 视为不同条目', () => {
    expect(mergeBrowseItems([], [item('a', '1'), item('b', '1')])).toHaveLength(2);
  });
});

describe('resolvePageCount', () => {
  it('取最大值', () => {
    expect(resolvePageCount([3, '17', undefined, 9])).toBe(17);
  });

  it('无效值兜底为 1', () => {
    expect(resolvePageCount([])).toBe(1);
    expect(resolvePageCount(['x', null, -5])).toBe(1);
  });
});
