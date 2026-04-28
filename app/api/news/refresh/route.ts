import { getNewsFeed } from '@/lib/news';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const payload = await getNewsFeed({
      forceRefresh: true,
      limit: 30,
    });

    return Response.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to refresh news';
    return Response.json({ error: message }, { status: 500 });
  }
}
