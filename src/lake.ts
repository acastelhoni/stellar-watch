/**
 * Leitura direta do data lake público de ledgers (AWS Open Data).
 *
 * Este é o caminho que **não** passa pelo Stellar RPC: em vez de perguntar a
 * um servidor, você baixa o arquivo do ledger de um bucket S3 público e o
 * decodifica localmente. É assim que se lê 2023 — muito além da janela de
 * retenção de qualquer instância de RPC.
 *
 * Layout do bucket (declarado em `.config.json` do próprio lake):
 *   compression        zstd
 *   ledgersPerBatch    1        → um arquivo por ledger
 *   batchesPerPartition 64000   → um diretório a cada 64.000 ledgers
 *
 * E os nomes carregam o número do ledger **invertido** (0xFFFFFFFF - seq),
 * truque para que a ordenação lexicográfica da S3 devolva os ledgers mais
 * recentes primeiro.
 */
import { zstdDecompressSync } from "node:zlib";
import * as StellarSdk from "@stellar/stellar-sdk";
import { withRetry } from "./retry.js";

const BUCKET = "https://aws-public-blockchain.s3.amazonaws.com";
const BATCHES_PER_PARTITION = 64_000;

export type LakeNetwork = "pubnet" | "testnet";

const inverted = (n: number): string =>
  (0xffffffff - n).toString(16).toUpperCase().padStart(8, "0");

const partitionOf = (sequence: number): string => {
  const start = Math.floor(sequence / BATCHES_PER_PARTITION) * BATCHES_PER_PARTITION;
  return `${inverted(start)}--${start}-${start + BATCHES_PER_PARTITION - 1}`;
};

/**
 * Monta a chave S3 exata de um ledger de pubnet. Nenhuma listagem é necessária:
 * o caminho inteiro é função do número do ledger.
 */
export function lakeKey(sequence: number): string {
  return `v1.1/stellar/ledgers/pubnet/${partitionOf(sequence)}/${inverted(sequence)}--${sequence}.xdr.zst`;
}

/**
 * A Testnet é resetada periodicamente, e o lake registra isso: cada reset abre
 * uma pasta nova, nomeada pela data (`.../testnet/2025-12-17/...`). O mesmo
 * número de ledger pode existir em mais de uma época — e a extensão lá é
 * `.xdr.zstd`, não `.xdr.zst`. Por isso testnet exige uma listagem; pubnet não.
 */
async function testnetEpochs(): Promise<string[]> {
  const url =
    `${BUCKET}/?list-type=2&delimiter=/&prefix=v1.1/stellar/ledgers/testnet/&max-keys=100`;
  const xml = await (await fetch(url)).text();
  return [...xml.matchAll(/<Prefix>v1\.1\/stellar\/ledgers\/testnet\/(\d{4}-\d{2}-\d{2})\//g)]
    .map((m) => m[1]!)
    .sort()
    .reverse(); // a época mais recente primeiro
}

async function testnetKey(sequence: number): Promise<string> {
  // A extensão varia entre épocas (.xdr.zst e .xdr.zstd), então resolvemos a
  // chave por listagem exata do prefixo em vez de adivinhar o sufixo.
  for (const epoch of await testnetEpochs()) {
    const stem =
      `v1.1/stellar/ledgers/testnet/${epoch}/${partitionOf(sequence)}/${inverted(sequence)}--${sequence}.`;
    const xml = await (
      await fetch(`${BUCKET}/?list-type=2&prefix=${encodeURIComponent(stem)}&max-keys=1`)
    ).text();
    const found = /<Key>([^<]+)<\/Key>/.exec(xml);
    if (found) return found[1]!;
  }
  throw new Error(`Ledger ${sequence} não está em nenhuma época do lake de testnet.`);
}

export interface LakeLedger {
  sequence: number;
  closeTime: Date;
  protocolVersion: number;
  ledgerHash: string;
  previousLedgerHash: string;
  /** Em stroops. */
  totalCoins: bigint;
  feePool: bigint;
  baseFee: number;
  transactions: {
    hash: string;
    /** `txSuccess`, `txFailed`, … */
    result: string;
    operations: number;
  }[];
  /** O XDR cru do arquivo, para quem quiser reprocessar. */
  xdr: Buffer;
}

/** Baixa e decodifica um ledger inteiro do data lake. */
export async function readLedger(
  sequence: number,
  network: LakeNetwork = "pubnet",
): Promise<LakeLedger> {
  const key = network === "testnet" ? await testnetKey(sequence) : lakeKey(sequence);
  const url = `${BUCKET}/${key}`;

  const compressed = await withRetry(
    async () => {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(
          response.status === 404
            ? `Ledger ${sequence} não está no data lake (${network}).`
            : `S3 respondeu ${response.status} para ${sequence}`,
        );
      }
      return Buffer.from(await response.arrayBuffer());
    },
    { label: `lake ${sequence}` },
  );

  const xdr = zstdDecompressSync(compressed);
  const batch = StellarSdk.xdr.LedgerCloseMetaBatch.fromXdr(xdr);
  const meta = batch.ledgerCloseMetas[0];
  if (!meta) throw new Error(`Arquivo do ledger ${sequence} veio vazio`);

  // LedgerCloseMeta é união v0/v1/v2 — os três arms têm ledgerHeader e
  // txProcessing, então `.value` basta para o que lemos aqui.
  const arm = meta.value;
  const header = arm.ledgerHeader.header;

  return {
    sequence: header.ledgerSeq,
    closeTime: new Date(Number(header.scpValue.closeTime) * 1000),
    protocolVersion: header.ledgerVersion,
    ledgerHash: arm.ledgerHeader.hash.toString(),
    previousLedgerHash: header.previousLedgerHash.toString(),
    totalCoins: header.totalCoins,
    feePool: header.feePool,
    baseFee: header.baseFee,
    transactions: arm.txProcessing.map((tx) => ({
      hash: tx.result.transactionHash.toString(),
      result: tx.result.result.result.type,
      operations: countOperations(tx.result.result.result),
    })),
    xdr,
  };
}

function countOperations(result: StellarSdk.xdr.TransactionResultResult): number {
  if (result.type === "txSuccess" || result.type === "txFailed") return result.results.length;
  // Fee bump: as operações estão na transação interna, não na externa.
  if (result.type === "txFeeBumpInnerSuccess" || result.type === "txFeeBumpInnerFailed") {
    const inner = result.innerResultPair.result.result;
    if (inner.type === "txSuccess" || inner.type === "txFailed") return inner.results.length;
  }
  return 0;
}

/**
 * Encontra o primeiro ledger fechado em ou depois de `target`, por busca
 * binária sobre o próprio lake. Cada passo é um GET de um arquivo pequeno,
 * então ~24 requisições cobrem a rede inteira.
 */
export async function findLedgerByDate(
  target: Date,
  network: LakeNetwork = "pubnet",
  bounds: { lo?: number; hi?: number } = {},
): Promise<number> {
  let lo = bounds.lo ?? 2;
  let hi = bounds.hi ?? 70_000_000;

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const ledger = await readLedger(mid, network);
    if (ledger.closeTime < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

const stroops = (v: bigint): string => (Number(v) / 1e7).toLocaleString("pt-BR");

export function printLedger(ledger: LakeLedger, limit = 10): void {
  console.log("Ledger:      ", ledger.sequence);
  console.log("Fechado em:  ", ledger.closeTime.toISOString());
  console.log("Protocolo:   ", ledger.protocolVersion);
  console.log("Hash:        ", ledger.ledgerHash);
  console.log("Hash anterior:", ledger.previousLedgerHash);
  console.log("Total em circulação:", stroops(ledger.totalCoins), "XLM");
  console.log("Fee pool:    ", stroops(ledger.feePool), "XLM");
  console.log("Base fee:    ", ledger.baseFee, "stroops");
  console.log("Tamanho XDR: ", ledger.xdr.length, "bytes");

  const ok = ledger.transactions.filter((t) => t.result.endsWith("Success")).length;
  const ops = ledger.transactions.reduce((n, t) => n + t.operations, 0);
  console.log(
    "Transações:  ",
    `${ledger.transactions.length} (${ok} ok, ${ledger.transactions.length - ok} falharam) · ${ops} operações`,
  );

  const mostrar = limit < 0 ? ledger.transactions : ledger.transactions.slice(0, limit);
  for (const tx of mostrar) {
    const marca = tx.result.endsWith("Success") ? "✅" : "❌";
    console.log(`  ${marca} ${tx.hash}  ${tx.result}  ${tx.operations} op`);
  }
  const resto = ledger.transactions.length - mostrar.length;
  if (resto > 0) console.log(`  … mais ${resto}. Use --txs para ver todas.`);
}
