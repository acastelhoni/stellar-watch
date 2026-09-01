import { zstdDecompressSync } from "node:zlib";
import * as S from "@stellar/stellar-sdk";

const BUCKET = "https://aws-public-blockchain.s3.amazonaws.com";
const inv = (n: number) => (0xffffffff - n).toString(16).toUpperCase().padStart(8, "0");

function keyFor(seq: number, net = "pubnet"): string {
  const P = 64000;
  const start = Math.floor(seq / P) * P;
  const end = start + P - 1;
  return `v1.1/stellar/ledgers/${net}/${inv(start)}--${start}-${end}/${inv(seq)}--${seq}.xdr.zst`;
}

async function closeTime(seq: number): Promise<Date | null> {
  const r = await fetch(`${BUCKET}/${keyFor(seq)}`);
  if (!r.ok) return null;
  const raw = zstdDecompressSync(Buffer.from(await r.arrayBuffer()));
  const batch = S.xdr.LedgerCloseMetaBatch.fromXdr(raw);
  const meta = batch.ledgerCloseMetas[0]!;
  const header = meta.value.ledgerHeader.header;
  return new Date(Number(header.scpValue.closeTime) * 1000);
}

for (const seq of [41000000, 45000000, 50000000]) {
  console.log(seq, "→", (await closeTime(seq))?.toISOString() ?? "não encontrado");
}

// busca binária: primeiro ledger com closeTime >= alvo
async function findByDate(target: Date, lo = 40_000_000, hi = 52_000_000) {
  let probes = 0;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const t = await closeTime(mid);
    probes++;
    if (!t) throw new Error(`ledger ${mid} ausente no lake`);
    if (t < target) lo = mid + 1;
    else hi = mid;
  }
  console.log(`alvo ${target.toISOString()} → ledger ${lo} (${probes} requisições)`);
  console.log("  closeTime:", (await closeTime(lo))!.toISOString());
  return lo;
}
await findByDate(new Date("2023-01-01T00:00:00Z"));
