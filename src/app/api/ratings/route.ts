import { NextResponse } from 'next/server';
import { guardRequest, jsonError } from '@/lib/api-guard';
import { fetchDoubanRating } from '@/lib/douban-ratings';
import { parseRatingQueries } from '@/lib/ratings';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;
  if (Number(req.headers.get('content-length')) > 16_384) return jsonError('请求过大', 413);
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 16_384) return jsonError('请求过大', 413);
    body = JSON.parse(text);
  } catch { return jsonError('无效的 JSON', 400); }
  const items = parseRatingQueries(body);
  if (!items) return jsonError('需提供 1–12 个片名（最多 120 字）与可选的四位年份', 400);
  const results = await Promise.all(items.map(fetchDoubanRating));
  return NextResponse.json({ results }, { headers: { 'Cache-Control': 'private, no-store' } });
}
