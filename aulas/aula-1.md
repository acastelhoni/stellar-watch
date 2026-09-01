# Módulo 4 · Aula 1 — Fundação do projeto

**Stellar RPC, XDR e a pilha de dados moderna** · 90 minutos · 20 slides + 2 anexos

## Como esta aula funciona

Não se digita código ao vivo. O projeto **Stellar Watch** já está no repositório; cada slide de código mostra **um trecho curto** para ler e explicar. Em sala roda-se apenas os comandos.

**Preparo do instrutor:** criar a API key da Alchemy antes da aula, deixar o `.env` pronto e rodar `pnpm install` uma vez. A chave vai na URL — nunca versionar, nunca expor em frontend.

**Baseline:** Mainnet no Protocolo 27 ("Zipper"), Stellar RPC 23.0+, `@stellar/stellar-sdk` 17.

**Sem Horizon.** A pilha é Stellar RPC + data lake (`getLedgers`) + Hubble + indexadores. O Horizon aparece uma vez, como contexto histórico, e no Anexo A como tabela de equivalência.

---

## Slide 1 — Capa

Título: **Fundação do projeto**
Subtítulo: Stellar RPC, XDR e a pilha de dados moderna
Rodapé: Módulo 4 · Aula 1 · 90 minutos

---

## Slide 2 — O projeto do módulo: Stellar Watch

Um monitor de pagamentos de linha de comando. Três aulas, cumulativo.

| Aula | Entra no projeto |
|---|---|
| **1 — hoje** | `config` · `retry` · `probe` · `read` · `pay` |
| **2** | `poll` — cursor durável · `ledgers` — histórico via data lake |
| **3** | `events` — eventos unificados · `reconcile` — RPC vs Hubble vs indexador |

No fim, o projeto responde à pergunta que abre todo projeto real na Stellar: **de onde eu leio esse dado?**

> O código de hoje já está no repositório. Não vamos digitá-lo — vamos lê-lo e rodá-lo. Cada slide de código é o trecho que importa, não o arquivo inteiro.

**Nota do instrutor:** deixar claro que o projeto é cumulativo e que ninguém apaga o código no fim da aula. Pedir que abram o repositório em paralelo aos slides.

---

## Slide 3 — Quatro camadas, cinco perguntas

| Camada | Janela | Serve para |
|---|---|---|
| **Stellar RPC** | ~dias a semanas | Simulação, envio, estado de contrato, eventos |
| **Data lake** via `getLedgers` | Completa | Ledgers antigos, reprocessamento, auditoria |
| **Hubble** (BigQuery) | Completa | Agregação, extratos, BI, compliance |
| **Indexadores** de ecossistema | Completa | Portfólio, histórico de conta, dado pronto |

| Pergunta | Onde |
|---|---|
| "Qual o valor guardado nessa chave do contrato?" | RPC `getLedgerEntries` |
| "Me avise quando um pagamento chegar." | RPC `getEvents` + polling |
| "Extrato completo dessa conta desde 2024." | Hubble ou indexador |
| "Volume mensal por ativo nos últimos 12 meses." | Hubble |

> Escolher a camada errada passa no protótipo e quebra em produção.

---

## Slide 4 — E o Horizon?

API REST original da Stellar. **Não vamos ensiná-la neste módulo.** Dois motivos concretos:

1. **A documentação oficial já a trata como legado.** Existe guia dedicado de migração de Horizon para RPC. Projeto novo começa no RPC.
2. **Não é mais a fonte de histórico completo que as pessoas imaginam.** Em 1º de agosto de 2024, o Horizon público da SDF teve o histórico truncado para um ano.

> Quem usa o Horizon público esperando histórico completo já está com um bug latente. A resposta moderna para histórico é data lake e Hubble.

**Nota do instrutor:** único slide do módulo sobre Horizon. A tabela de equivalência está no Anexo A, para quem for manter código legado.

---

## Slide 5 — Onde roda o RPC, e por que a Alchemy

| Rede | RPC |
|---|---|
| **Mainnet** | Provedor de ecossistema, ou nó próprio |
| **Testnet** | `https://soroban-testnet.stellar.org` (público da SDF) |
| **Local** | `http://localhost:8000/soroban/rpc` |

**Não há endpoint público de RPC para Mainnet.** Seu código funciona no desenvolvimento e para de funcionar no dia do deploy, se você não resolveu isso antes.

**O padrão do curso é a Alchemy:** uma API key cobre Testnet e Mainnet, e cobre três produtos — **Stellar RPC**, **websockets** e a **Stellar Data API** (transferências, saldos de conta e NFTs, já indexados).

```
https://stellar-testnet.g.alchemy.com/v2/<api-key>
https://stellar-mainnet.g.alchemy.com/v2/<api-key>
```

> Bom padrão didático: as três camadas do módulo atrás de uma única chave, sem trocar de fornecedor no meio do caminho.

---

## Slide 6 — A chave vai na URL ⚠️

```
https://stellar-testnet.g.alchemy.com/v2/SUA_CHAVE_AQUI
                                         ^^^^^^^^^^^^^^
```

Isso muda o que você pode fazer com essa string:

- **Nunca** versione. `.env` no `.gitignore`, sempre.
- **Nunca** coloque em código de frontend. A chave viaja para o navegador do usuário e vira chave de qualquer um.
- Frontend que precisa de RPC chama **seu** backend, que chama o provedor.

> Primeiro erro de segurança da trilha. Não é sobre a Alchemy — é sobre qualquer provedor cujo endpoint carrega credencial no path.

---

## Slide 7 — A janela é da instância, não do RPC

Não existe "a janela de retenção do RPC". Existe a janela **daquela instância** — e o `oldestLedger` é o limite inferior: abaixo dele, ela não sabe responder.

**`getLedgers` é a exceção.** O Stellar RPC 23.0 integrou data lake a esse método, permitindo ler ledgers **fora da janela local**. Só ele: todos os outros seguem presos ao `HISTORY_RETENTION_WINDOW` do nó. Sem data lake, um `getLedgers` abaixo do `oldestLedger` falha com **`-32600`**.

**E existe data lake público e gratuito**, no programa AWS Open Data:

```
s3://aws-public-blockchain/v1.1/stellar/ledgers/pubnet
```

Alternativa self-hosted: o **Galexie**, que implanta seu próprio data lake em S3 ou GCS — e é a base do **CDP (Composable Data Pipeline)**.

> É o mecanismo que substitui o Horizon como fonte de histórico bruto. A Aula 2 constrói o `ledgers.ts` em cima dele.

---

## Slide 8 — Hubble, e a regra de bolso

**Hubble** é o data warehouse público da SDF no BigQuery: histórico completo, agregação poderosa, queries prontas equivalentes a cada endpoint clássico. **Mas não há garantia de dados no mesmo dia** — serve a extrato, volume por ativo, compliance e BI; **não** serve para confirmar se o pagamento do cliente entrou agora.

**Stellar RPC** — desenvolvimento novo · contratos · simulação e envio · estado atual · eventos

**Data lake + `getLedgers`** — histórico bruto · reprocessamento · auditoria · alimentar seu próprio índice

**Hubble** — agregação · extratos · compliance · BI

**Indexador de ecossistema** — quando você quer o dado pronto e não quer operar pipeline

---

## Slide 9 — JSON-RPC 2.0 não é REST

| | REST | Stellar RPC |
|---|---|---|
| Estilo | Recurso na URL, verbo HTTP | Um endpoint, método no corpo |
| Erros | Códigos de status HTTP | Objeto `error` do JSON-RPC |
| Streaming | Depende | **Não no protocolo** — polling |

```json
{ "jsonrpc": "2.0", "id": 8675309,
  "method": "getLedgerEntries", "params": { "keys": ["AAAABgAAAAG..."] } }

{ "jsonrpc": "2.0", "id": 8675309,
  "error": { "code": -32600, "message": "..." } }
```

> **O protocolo Stellar RPC não tem streaming.** Alguns provedores, a Alchemy entre eles, oferecem websockets como extensão própria. Polling é a linha de base portátil; websocket é conveniência de fornecedor.

---

## Slide 10 — XDR, e o alerta que vale o módulo inteiro ⚠️

Vários valores vêm codificados em **XDR** e só viram dado útil passando pelo SDK. Apoio: visualizador de XDR e conversão XDR → JSON no **Stellar Lab**.

O schema de conversão **JSON/XDR não é retrocompatível** entre versões de protocolo. A rede entregou os Protocolos 23 → 27 em cerca de 18 meses, e o 28 já está na Testnet.

**Nunca persista JSON derivado de XDR** assumindo estabilidade entre protocolos.

> Guarde o XDR bruto, ou guarde o dado já normalizado no **seu** schema. Nunca o intermediário.

**Nota do instrutor:** se sobrar tempo, abrir o Stellar Lab e colar um XDR de verdade. O impacto visual do "isto aqui é o dado" costuma valer mais que o slide.

---

## Slide 11 — `config.ts`: uma factory por rede

```typescript
const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Falta a variável: ${name}`);
  return value;
};

const alchemy = (net: "mainnet" | "testnet") =>
  `https://stellar-${net}.g.alchemy.com/v2/${requireEnv("ALCHEMY_API_KEY")}`;

const configs = {
  mainnet: () => ({ rpcUrl: alchemy("mainnet"), networkPassphrase: Networks.PUBLIC }),
  testnet: () => ({ rpcUrl: alchemy("testnet"), networkPassphrase: Networks.TESTNET }),
};
```

**Factories lazy.** O `requireEnv` só roda para a rede selecionada. Se rodasse no carregamento do módulo, ninguém rodaria o projeto sem ter as credenciais de **todas** as redes.

**A URL é montada, não copiada.** Constante colada por rede = a mesma chave em dois lugares.

---

## Slide 12 — `config.ts`: um cliente, e uma linha para trocar de rede

```typescript
type NetworkName = keyof typeof configs;
const isNetworkName = (v: string): v is NetworkName => v in configs;

const network = process.env.STELLAR_NETWORK ?? "testnet";
if (!isNetworkName(network)) throw new Error(`Rede desconhecida: ${network}`);

export const config = configs[network]();
export const rpc = new StellarSdk.rpc.Server(config.rpcUrl);
```

```bash
pnpm install && cp .env.example .env     # ALCHEMY_API_KEY, STELLAR_NETWORK
```

**Um cliente, não dois.** O `@stellar/stellar-sdk` traz o namespace `rpc`. Não existe mais `soroban-client` separado; tutorial que pede isso é velho.

> Trocar Testnet por Mainnet é mudar **uma linha do `.env`**. E note o host de Testnet: ainda é `soroban-testnet.stellar.org`, apesar de a marca ser **Stellar RPC** e a CLI ser `stellar`. Hoje "Soroban" é o *runtime* de contratos; nomes antigos sobrevivem em URLs.

---

## Slide 13 — `probe.ts`: a primeira coisa em qualquer provedor novo

```typescript
const health = await rpc.getHealth();
const ledger = await rpc.getLatestLedger();

console.log("Protocolo:    ", ledger.protocolVersion);
console.log("Latest ledger:", ledger.sequence);
console.log("Oldest ledger:", health.oldestLedger);
console.log("Janela:       ", ledger.sequence - health.oldestLedger, "ledgers");
```

```bash
pnpm run probe
```

**`protocolVersion`** — Mainnet no 27 ("Zipper"); a Testnet costuma estar à frente. **`oldestLedger`** — o limite inferior, que define o que você **pode** perguntar. **A janela calculada** — a profundidade real que você tem.

> Olhem o `protocolVersion` no terminal. É assim que se descobre, em 200 ms, se o tutorial que você está seguindo é contemporâneo do seu código.

**Nota do instrutor:** momento de virada da aula. Ler em voz alta o valor da própria tela e comparar Testnet com Mainnet — é a prova viva de que "a rede Stellar" tem versões. Se der, rodar também contra o RPC público e mostrar a janela menor.

---

## Slide 14 — `read.ts`: você monta a chave, não uma query

```typescript
const key = StellarSdk.xdr.LedgerKey.contractData(
  new StellarSdk.xdr.LedgerKeyContractData({
    contract: new StellarSdk.Address(contractId).toScAddress(),
    key: StellarSdk.xdr.ScVal.scvSymbol(symbol),
    durability: StellarSdk.xdr.ContractDataDurability.persistent,
  })
);

const entries = await rpc.getLedgerEntries(key);
if (entries.entries.length === 0) return null;

const entry = entries.entries[0];
if (entry.val.type !== "contractData") throw new Error("entrada inesperada");
return StellarSdk.scValToNative(entry.val.contractData.val);
```

Não existe `SELECT WHERE`: você constrói o `LedgerKey` exato. E o SDK 17 exige estreitar a união por `type` — o mesmo `getLedgerEntries` devolve account, trustline, TTL e `contractData`.

---

## Slide 15 — Três tipos de storage, não dois

**`persistent`** e **`temporary`** — cada chave é uma **ledger entry própria**. É o que o slide anterior montou. São espaços distintos: chave certa, `durability` errada = nada encontrado.

**`instance`** — um **mapa dentro da ledger entry da instância**, endereçado por `scvLedgerKeyContractInstance()`. Vem inteiro, de uma vez. Nenhum símbolo aponta para lá.

```bash
export SAC=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
pnpm run read $SAC METADATA      # → (vazio)
pnpm run read $SAC --instance    # → { METADATA: { decimal: 7, name: 'native' … } }
```

**`entries.length === 0` tem três causas**, e a primeira é a mais comum:

1. **Chave errada** — storage, `durability` ou tipo.
2. **Nunca existiu.**
3. **Arquivada** — state archival, tema do Módulo 6.

**Nota do instrutor:** rodar os dois comandos na tela. O primeiro parece "não existe"; o segundo prova que o dado estava lá o tempo todo. É o erro que a turma inteira vai cometer no primeiro contrato.

---

## Slide 16 — `pay.ts`: simular vem antes

```typescript
const simulation = await rpc.simulateTransaction(transaction);

if (StellarSdk.rpc.Api.isSimulationError(simulation)) {
  throw new Error(`Simulação falhou: ${simulation.error}`);
}

console.log("Resource fee:", simulation.minResourceFee);
const prepared = StellarSdk.rpc.assembleTransaction(transaction, simulation).build();
```

A simulação devolve o **footprint** e o **resource fee**, e o `assembleTransaction` embute os dois na transação.

> **Toda** chamada de contrato é precedida de simulação. Não é boa prática opcional — é como o modelo de fees do Soroban funciona. Pagamento clássico é o outro caminho: não passa por aqui, porque `simulateTransaction` serve a uma operação Soroban.

**`getAccount` devolve só o sequence number** — sem balances, trustlines ou signers. É escopo, não falta: metadado rico é pergunta de outra camada, e vira o `reconcile.ts` na Aula 3.

---

## Slide 17 — `pay.ts`: `PENDING` não é sucesso ⚠️

```typescript
const response = await rpc.sendTransaction(signedTransaction);
if (response.status !== "PENDING") throw new Error(`Rejeitado: ${response.status}`);

let result = await rpc.getTransaction(response.hash);
while (result.status === "NOT_FOUND") {          // 🚩 o exemplo da doc oficial
  await new Promise(r => setTimeout(r, 1000));
  result = await rpc.getTransaction(response.hash);
}
```

`sendTransaction` devolve **`PENDING`** — não o resultado. O resultado só existe depois. E este loop tem três buracos:

- **Timeout.** Sem limite, isso é loop infinito em produção.
- **Backoff.** Polling de 1 s contra provedor com rate limit = HTTP 429.
- **Distinção de estados.** `NOT_FOUND` ≠ `FAILED`. Um é "ainda não sei", o outro é "a rede rejeitou" — e esperar mais não muda nada.

> É o exemplo que está na documentação oficial. É o mínimo viável, não o correto. O `pay.ts` do repositório corrige os três.

---

## Slide 18 — `retry.ts`: infraestrutura, não enfeite

```typescript
export async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (status(error) !== 429) throw error;
      const delay = 2 ** i * 1000;
      // Jitter: sem ele, N clientes que tomaram 429 juntos voltam juntos.
      await new Promise(r => setTimeout(r, delay / 2 + Math.random() * delay / 2));
    }
  }
  throw lastError;
}
```

Sem streaming no protocolo, **tudo é polling** — e polling contra provedor com rate limit **exige** backoff. Este helper é a base do cursor durável da Aula 2.

---

## Slide 19 — O que o RPC é, e o que o projeto já faz

1. **Janela de histórico limitada** na maioria dos métodos.
2. **`getLedgers` é a exceção**, com data lake.
3. **Sem streaming no protocolo** — polling é a linha de base.
4. **Focado em contratos e estado atual.**

Nenhuma é defeito: é o escopo da ferramenta — e os itens 1 e 3 motivam a Aula 2.

```
src/
├── config.ts   ✅  configuração por rede, cliente RPC
├── retry.ts    ✅  backoff com jitter
├── probe.ts    ✅  health, protocolo, oldestLedger
├── read.ts     ✅  estado por chave e por instância, XDR decodificado
└── pay.ts      ✅  construir, simular, enviar, aguardar
```

**Quatro camadas**, não uma API. **`probe` primeiro** — o `oldestLedger` define o que se pode perguntar. **JSON-RPC ≠ REST**, e XDR nunca é persistido como JSON entre protocolos. **Simulação antes de toda chamada de contrato.**

---

## Slide 20 — O que vem por aí

**Aula 2 — Histórico sem Horizon** · entra `poll.ts` e `ledgers.ts`

- **Cursor durável.** Existe um erro que quase toda integração comete: retomar do "agora" em vez do último registro processado. Não gera exceção, não aparece em log, e **faz pagamentos desaparecerem**. Vamos derrubar a conexão de propósito e ver acontecer.
- **`getLedgers` além da janela** — RPC Archive do provedor ou o data lake público. E **Hubble na prática**, com as queries de extrato e balance.

**Aula 3 — Eventos unificados e reconciliação** · entra `events.ts` e `reconcile.ts`

- **CAP-67, Protocolo 23:** pagamentos viraram **eventos** de `transfer`, lidos por `getEvents`. A ordenação mudou junto — e todo indexador escrito contra a ordem antiga passou a errar da noite para o dia.
- **`reconcile.ts`** consulta a mesma conta em **três fontes** — RPC, Hubble e Stellar Data API — e mostra onde cada uma para.

> O Stellar Watch já sabe **onde está** e **o que pode perguntar**. Na Aula 2 ele ganha memória. 🚀

---

## Anexo A — Equivalência sem Horizon

*Não apresentar — referência para quem for manter código legado.*

| Endpoint clássico | Substituto |
|---|---|
| `/accounts` (estado) | RPC `getAccount` (só sequence number) · Hubble `accounts` |
| `/accounts` (balances, trustlines, signers) | Hubble `trust_lines`, `account_signers` |
| `/transactions` | RPC `getTransactions` · Hubble `history_transactions` |
| `/operations` | Hubble `enriched_history_operations` |
| `/payments` | RPC `getEvents` (`transfer`) · Hubble tipos 0,1,2,8,13 |
| `/effects` · `/trades` | Hubble `history_effects` · `history_trades` |
| `/offers`, `/order_book` | Hubble `offers_current` |
| `/claimable_balances` · `/liquidity_pools` | Hubble `claimable_balances` · `liquidity_pools_current` |
| `/ledgers` | RPC `getLedgers` + data lake · Hubble `history_ledgers` |

Datasets: `crypto-stellar.crypto_stellar.*` e `crypto-stellar.crypto_stellar_dbt.*`

---

## Anexo B — Path finding e categorias de indexador

*Não apresentar.*

**A única dependência residual do Horizon é o path finding** (`/paths`). As operações `PathPaymentStrictSend` e `PathPaymentStrictReceive` continuam funcionando; o que o Horizon fazia era **calcular a rota**. Sem ele: calcular a rota a partir do estado das offers, usar um agregador de ecossistema, ou manter um Horizon de terceiro só para esse endpoint. Isso é **Módulo 5** — registrado aqui para não ser pego de surpresa em sala.

**Categorias de indexador:**

- **Portfolio APIs** — dado com forma padrão, pronto para consumo. Na doc oficial: **Alchemy** (Stellar Data API, em produção), **OBSRVR** (nativa de Stellar) e **Allium** (suporte em construção).
- **Transformações customizadas** — quando seu dado não tem forma padrão. Resolve o N+1 e permite agregar fontes off-chain.
- **Analytics** — BI, compliance, rastreio de operações suspeitas, métricas DeFi.
- **Construir o seu** — Galexie (extração para data lake, base do CDP) + Ingest SDK (Go, acesso type-safe a metadados e ledger entries).

---

## Anexo C — Terminologia: o que não se traduz

Termos que ficam em inglês nesta trilha, porque traduzi-los cria um vocabulário que não existe na documentação nem no código:

| Mantém | Não use |
|---|---|
| ledger, ledger entry | livro-razão, entrada de ledger |
| storage (`instance`, `persistent`, `temporary`) | armazenamento, espaço de armazenamento |
| `durability` | durabilidade (quando é o campo do XDR) |
| footprint | pegada |
| resource fee, fee | taxa de recurso |
| state archival | arquivamento de estado |
| loop | laço |
| polling, backoff, jitter, rate limit | sondagem, recuo, tremor |
| data lake, data warehouse | lago/armazém de dados |
| streaming | transmissão |
| cursor, hash, endpoint, deploy | — |
| sequence number | número de sequência |
| balance, trustline, signer | saldo (para `balance` de conta), linha de confiança |
| path payment, path finding | pagamento por caminho |
| executable, wasm hash | executável |
| `oldestLedger`, `latestLedger` | piso, teto |

Traduzem-se normalmente: rede, conta, contrato, chave, evento, transação, simulação, provedor, nó, indexador, camada, janela (de retenção), pagamento.
