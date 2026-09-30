import type { TokenTotals } from '../lib/types';
import { formatTokens, TOKENS_NA, TOKENS_NA_HINT } from '../lib/utils';

function breakdown(input: number, output: number, cacheRead: number): string {
  return `Input ${input.toLocaleString()} · Output ${output.toLocaleString()} · Cache leído ${cacheRead.toLocaleString()} (no incluido en el total)`;
}

/** "1.2M tokens (900k in · 300k out)", or "tokens n/d" when no turn reported them. */
export function TokensLine({ tokens }: { tokens?: TokenTotals }) {
  const hasData = !!tokens && ((tokens.turns_with_tokens ?? 0) > 0 || tokens.total > 0);
  if (!hasData) {
    return (
      <span className="text-xs font-mono text-zinc-600" title={TOKENS_NA_HINT}>
        tokens {TOKENS_NA}
      </span>
    );
  }
  return (
    <span className="text-xs font-mono text-zinc-300" title={breakdown(tokens.input, tokens.output, tokens.cache_read)}>
      {formatTokens(tokens.total)} tokens
      <span className="text-zinc-600"> ({formatTokens(tokens.input)} in · {formatTokens(tokens.output)} out)</span>
    </span>
  );
}

/** Compact value for tables: "12.3k", or "n/d" when the row has no token data. */
export function TokenValue({
  input,
  output,
  cacheRead,
  hasData,
}: {
  input?: number | null;
  output?: number | null;
  cacheRead?: number | null;
  hasData?: boolean;
}) {
  const known = hasData ?? (input != null || output != null);
  if (!known) {
    return <span className="font-mono text-zinc-600" title={TOKENS_NA_HINT}>{TOKENS_NA}</span>;
  }
  return (
    <span className="font-mono" title={breakdown(input ?? 0, output ?? 0, cacheRead ?? 0)}>
      {formatTokens((input ?? 0) + (output ?? 0))}
    </span>
  );
}
