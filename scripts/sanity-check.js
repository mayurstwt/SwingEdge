import fs from 'fs';
import path from 'path';

/**
 * SwingEdge Sanity Check
 * Verifies environment and connectivity
 */

async function runSanityCheck() {
  console.log('🔍 Starting SwingEdge Sanity Check...\n');

  let pass = true;

  // 1. Check Environment Variables
  console.log('--- Phase 1: Environment Check ---');
  
  // Try to load .env manually if it exists
  const envPath = path.join(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        process.env[key.trim()] = valueParts.join('=').trim();
      }
    });
    console.log('✅ Loaded environment from .env');
  }

  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ];

  for (const v of requiredVars) {
    if (!process.env[v]) {
      console.error(`❌ Missing environment variable: ${v}`);
      pass = false;
    } else {
      console.log(`✅ ${v} is set`);
    }
  }

  // 2. Database Connectivity
  if (pass) {
    console.log('\n--- Phase 2: Supabase Connectivity ---');
    try {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      const response = await fetch(`${url}/rest/v1/wallet?id=eq.1&select=*`, {
        headers: {
          'apikey': key,
          'Authorization': `Bearer ${key}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        if (data.length > 0) {
          console.log(`✅ Connected to Supabase. Wallet balance: ₹${data[0].balance}`);
        } else {
          console.warn('⚠️ Connected to Supabase, but wallet ID 1 not found.');
        }
      } else {
        const errorText = await response.text();
        console.error(`❌ Supabase connection failed: ${response.status} ${response.statusText}`);
        console.error(`Detail: ${errorText}`);
        pass = false;
      }
    } catch (err) {
      console.error(`❌ Supabase fetch error: ${err.message}`);
      pass = false;
    }
  }

  // 3. External API (Yahoo Finance)
  if (pass) {
    console.log('\n--- Phase 3: External API Connectivity ---');
    try {
      // Test with Nifty 50 index
      const symbol = '^NSEI';
      const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`);
      
      if (response.ok) {
        const data = await response.json();
        const price = data.chart.result[0].meta.regularMarketPrice;
        console.log(`✅ Yahoo Finance reachable. ${symbol} Current: ${price}`);
      } else {
        console.error(`❌ Yahoo Finance unreachable: ${response.status} ${response.statusText}`);
        pass = false;
      }
    } catch (err) {
      console.error(`❌ Yahoo Finance fetch error: ${err.message}`);
      pass = false;
    }
  }

  console.log('\n====================================');
  if (pass) {
    console.log('✨ ALL SYSTEMS GO. READY FOR DEPLOY.');
    process.exit(0);
  } else {
    console.log('🛑 SANITY CHECK FAILED. Fix the issues above before deploying.');
    process.exit(1);
  }
}

runSanityCheck();
