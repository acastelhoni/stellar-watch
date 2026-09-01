/**
 * Aula 1 · infraestrutura do projeto (não é enfeite).
 *
 * Sem streaming no protocolo, tudo é polling — e polling contra provedor com
 * rate limit EXIGE backoff. Este helper é usado por `probe`, `read` e `pay`,
 * e vira a base do cursor durável do `poll.ts` na Aula 2.
 */

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Reconhece 429 (e 5xx) vindo do axios do SDK ou de um fetch cru. */
const status = (error: unknown): number | undefined => {
  const e = error as { response?: { status?: number }; status?: number };
  return e?.response?.status ?? e?.status;
};

const isRetryable = (error: unknown): boolean => {
  const code = status(error);
  if (code === 429) return true;
  if (code !== undefined && code >= 500) return true;
  // Falhas de rede não trazem status HTTP nenhum.
  const message = error instanceof Error ? error.message : String(error);
  return /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network/i.test(message);
};

export interface RetryOptions {
  maxRetries?: number;
  /** Base do backoff exponencial, em ms. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  label?: string;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 4, baseDelayMs = 1000, maxDelayMs = 15_000, label }: RetryOptions = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === maxRetries - 1) throw error;

      // Backoff exponencial com jitter: sem jitter, N clientes que tomaram 429
      // juntos voltam juntos e tomam 429 de novo.
      const delay = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
      const jittered = delay / 2 + Math.random() * (delay / 2);
      const where = label ? ` (${label})` : "";
      console.warn(
        `⏳ tentativa ${attempt + 1}/${maxRetries} falhou${where}; aguardando ${Math.round(jittered)}ms`,
      );
      await sleep(jittered);
    }
  }

  throw lastError;
}
