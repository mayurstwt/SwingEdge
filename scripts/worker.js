/**
 * SwingEdge Automation Worker
 * Runs the strategy execution every 5 minutes.
 */

const API_URL = process.env.STRATEGY_API_URL || 'http://localhost:3000/api/run-strategy';
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function runStrategy() {
  const timestamp = new Date().toLocaleString();
  console.log(`[${timestamp}] 🚀 Triggering strategy execution...`);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bypassMarketFilter: false }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log(`[${timestamp}] ✅ Success: Processed ${data.processed} stocks.`);
      if (data.auto_buys.length > 0) console.log(`   🛒 Auto-buys: ${data.auto_buys.join(', ')}`);
      if (data.auto_sells.length > 0) console.log(`   💰 Auto-sells: ${data.auto_sells.join(', ')}`);
      
      // Log errors or skips from the backend
      const skips = data.logs.filter(l => l.includes('skipped'));
      if (skips.length > 0) {
        console.log(`   ℹ️ Skips: ${skips.length} stocks skipped (Check dashboard for reasons).`);
      }
    } else {
      console.error(`[${timestamp}] ❌ Error: ${data.error || 'Unknown error'}`);
    }
  } catch (err) {
    console.error(`[${timestamp}] ❌ Network Error:`, err.message);
  }
}

// Initial run
runStrategy();

// Schedule regular runs
setInterval(runStrategy, INTERVAL_MS);

console.log(`[${new Date().toLocaleString()}] 🤖 Worker started. Polling every 5 minutes at ${API_URL}`);
