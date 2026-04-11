import Fuse from "fuse.js";
import stocks from "@/data/stocks.json";

const fuse = new Fuse(stocks, {
  keys: ["symbol", "name", "sector"],
  threshold: 0.35,
  includeScore: true,
});

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() ?? "";

  if (!q || q.length < 1) {
    // Return top 8 popular stocks when no query
    return Response.json(stocks.slice(0, 8));
  }

  const results = fuse
    .search(q)
    .slice(0, 8)
    .map((r) => r.item);

  return Response.json(results);
}
