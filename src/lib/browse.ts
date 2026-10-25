/**
 * 分类浏览（反向搜索）的纯逻辑：分类目录解析、归一匹配、分页合并。
 * 与 keyword 搜索不同，这里直接走采集站的分类列表接口 `?ac=videolist&t=<type_id>&pg=<page>`。
 */
import { canonicalCategory } from './category-filter';
import type { SearchResultItem } from './types';

/** 采集站 `?ac=list` 返回的分类条目（任意源站字段形态） */
export interface RawClassEntry {
  type_id?: unknown;
  type_name?: unknown;
}

export interface ClassEntry {
  id: string;
  name: string;
}

/**
 * 解析分类数组：只保留 type_id 为纯数字且 type_name 非空的条目。
 * 源站会混入 `type_id: 0`、空名、甚至字符串数字，统一在这里收口。
 */
export function parseClassList(data: unknown): ClassEntry[] {
  const raw = (data as { class?: unknown } | null)?.class;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ClassEntry[] = [];
  for (const entry of raw) {
    const item = entry as RawClassEntry;
    const id = item?.type_id === undefined || item?.type_id === null ? '' : String(item.type_id).trim();
    const name = typeof item?.type_name === 'string' ? item.type_name.trim() : '';
    if (!/^\d+$/.test(id) || !name) continue;
    const key = `${id}|${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id, name });
  }
  return out;
}

/**
 * 找出该源中属于目标类别的 type_id。
 * 用归一后的名字比较，所以「中国动漫」也会命中「国产动漫」；
 * 一个源可能同时有多个同义分类（如既有「国产动漫」又有「中国动漫」），全部返回。
 */
export function matchTypeIds(classes: ClassEntry[], category: string): string[] {
  const wanted = canonicalCategory(category);
  if (!wanted) return [];
  const ids: string[] = [];
  for (const entry of classes) {
    if (canonicalCategory(entry.name) !== wanted) continue;
    if (!ids.includes(entry.id)) ids.push(entry.id);
  }
  return ids;
}

/**
 * 汇总多源分类目录：同名（归一后）合并，记录有多少个源提供它。
 * 排序：先按源数量降序，再按中文名称，方便用户先看到覆盖最广的类别。
 */
export function aggregateCategories(
  perSource: { key: string; classes: ClassEntry[] }[]
): { name: string; sources: number }[] {
  const owners = new Map<string, Set<string>>();
  for (const source of perSource) {
    for (const entry of source.classes) {
      const name = canonicalCategory(entry.name);
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name)!.add(source.key);
    }
  }
  return [...owners.entries()]
    .map(([name, keys]) => ({ name, sources: keys.size }))
    .sort((a, b) => b.sources - a.sources || a.name.localeCompare(b.name, 'zh-Hans-CN'));
}

/** 分页追加：按「源 + 影片 ID」去重且保持已有顺序（源站翻页时会有重复条目） */
export function mergeBrowseItems(
  existing: SearchResultItem[],
  incoming: SearchResultItem[]
): SearchResultItem[] {
  const seen = new Set(existing.map((item) => `${item.sourceKey}_${item.vodId}`));
  const merged = [...existing];
  for (const item of incoming) {
    const key = `${item.sourceKey}_${item.vodId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

/** 从各源响应里取分页上限：取最大值，并兜底为 1 */
export function resolvePageCount(values: unknown[]): number {
  let max = 1;
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > max) max = Math.floor(n);
  }
  return max;
}
