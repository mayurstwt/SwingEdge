import { createClient } from '@supabase/supabase-js';

interface LogEntry {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  message: string;
  symbol?: string;
  action?: string;
  score?: number;
  reason?: string;
  metadata?: Record<string, unknown>;
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export class StrategyLogger {
  private logs: LogEntry[] = [];
  private strategyRunId: string;

  constructor(strategyRunId: string) {
    this.strategyRunId = strategyRunId;
  }

  private formatMetadata(data?: unknown): Record<string, unknown> | undefined {
    if (!data) return undefined;
    if (data instanceof Error) {
      return { error: data.message, stack: data.stack };
    }
    if (typeof data === 'object' && data !== null) {
      return data as Record<string, unknown>;
    }
    return { data };
  }

  log(entry: LogEntry) {
    this.logs.push(entry);
    
    // Also log to console
    console.log(
      `[${entry.level}] ${entry.message}`,
      entry.symbol ? `(${entry.symbol})` : '',
      entry.metadata ? JSON.stringify(entry.metadata) : ''
    );
  }

  debug(message: string, data?: unknown) {
    this.log({ level: 'DEBUG', message, metadata: this.formatMetadata(data) });
  }

  info(message: string, data?: unknown) {
    this.log({ level: 'INFO', message, metadata: this.formatMetadata(data) });
  }

  warn(message: string, data?: unknown) {
    this.log({ level: 'WARN', message, metadata: this.formatMetadata(data) });
  }

  error(message: string, error?: Error, data?: unknown) {
    this.log({
      level: 'ERROR',
      message,
      metadata: {
        error: error?.message,
        stack: error?.stack,
        ...this.formatMetadata(data),
      },
    });
  }

  async flush() {
    if (this.logs.length === 0) return;

    try {
      await supabase.from('trade_logs').insert(
        this.logs.map(log => ({
          strategy_run_id: this.strategyRunId,
          level: log.level,
          message: log.message,
          symbol: log.symbol,
          action: log.action,
          score: log.score,
          reason: log.reason,
          metadata: log.metadata,
          created_at: new Date().toISOString(),
        }))
      );
      this.logs = []; // clear after flush
    } catch (error) {
      console.error('Failed to save logs:', error);
    }
  }
}
