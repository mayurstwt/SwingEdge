import { getNewsFeed, type NewsSourceType } from '@/lib/news';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const typeParam = searchParams.get('type');
    const sourceType =
      typeParam === 'market' ? 'MARKET' :
      typeParam === 'company' ? 'COMPANY' :
      undefined;
    const symbol = searchParams.get('symbol')?.trim().toUpperCase() || undefined;
    const limitParam = Number(searchParams.get('limit') ?? 24);
    const forceRefresh = searchParams.get('refresh') === '1';
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 60) : 24;

    const payload = await getNewsFeed({
      forceRefresh,
      limit,
      sourceType: sourceType as NewsSourceType | undefined,
      symbol,
    });

    return Response.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch news';
    return Response.json({ error: message }, { status: 500 });
  }
}
