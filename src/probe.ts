/**
 * A primeira coisa que você roda contra QUALQUER provedor novo.
 *
 * Não existe "a janela de retenção do RPC". Existe a janela DAQUELA instância.
 * `oldestLedger` é o limite inferior: abaixo dele a instância não sabe responder.
 * Sondar vem antes de perguntar.
 */
import { config, redactedRpcUrl, rpc } from "./config.js";
import { withRetry } from "./retry.js";

/** Código JSON-RPC devolvido ao pedir ledger fora da janela sem data lake. */
const INVALID_REQUEST = -32600;

const jsonRpcCode = (error: unknown): number | undefined => {
  const e = error as { code?: number; response?: { data?: { error?: { code?: number } } } };
  return e?.code ?? e?.response?.data?.error?.code;
};

export interface ProbeResult {
  network: string;
  status: string;
  protocolVersion: string;
  latestLedger: number;
  oldestLedger: number;
  /** Profundidade real, em ledgers, desta instância. */
  windowLedgers: number;
  /** ~5s por ledger — só para dar noção humana da janela. */
  windowDays: number;
  /** true = `getLedgers` fura a janela (RPC Archive ou data lake configurado). */
  deepHistory: boolean;
}

export async function probe(): Promise<ProbeResult> {
  const [health, ledger] = await Promise.all([
    withRetry(() => rpc.getHealth(), { label: "getHealth" }),
    withRetry(() => rpc.getLatestLedger(), { label: "getLatestLedger" }),
  ]);

  const windowLedgers = ledger.sequence - health.oldestLedger;

  const result: ProbeResult = {
    network: config.network,
    status: health.status,
    protocolVersion: ledger.protocolVersion,
    latestLedger: ledger.sequence,
    oldestLedger: health.oldestLedger,
    windowLedgers,
    windowDays: (windowLedgers * 5) / 86_400,
    deepHistory: await hasDeepHistory(health.oldestLedger),
  };

  console.log("Rede:         ", result.network);
  console.log("RPC:          ", redactedRpcUrl());
  console.log("Passphrase:   ", config.networkPassphrase);
  console.log("Status:       ", result.status);
  console.log("Protocolo:    ", result.protocolVersion);
  console.log("Latest ledger:", result.latestLedger);
  console.log("Oldest ledger:", result.oldestLedger);
  console.log(
    "Janela:       ",
    `${result.windowLedgers} ledgers (~${result.windowDays.toFixed(1)} dias)`,
  );
  console.log(
    "Histórico:    ",
    result.deepHistory
      ? "getLedgers fura a janela (data lake / RPC Archive disponível)"
      : "getLedgers limitado ao oldestLedger (sem data lake)",
  );

  return result;
}

/**
 * RPC 23.0 integrou data lake ao `getLedgers`, e SÓ a ele: os demais métodos
 * continuam presos ao HISTORY_RETENTION_WINDOW do nó. Sem data lake, pedir um
 * ledger abaixo do oldestLedger falha com -32600. É esse erro que sondamos aqui.
 */
async function hasDeepHistory(oldestLedger: number): Promise<boolean> {
  const belowFloor = Math.max(2, oldestLedger - 1_000);
  if (belowFloor >= oldestLedger) return false;

  try {
    await rpc.getLedgers({ startLedger: belowFloor, pagination: { limit: 1 } });
    return true;
  } catch (error) {
    if (jsonRpcCode(error) === INVALID_REQUEST) return false;
    // Qualquer outra falha é ruído de rede/provedor, não resposta sobre histórico.
    return false;
  }
}
