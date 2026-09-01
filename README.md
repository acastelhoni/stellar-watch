# Stellar Watch

Monitor de pagamentos de linha de comando — projeto do **Módulo 4** da trilha
Stellar (Pós NearX). Cumulativo em três aulas; nenhuma linha é descartada.

O material de cada aula fica em [`aulas/`](aulas/), em Markdown:

- [`aula-1-v2.md`](aulas/aula-1-v2.md) — **versão em uso.** Conceitual: cada ideia
  é explicada e depois demonstrada com um comando do projeto.
- [`aula-1.md`](aulas/aula-1.md) — versão técnica, com os trechos de código
  comentados. Serve de referência para quem for ler o `src/`.

| Aula | Arquivos | Estado |
|---|---|---|
| 1 — fundação | `config.ts` · `retry.ts` · `probe.ts` · `read.ts` · `pay.ts` · `index.ts` | ✅ pronto |
| 2 — histórico | `poll.ts` · `ledgers.ts` | a construir |
| 3 — eventos | `events.ts` · `reconcile.ts` | a construir |

A pilha é **Stellar RPC + data lake (`getLedgers`) + Hubble + indexadores**.
Sem Horizon: a documentação oficial já o trata como legado, e o Horizon público
da SDF teve o histórico truncado para um ano em 1º de agosto de 2024.

## Requisitos

**Node ≥ 22.18** e **pnpm ≥ 11**. As duas versões estão em `engines`, e o
`pnpm-workspace.yaml` liga `engineStrict` — quem estiver fora vê um erro claro
no `pnpm install`, em vez de um bug obscuro no meio da aula.

O `packageManager` do `package.json` fixa o pnpm em 11.21.0. Com o corepack
ligado, a versão certa é usada automaticamente:

```bash
corepack enable
```

## Começando

```bash
pnpm install
cp .env.example .env      # preencha ALCHEMY_API_KEY
pnpm run probe
```

`.env` mínimo:

```
ALCHEMY_API_KEY=...
STELLAR_NETWORK=testnet
```

**Sem chave da Alchemy?** O RPC público de Testnet resolve a aula inteira:

```
STELLAR_NETWORK=testnet
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

Não existe equivalente para Mainnet — a SDF não roda RPC público de Mainnet.
Para Mainnet é provedor de ecossistema ou nó próprio.

> ⚠️ A chave da Alchemy vai **na URL** do RPC. Nunca versione o `.env`, e nunca
> use essa chave em código de frontend: ela viaja para o navegador do usuário e
> vira chave de qualquer um. Frontend chama o **seu** backend, que chama o provedor.

## Comandos

```bash
pnpm run probe                                   # sonde antes de perguntar
pnpm run read <contractId> <chave> [persistent|temporary]
pnpm run read <contractId> --instance            # storage de instância
pnpm run account <publicKey>                     # o que o RPC sabe: só o sequence
pnpm run pay <destino> <valor> [ativo] [memo]
pnpm run fund <publicKey>                        # friendbot (Testnet/Futurenet)
pnpm run lake <ledger> [pubnet|testnet] [--txs|--xdr]   # ledger do data lake público
pnpm run lake --date 2023-01-01                  # acha o ledger daquela data
pnpm run typecheck
```

`ativo` aceita `native`, `CODE:ISSUER` (pagamento clássico) ou um contract id
`C...` (transferência de token via SAC/SEP-41, com simulação obrigatória).

Exemplo de ponta a ponta em Testnet:

```bash
pnpm run fund GABC...                        # financia a origem
pnpm run pay GDEF... 12.5 native "aula1"     # assina com STELLAR_SECRET_KEY do .env
```

## O que cada arquivo ensina

**`config.ts`** — fábricas *lazy* por rede: `requireEnv` só roda para a rede
selecionada, então ninguém precisa das credenciais de todas as redes para rodar
o projeto. A URL é montada, não copiada. Trocar Testnet por Mainnet é mudar uma
linha do `.env`.

**`retry.ts`** — o protocolo Stellar RPC **não tem streaming**; tudo é polling,
e polling contra provedor com rate limit exige backoff. Exponencial com jitter,
porque sem jitter N clientes que tomaram 429 juntos voltam juntos.

**`probe.ts`** — a primeira coisa a rodar contra qualquer provedor novo. Não
existe "a janela de retenção do RPC": existe a janela **daquela instância**, e
`oldestLedger` é o limite inferior do que se pode perguntar. O `probe` ainda
tenta um `getLedgers` abaixo dele: se voltar `-32600`, aquela instância não tem
data lake configurado, e histórico profundo é assunto da Aula 2.

**`read.ts`** — você monta a **chave**, não uma query. E são **três** tipos de
storage, não dois: `persistent` e `temporary` guardam cada chave como uma ledger
entry própria, enquanto `instance` é um mapa dentro da ledger entry da instância,
endereçado por `scvLedgerKeyContractInstance()` — daí o modo `--instance`. Por
isso `entries.length === 0` tem três causas, e a primeira é a mais comum: chave
errada (storage, `durability` ou tipo), nunca existiu, ou sofreu state archival
(Módulo 6).

```bash
export SAC=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC  # XLM, Testnet
pnpm run read $SAC METADATA      # → (vazio) — METADATA não está no espaço persistente
pnpm run read $SAC --instance    # → { METADATA: { decimal: 7, name: 'native', … } }
```

**`lake.ts`** — o caminho que **não** passa pelo RPC. Baixa o arquivo de um
ledger direto do bucket público da AWS e o decodifica localmente, o que permite
ler 2023 — muito além da janela de qualquer instância de RPC. A chave S3 é
calculada, não pesquisada: o nome do arquivo carrega o número do ledger
invertido (`0xFFFFFFFF - seq`), truque para que a S3 liste os mais recentes
primeiro. `--date` faz busca binária sobre o próprio lake, ~24 requisições para
achar qualquer data.

**`pay.ts`** — dois caminhos, porque são mesmo dois: pagamento clássico não
passa por `simulateTransaction` (o método serve a uma operação Soroban);
transferência de token passa **sempre**, porque é assim que o modelo de fees do
Soroban funciona. `sendTransaction` devolve `PENDING`, nunca o resultado — e o
loop de espera tem timeout, backoff e distingue `NOT_FOUND` de `FAILED`.

## Versões

Baseline do módulo: Mainnet no **Protocolo 27** ("Zipper"), RPC 23.0+. Testnet
costuma estar à frente — rode `pnpm run probe` e leia o `protocolVersion`: é
assim que você descobre, em 200 ms, se o tutorial que está seguindo é
contemporâneo do seu código.

Gerenciador de pacotes: **pnpm 11**. Node 24, TypeScript 7, ESM puro
(`"type": "module"`, imports com extensão `.js`).

O projeto usa **`@stellar/stellar-sdk` 17**, que reescreveu os bindings de XDR.
Três diferenças em relação a material escrito para o SDK 16 ou anterior (o deck
da Aula 1 já está corrigido):

| SDK ≤ 16 | SDK 17 |
|---|---|
| `xdr.ContractDataDurability.persistent()` | `.persistent` — propriedade, não função |
| `entry.val.contractData().val()` | união discriminada: estreite por `entry.val.type === "contractData"`, depois `entry.val.contractData.val` |
| `simulation.cost` | não existe mais; use `minResourceFee` |

E o de sempre: **o schema de conversão JSON/XDR não é retrocompatível entre
protocolos.** Guarde o XDR bruto, ou o dado já normalizado no seu schema.
Nunca o intermediário.

## Se algo quebrar

**`ERR_PNPM_IGNORED_BUILDS: esbuild`** — o pnpm bloqueia scripts de instalação
por padrão, e o `tsx` depende do postinstall do esbuild para baixar o binário
nativo. O `allowBuilds` do `pnpm-workspace.yaml` resolve; se ainda aparecer,
`pnpm approve-builds esbuild`. Atenção ao nome: na pnpm 10 a chave era
`onlyBuiltDependencies` no `package.json`, e essa forma é **silenciosamente
ignorada** na 11.

**Sem `tsx` de jeito nenhum** — compile e rode o JavaScript:

```bash
pnpm run build && node dist/index.js probe
```

Node ≥ 22.18 também executa TypeScript nativamente (`node src/index.ts`), mas
só até o primeiro import: o runtime não resolve os especificadores `.js` do
ESM/NodeNext para os arquivos `.ts` correspondentes. Serve para ver a ajuda,
não para rodar o projeto.

**Veio de um clone com `npm`** — apague `package-lock.json` e
`node_modules/.ignored`, depois rode `pnpm install`.


## Terminologia

`aulas/aula-1.md` termina com um anexo listando os termos que **não** se
traduzem nesta trilha — `ledger entry`, `storage`, `durability`, `footprint`,
`resource fee`, `state archival`, `polling`, `backoff`, `sequence number`,
`trustline`, entre outros. O código, a saída da CLI e o material de aula usam o
mesmo vocabulário de propósito: o aluno procura o termo na documentação oficial
e encontra.
