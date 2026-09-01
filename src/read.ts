/**
 * Leitura de estado de contrato via `getLedgerEntries`.
 *
 *  1. Você monta a CHAVE, não uma query. Não existe `SELECT WHERE` —
 *     você constrói o LedgerKey exato.
 *  2. São TRÊS tipos de storage, não dois:
 *       - `persistent` e `temporary` → cada chave é uma LEDGER ENTRY própria.
 *         É o que `read()` monta.
 *       - `instance` → um MAPA dentro da ledger entry da instância,
 *         cuja chave é `scvLedgerKeyContractInstance()`. É o que
 *         `readInstance()` lê. Nenhum símbolo endereça esse espaço.
 *  3. `entries.length === 0` tem três causas, e a mais comum é a primeira:
 *       - você montou a chave errada (storage, durability ou tipo errados);
 *       - a entrada nunca existiu;
 *       - a entrada sofreu state archival.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { rpc } from "./config.js";
import { withRetry } from "./retry.js";

export type Durability = "persistent" | "temporary";

export interface ReadResult {
  found: boolean;
  value: unknown;
  /** Ledger até o qual a entrada está viva; ausente em entradas clássicas. */
  liveUntilLedgerSeq?: number;
  lastModifiedLedgerSeq?: number;
}

/**
 * Lê a chave `symbol` do storage do contrato.
 * Ex.: read("CDLZ...", "COUNTER") → o valor nativo já decodificado do XDR.
 */
export async function read(
  contractId: string,
  symbol: string,
  durability: Durability = "persistent",
): Promise<ReadResult> {
  const key = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: new StellarSdk.Address(contractId).toScAddress(),
      key: StellarSdk.xdr.ScVal.scvSymbol(symbol),
      // SDK 17: as variantes de enum são propriedades estáticas, não funções.
      durability:
        durability === "temporary"
          ? StellarSdk.xdr.ContractDataDurability.temporary
          : StellarSdk.xdr.ContractDataDurability.persistent,
    }),
  );

  const entries = await withRetry(() => rpc.getLedgerEntries(key), {
    label: "getLedgerEntries",
  });

  if (entries.entries.length === 0) {
    // Ambíguo de propósito: inexistente OU arquivado.
    return { found: false, value: null };
  }

  const entry = entries.entries[0]!;

  // SDK 17: LedgerEntryData é união discriminada por `type`. O estreitamento é
  // obrigatório — e é bom que seja: o mesmo `getLedgerEntries` devolve conta,
  // trustline, TTL e contractData, e agora o compilador cobra a distinção.
  if (entry.val.type !== "contractData") {
    throw new Error(`Entrada inesperada: esperava contractData, veio ${entry.val.type}`);
  }

  return {
    found: true,
    // XDR só vira valor útil passando pelo SDK.
    value: StellarSdk.scValToNative(entry.val.contractData.val),
    liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
    lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq,
  };
}

export interface InstanceResult {
  found: boolean;
  /** "stellar_asset" para um SAC, ou o hash do Wasm para um contrato comum. */
  executable?: string;
  /** O instance storage, já decodificado. */
  storage: Record<string, unknown>;
  liveUntilLedgerSeq?: number;
}

/**
 * Lê o storage de INSTÂNCIA do contrato.
 *
 * Por que isso não é um caso particular de `read()`: o espaço de instância não
 * é endereçado por símbolo. Ele é um mapa que vive dentro de UMA ledger entry
 * — a da instância — e vem inteiro, de uma vez. Pedir
 * `scvSymbol("METADATA")` no espaço persistente devolve zero entradas mesmo
 * quando `METADATA` existe, porque a chave aponta para outro espaço.
 */
export async function readInstance(contractId: string): Promise<InstanceResult> {
  const key = StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: new StellarSdk.Address(contractId).toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      // A instância é sempre persistente.
      durability: StellarSdk.xdr.ContractDataDurability.persistent,
    }),
  );

  const entries = await withRetry(() => rpc.getLedgerEntries(key), {
    label: "getLedgerEntries(instance)",
  });

  if (entries.entries.length === 0) return { found: false, storage: {} };

  const entry = entries.entries[0]!;
  if (entry.val.type !== "contractData") {
    throw new Error(`Entrada inesperada: esperava contractData, veio ${entry.val.type}`);
  }

  const value = entry.val.contractData.val;
  if (value.type !== "scvContractInstance") {
    throw new Error(`Entrada inesperada: esperava a instância, veio ${value.type}`);
  }

  const { executable, storage } = value.instance;

  return {
    found: true,
    executable:
      executable.type === "contractExecutableWasm"
        ? executable.wasmHash.toString()
        : "stellar_asset",
    // O storage vem como lista de pares XDR; cada lado passa pelo SDK.
    storage: Object.fromEntries(
      (storage ?? []).map((e) => [
        String(StellarSdk.scValToNative(e.key)),
        StellarSdk.scValToNative(e.val),
      ]),
    ),
    liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
  };
}

/**
 * O RPC devolve o MÍNIMO para construir uma transação: essencialmente o número
 * de sequência. Sem saldos, sem trustlines, sem signers, sem thresholds.
 * Isso é escopo, não falta — metadado rico é pergunta de outra camada
 * (Hubble ou um indexador de ecossistema).
 */
export async function readAccount(publicKey: string): Promise<{ id: string; sequence: string }> {
  const account = await withRetry(() => rpc.getAccount(publicKey), { label: "getAccount" });
  return { id: account.accountId(), sequence: account.sequenceNumber() };
}
