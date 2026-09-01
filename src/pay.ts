/**
 * Construir → (simular) → assinar → enviar → aguardar.
 *
 * Dois caminhos, porque são mesmo dois caminhos diferentes:
 *
 *  - pagamento clássico (operação `payment`): não passa por simulação, porque
 *    `simulateTransaction` do RPC serve a UMA operação Soroban;
 *  - transferência de token (SAC / SEP-41): simulação é OBRIGATÓRIA. Não é boa
 *    prática opcional — é como o modelo de taxas do Soroban funciona: a
 *    simulação devolve o footprint e as taxas de recurso que a transação
 *    precisa carregar.
 *
 * `sendTransaction` devolve PENDING, nunca o resultado. O resultado só existe
 * depois — e é por isso que `waitForTransaction` existe logo abaixo.
 */
import * as StellarSdk from "@stellar/stellar-sdk";
import { config, rpc } from "./config.js";
import { sleep, withRetry } from "./retry.js";

const { Api } = StellarSdk.rpc;

export interface PayOptions {
  destination: string;
  /** Valor em unidades humanas: "1.5", não stroops. */
  amount: string;
  /** "native", "USDC:GA5Z...", ou o contract id (C...) de um SAC/token. */
  asset?: string;
  /** Casas decimais do token de contrato. Ignorado no caminho clássico. */
  decimals?: number;
  memo?: string;
  timeoutSeconds?: number;
}

export interface PayResult {
  hash: string;
  status: "SUCCESS" | "FAILED";
  ledger?: number;
  returnValue?: unknown;
}

const keypair = (): StellarSdk.Keypair => {
  const secret = process.env.STELLAR_SECRET_KEY;
  if (!secret) throw new Error("Variável de ambiente obrigatória ausente: STELLAR_SECRET_KEY");
  return StellarSdk.Keypair.fromSecret(secret);
};

const parseAsset = (spec: string): StellarSdk.Asset => {
  if (spec === "native" || spec === "XLM") return StellarSdk.Asset.native();
  const [code, issuer] = spec.split(":");
  if (!code || !issuer) throw new Error(`Ativo inválido: ${spec} (use "native" ou "CODE:ISSUER")`);
  return new StellarSdk.Asset(code, issuer);
};

/** "1.5" com 7 decimais → 15000000n. Sem float: dinheiro não é ponto flutuante. */
export const toBaseUnits = (amount: string, decimals: number): bigint => {
  const [whole = "0", fraction = ""] = amount.trim().split(".");
  if (fraction.length > decimals) {
    throw new Error(`Valor ${amount} tem mais de ${decimals} casas decimais`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
};

export async function pay(options: PayOptions): Promise<PayResult> {
  const asset = options.asset ?? "native";
  return asset.startsWith("C") && asset.length === 56
    ? payToken(asset, options)
    : payClassic(asset, options);
}

/* ------------------------------------------------------------------ */
/* Pagamento clássico                                                  */
/* ------------------------------------------------------------------ */

async function payClassic(assetSpec: string, options: PayOptions): Promise<PayResult> {
  const signer = keypair();
  const source = await withRetry(() => rpc.getAccount(signer.publicKey()), {
    label: "getAccount",
  });

  const builder = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: options.destination,
        asset: parseAsset(assetSpec),
        amount: options.amount,
      }),
    )
    .setTimeout(options.timeoutSeconds ?? 30);

  if (options.memo) builder.addMemo(StellarSdk.Memo.text(options.memo));

  const transaction = builder.build();
  transaction.sign(signer);

  console.log(`Enviando ${options.amount} ${assetSpec} → ${options.destination}`);
  return submit(transaction);
}

/* ------------------------------------------------------------------ */
/* Transferência de token (SAC / SEP-41)                               */
/* ------------------------------------------------------------------ */

async function payToken(contractId: string, options: PayOptions): Promise<PayResult> {
  const signer = keypair();
  const decimals = options.decimals ?? 7;
  const source = await withRetry(() => rpc.getAccount(signer.publicKey()), {
    label: "getAccount",
  });

  const contract = new StellarSdk.Contract(contractId);
  const raw = new StellarSdk.TransactionBuilder(source, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: config.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "transfer",
        StellarSdk.nativeToScVal(signer.publicKey(), { type: "address" }),
        StellarSdk.nativeToScVal(options.destination, { type: "address" }),
        StellarSdk.nativeToScVal(toBaseUnits(options.amount, decimals), { type: "i128" }),
      ),
    )
    .setTimeout(options.timeoutSeconds ?? 30)
    .build();

  const simulation = await withRetry(() => rpc.simulateTransaction(raw), {
    label: "simulateTransaction",
  });

  if (Api.isSimulationError(simulation)) {
    throw new Error(`Simulação falhou: ${simulation.error}`);
  }

  if (Api.isSimulationRestore(simulation)) {
    // Entrada arquivada: precisa de RestoreFootprint antes.
    throw new Error(
      `Estado arquivado: é preciso restaurar antes de invocar ` +
        `(minResourceFee da restauração: ${simulation.restorePreamble.minResourceFee}).`,
    );
  }

  // `cost` saiu do payload nas versões recentes do RPC; o que sobra — e o que
  // de fato importa — é o resource fee mínimo e o resultado previsto.
  console.log("Resource fee:", simulation.minResourceFee, "stroops");
  if (simulation.result) {
    console.log("Resultado previsto:", StellarSdk.scValToNative(simulation.result.retval));
  }

  // assembleTransaction devolve a transação com footprint e taxas embutidos.
  const prepared = StellarSdk.rpc.assembleTransaction(raw, simulation).build();
  prepared.sign(signer);

  console.log(`Enviando ${options.amount} de ${contractId} → ${options.destination}`);
  return submit(prepared);
}

/* ------------------------------------------------------------------ */
/* Envio e espera                                                      */
/* ------------------------------------------------------------------ */

async function submit(transaction: StellarSdk.Transaction): Promise<PayResult> {
  const response = await withRetry(() => rpc.sendTransaction(transaction), {
    label: "sendTransaction",
  });

  if (response.status !== "PENDING") {
    const detail = response.errorResult ? ` — ${response.errorResult.result.type}` : "";
    throw new Error(`Envio rejeitado: ${response.status}${detail}`);
  }

  console.log("Hash:", response.hash);
  return waitForTransaction(response.hash);
}

/**
 * O exemplo da documentação oficial é o mínimo viável, não o correto. Aqui o
 * loop está completo:
 *   - TIMEOUT: sem limite, `while (status === "NOT_FOUND")` é loop infinito
 *     em produção;
 *   - BACKOFF: polling de 1s contra provedor com rate limit vira HTTP 429;
 *   - DISTINÇÃO DE ESTADOS: NOT_FOUND ≠ FAILED. Saem do loop por caminhos
 *     diferentes — um é "ainda não sei", o outro é "a rede rejeitou".
 *
 * (O SDK também traz `rpc.Server.pollTransaction`, que resolve o mesmo
 * problema se você não precisar controlar os três pontos acima.)
 */
export async function waitForTransaction(
  hash: string,
  { timeoutMs = 60_000, intervalMs = 1_000, maxIntervalMs = 8_000 } = {},
): Promise<PayResult> {
  const deadline = Date.now() + timeoutMs;
  let delay = intervalMs;

  while (Date.now() < deadline) {
    const result = await withRetry(() => rpc.getTransaction(hash), { label: "getTransaction" });

    switch (result.status) {
      case Api.GetTransactionStatus.SUCCESS:
        console.log("✅ Sucesso no ledger", result.ledger);
        return {
          hash,
          status: "SUCCESS",
          ledger: result.ledger,
          returnValue: result.returnValue
            ? StellarSdk.scValToNative(result.returnValue)
            : undefined,
        };

      case Api.GetTransactionStatus.FAILED:
        // A rede aplicou e rejeitou: esperar mais não muda nada.
        throw new Error(
          `❌ Transação falhou no ledger ${result.ledger}: ${result.resultXdr.result.type}`,
        );

      case Api.GetTransactionStatus.NOT_FOUND:
        // Ainda não fechou em ledger. Só aqui vale continuar esperando.
        await sleep(delay);
        delay = Math.min(delay * 2, maxIntervalMs);
        break;
    }
  }

  throw new Error(
    `⏱️  Timeout aguardando ${hash}. A transação pode ainda ser aplicada — ` +
      `consulte o hash antes de reenviar (reenviar cega é como se duplica pagamento).`,
  );
}

/* ------------------------------------------------------------------ */
/* Friendbot (Testnet/Futurenet)                                       */
/* ------------------------------------------------------------------ */

export async function fund(publicKey: string): Promise<void> {
  if (!config.friendbotUrl) {
    throw new Error(`Não há friendbot em ${config.network}. Financie a conta por outro caminho.`);
  }
  const response = await fetch(`${config.friendbotUrl}?addr=${encodeURIComponent(publicKey)}`);
  if (!response.ok && response.status !== 400) {
    throw new Error(`Friendbot falhou: HTTP ${response.status}`);
  }
  console.log(`Conta ${publicKey} financiada em ${config.network}.`);
}
