# Módulo 4 · Aula 1 (v2) — De onde vem o dado

**Stellar RPC e a pilha de dados moderna** · 90 minutos · 20 slides + 2 anexos

## Como esta aula funciona

Esta aula é **conceitual e demonstrada**. Não se lê código-fonte em sala: para cada ideia, roda-se um comando do projeto **Stellar Watch** e lê-se a resposta da rede junto com a turma. O código está no repositório para quem quiser abrir depois.

Cada slide segue o mesmo formato: **o que é** → **o comando** → **o que a saída significa**.

**Preparo do instrutor**

```bash
pnpm install
cp .env.example .env       # preencher ALCHEMY_API_KEY
pnpm run probe             # confirmar que responde antes da aula
```

**Variáveis usadas nas demonstrações** — deixar exportadas no terminal antes de começar:

```bash
# o contrato do XLM na Testnet (usado nos slides 14 e 17)
export SAC=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# uma conta de destino descartável, criada e financiada na hora
export DEST=$(node -e "console.log(require('@stellar/stellar-sdk').Keypair.random().publicKey())")
pnpm run fund $DEST
```

A conta que assina os pagamentos é a `STELLAR_SECRET_KEY` do `.env`.

| Bloco | Tema | Slides | Tempo |
|---|---|---|---|
| A | O que é o dado, e onde ele mora | 2–10 | 35 min |
| B | Como o dado chega até você | 11–14 | 25 min |
| C | Como você escreve na rede | 15–19 | 25 min |
| D | Fechamento | 20 | 5 min |

---

## Slide 1 — Capa

**De onde vem o dado**
Stellar RPC e a pilha de dados moderna
Módulo 4 · Aula 1 · 90 minutos

---

## Slide 2 — A pergunta do módulo

Todo aplicativo na Stellar mostra alguma informação: um saldo, um extrato, um "pagamento recebido". Essa informação não sai da blockchain sozinha — alguém precisa buscá-la em algum lugar.

**A pergunta que abre todo projeto real na Stellar é: de onde eu leio esse dado?**

E ela tem mais de uma resposta certa. A resposta errada normalmente funciona no protótipo e falha em produção — não com um erro claro, mas com um dado faltando que ninguém percebe.

Nas próximas três aulas construímos o **Stellar Watch**, um monitor de pagamentos de linha de comando, para responder essa pergunta com as mãos.

| Aula | O que ela responde |
|---|---|
| **1 — hoje** | Onde estou, o que posso perguntar, como escrevo na rede |
| **2** | Como não perder um pagamento, e como ler o passado distante |
| **3** | Como três fontes diferentes discordam sobre a mesma conta |

---

## Slide 3 — O que é um ledger

A Stellar não guarda "transações soltas". A cada **~5 segundos** a rede fecha um **ledger**: uma fotografia numerada do estado completo da rede naquele instante — todas as contas, todos os saldos, todo o estado dos contratos — mais a lista de transações que produziram a mudança.

O ledger de número 4.454.304 é o quatro-milhão-quadringentésimo-quinquagésimo-quarto-milésimo-tricentésimo-quarto retrato tirado desde o início da rede.

**Duas consequências práticas, e é por elas que este módulo existe:**

**1. "Agora" é barato, "antes" é caro.** O estado atual é um valor só. O histórico é a soma de milhões de fotografias, e alguém precisa pagar o disco para guardá-las.

**2. Ninguém guarda tudo.** Cada servidor decide quanto do passado mantém. Essa decisão é invisível na URL, e é a primeira coisa que você precisa descobrir sobre qualquer servidor novo.

---

## Slide 4 — O que é o Stellar RPC

É o servidor que responde perguntas sobre a rede e recebe suas transações. Um endereço HTTP para o qual você manda perguntas e do qual recebe respostas.

**Para o que ele serve:** estado atual de contas e contratos, simular uma transação antes de enviá-la, enviar transações, ler eventos recentes.

**Para o que ele não serve:** histórico profundo. Ele é uma janela para o presente e o passado recente, não um arquivo.

**Um detalhe operacional que pega todo mundo:** a Stellar Development Foundation mantém um RPC público de **Testnet**, mas **não** de **Mainnet**. Seu código funciona durante todo o desenvolvimento e para de funcionar no dia do deploy, se você não tiver escolhido um provedor antes.

Neste curso o provedor é a **Alchemy**: uma chave cobre Testnet e Mainnet.

> Comece na Testnet do provedor que você vai usar em produção. Trocar de fornecedor na véspera do deploy é onde os problemas aparecem.

---

## Slide 5 — Demonstração: a primeira coisa que se roda

```bash
pnpm run probe
```

```
Rede:          testnet
RPC:           https://stellar-testnet.g.alchemy.com/v2/***
Passphrase:    Test SDF Network ; September 2015
Status:        healthy
Protocolo:     28
Latest ledger: 4454304
Oldest ledger: 3244705
Janela:        1209599 ledgers (~70.0 dias)
Histórico:     getLedgers fura a janela (data lake / RPC Archive disponível)
```

Nove linhas. É o cartão de identidade daquele servidor — e é a primeira coisa que se roda contra qualquer provedor novo, antes de escrever uma linha de código que dependa dele.

**Nota do instrutor:** rodar ao vivo. Os números da sua tela serão diferentes dos do slide, e isso é parte da aula.

---

## Slide 6 — Lendo o probe linha por linha

**`Status`** — o servidor está saudável e respondendo.

**`Protocolo: 28`** — a versão das regras que essa rede está rodando. A Stellar entrega uma versão nova a cada poucos meses; Mainnet e Testnet quase nunca estão na mesma. É o número que diz se o tutorial que você está seguindo é do seu tempo.

**`Latest ledger`** — a fotografia mais recente. Sobe uma a cada ~5 segundos.

**`Oldest ledger`** — **a mais antiga que este servidor ainda guarda.** Abaixo dela, ele não sabe responder.

**`Janela`** — a diferença entre as duas: a profundidade real de memória deste servidor.

**`Histórico`** — se este servidor consegue ou não buscar ledgers mais antigos que a janela dele, em um arquivo externo.

> `Oldest ledger` é a linha que define o que você **pode** perguntar. Todo o resto do módulo é consequência dela.

---

## Slide 7 — Demonstração: a janela é do servidor, não do RPC

O mesmo comando, apontado para o RPC público da SDF:

```bash
STELLAR_RPC_URL=https://soroban-testnet.stellar.org pnpm run probe
```

```
Oldest ledger: 4333346
Janela:        120959 ledgers (~7.0 dias)
Histórico:     getLedgers limitado ao oldestLedger (sem data lake)
```

Contra a Alchemy, a mesma Testnet, o mesmo protocolo:

```
Oldest ledger: 3244705
Janela:        1209599 ledgers (~70.0 dias)
Histórico:     getLedgers fura a janela (data lake disponível)
```

**Mesma rede. Mesmo dado. Dez vezes mais memória.**

Não existe "a janela de retenção do Stellar RPC". Existe a janela **daquele servidor** — uma decisão de quem o opera. Por isso o `probe` vem antes de tudo: sondar vem antes de perguntar.

---

## Slide 8 — Por que ninguém guarda tudo

Guardar todos os ledgers desde o início da rede custa disco, e custa mais a cada 5 segundos. Um servidor de RPC é dimensionado para responder rápido sobre o presente — não para ser um arquivo histórico.

Então a rede resolveu isso separando os papéis:

**O RPC responde sobre o presente.** Rápido, sempre atualizado, memória curta.

**Um arquivo externo guarda o passado.** Chama-se **data lake**: os ledgers antigos despejados em armazenamento barato (S3, GCS), lidos sob demanda. Existe um público e gratuito, mantido no programa AWS Open Data, e existe a opção de montar o seu com uma ferramenta chamada **Galexie**.

Quando o RPC tem um data lake conectado, um único método — `getLedgers` — consegue enxergar além da própria janela. Foi o que a linha `Histórico` do `probe` acabou de responder.

> Esse arranjo é o que substituiu o Horizon como fonte de histórico bruto. O `ledgers.ts` da Aula 2 é construído em cima dele.

---

## Slide 9 — As quatro camadas

Não existe "a API da Stellar". Existem quatro lugares diferentes de onde ler, e escolher errado é o erro de arquitetura mais comum da plataforma.

| Camada | O que é | Pergunte a ela |
|---|---|---|
| **Stellar RPC** | O servidor do presente | "Qual o estado agora?" · "Envie esta transação" |
| **Data lake** | Os ledgers antigos em arquivo | "Me devolva o ledger de 2023" · reprocessamento |
| **Hubble** | Um banco analítico público da SDF, no BigQuery | "Extrato completo" · "Volume mensal por ativo" |
| **Indexador** | Um serviço que já mastigou o dado para você | "Portfólio desta conta, pronto para exibir" |

**Sobre o Hubble, um alerta:** ele tem histórico completo e poder de agregação enorme, mas **não há garantia de dados no mesmo dia**. Serve para extrato, BI e compliance. Não serve para confirmar se o pagamento do cliente entrou agora.

> Regra de bolso: **quente e agora** → RPC. **Frio e completo** → data lake ou Hubble. **Pronto para exibir** → indexador.

---

## Slide 10 — E o Horizon?

Quem já mexeu com Stellar antes conhece o **Horizon**, a API REST original. Ele não aparece neste módulo, por dois motivos concretos:

**1. A própria documentação já o trata como legado.** Existe um guia dedicado de migração de Horizon para RPC. Projeto novo começa no RPC.

**2. Ele não é mais o arquivo histórico que as pessoas acham que é.** Em **1º de agosto de 2024**, o Horizon público da SDF teve o histórico **truncado para um ano**.

> Quem hoje usa o Horizon público esperando histórico completo já tem um bug — só ainda não percebeu. A resposta moderna para histórico é data lake e Hubble.

**Nota do instrutor:** único slide sobre Horizon. O Anexo B traz a tabela de equivalência, para quem for manter código legado.

---

## Slide 11 — Como a pergunta viaja: JSON-RPC

Você já conhece REST: um endereço por recurso, um verbo HTTP por ação, o resultado no corpo da resposta.

O Stellar RPC não é assim. Ele usa **JSON-RPC**: **um único endereço**, e a pergunta vai **dentro do corpo**, com o nome do método.

```
POST https://stellar-testnet.g.alchemy.com/v2/<chave>

{ "jsonrpc": "2.0", "id": 1,
  "method": "getLedgerEntries",
  "params": { "keys": ["AAAABgAAAAG..."] } }
```

Erro não vem como código HTTP — vem como um objeto dentro de uma resposta bem-sucedida:

```
{ "jsonrpc": "2.0", "id": 1, "error": { "code": -32600, "message": "..." } }
```

**A consequência que mais importa:** o protocolo **não tem streaming**. Não existe "me avise quando chegar". Você pergunta de novo, e de novo. Alguns provedores oferecem websockets como extra próprio, mas isso é conveniência de fornecedor, não parte da Stellar.

---

## Slide 12 — Como o dado volta: XDR

Repare no `"AAAABgAAAAG..."` do slide anterior. Aquilo é **XDR** — o formato binário em que a Stellar guarda e transmite tudo. Compacto, rígido, e ilegível para humanos.

O SDK traduz XDR para objetos normais de JavaScript. Foi o SDK que transformou os bytes crus na saída legível que o `probe` imprimiu.

**Onde isso vira armadilha:** dá para converter XDR em JSON e é tentador salvar esse JSON no seu banco. **Não faça isso.** O formato dessa conversão muda entre versões de protocolo, e a rede entregou cinco versões em cerca de 18 meses.

> Guarde o XDR cru, ou guarde o dado já normalizado no **seu** formato. Nunca o intermediário — ele é o único dos três que quebra sozinho.

Para inspecionar um XDR à mão, existe o visualizador do **Stellar Lab**.

---

## Slide 13 — O que é o storage de um contrato

Um contrato na Stellar guarda dados como um dicionário: chave → valor. Mas esse dicionário é dividido em **três espaços separados**, e o mesmo nome em espaços diferentes são coisas diferentes:

| Espaço | O que guarda | Vida |
|---|---|---|
| **`instance`** | Configuração do contrato — dono, parâmetros, metadados | Vive com o contrato |
| **`persistent`** | Os dados de valor — saldos, posições, registros | Permanente, com renovação |
| **`temporary`** | Dados descartáveis — travas, caches | Expira e some |

E há uma diferença de forma que causa muita confusão: o `instance` vem **inteiro, de uma vez**, porque é um mapa único. Já `persistent` e `temporary` você lê **uma chave por vez** — você precisa saber exatamente o que está procurando.

**Não existe consulta.** Não há "liste todas as chaves", não há `SELECT WHERE`. Você monta a chave exata ou não recebe nada.

---

## Slide 14 — Demonstração: a mesma pergunta, dois lugares

Vamos ler os metadados do contrato do XLM na Testnet. Sabemos que existe uma chave chamada `METADATA`. Primeira tentativa, no espaço `persistent`:

```bash
pnpm run read $SAC METADATA
```

```
(vazio — chave errada, nunca existiu, ou state archival. Tente --instance)
```

Vazio. Agora no espaço `instance`:

```bash
pnpm run read $SAC --instance
```

```
executable: stellar_asset
instance storage:
{ METADATA: { decimal: 7, name: 'native', symbol: 'native' },
  AssetInfo: [ 'Native' ] }
```

**O dado estava lá o tempo todo.** A primeira pergunta não estava errada por acaso: estava endereçada ao espaço errado.

**Vazio tem três causas, e a primeira é de longe a mais comum:** chave errada · nunca existiu · foi arquivada por falta de renovação (isso é assunto do Módulo 6).

**Nota do instrutor:** este é o erro que a turma inteira vai cometer no primeiro contrato. Rodar os dois comandos na tela vale mais que dez minutos de explicação.

---

## Slide 15 — Demonstração: o que o RPC sabe de uma conta

```bash
pnpm run account GDJIP3IY...4TTS
```

```
{ id: 'GDJIP3IYJC2ASZOLYVDEH67AKD46UP2GJ5MJXV6VXQOOQDXC2P6J4TTS',
  sequence: '19126979722739722' }
```

É só isso. **Sem saldo, sem trustlines, sem signers, sem histórico.**

O `sequence` é um contador que a conta incrementa a cada transação — ele existe para impedir que a mesma transação assinada seja reenviada duas vezes. É o mínimo necessário para **montar** uma transação nova, e é exatamente por isso que o RPC o entrega.

**Isso é escopo, não falha.** Perguntar "quanto essa conta tem?" ou "o que ela fez em março?" é pergunta de **outra camada** — Hubble ou indexador.

> Se você precisou de mais que o `sequence`, você precisou sair do RPC. Reconhecer esse momento é uma decisão de arquitetura, e é o que o `reconcile.ts` da Aula 3 vai tornar visível.

---

## Slide 16 — O que é simular uma transação

Na Stellar existem dois tipos de operação, e eles se comportam de formas diferentes na hora de pagar a taxa.

**Pagamento clássico** — mandar XLM ou um ativo emitido de uma conta para outra. Custo fixo e conhecido: uma fração de centavo. Assina e envia.

**Chamada de contrato** — executar código. O custo depende de quanto o código roda e de quanta memória ele toca, e **isso ninguém sabe antes de rodar**.

A solução da Stellar é a **simulação**: você manda a transação para o RPC com a pergunta "se eu executasse isto, o que aconteceria?". O servidor executa sem gravar nada e devolve o resultado previsto, quanto vai custar e exatamente quais dados serão tocados.

**Simular não é opcional em chamada de contrato** — sem os números da simulação embutidos, a transação é rejeitada. Não é boa prática; é o mecanismo.

---

## Slide 17 — Demonstração: os dois caminhos

**Pagamento clássico** — nada de simulação, direto ao ponto:

```bash
pnpm run pay $DEST 12.5 native "aula1"
```

```
Enviando 12.5 native → GCIRRM7D...7Y67
Hash: f9ae21d107d4c31ec2c86da4ae62684917e82d5224bb0e399ba9bf2c25fc3caf
✅ Sucesso no ledger 4454311
```

**Mesmo valor, mesmo destino, via contrato** — o mesmo XLM, transferido pelo contrato que o representa no mundo dos smart contracts:

```bash
pnpm run pay $DEST 1.0 $SAC
```

```
Resource fee: 23468 stroops
Resultado previsto: null
Enviando 1.0 de CDLZFC3S...CYSC → GCIRRM7D...7Y67
Hash: 3a3658eb031e7294a4abebdf844a20001580502110cc4eada97e0040bbc3f9e2
✅ Sucesso no ledger 4454312
```

Duas linhas a mais, e elas vêm da simulação: **o custo calculado** e **o resultado previsto**. O mesmo dinheiro, dois caminhos, dois modelos de taxa.

---

## Slide 18 — Demonstração: `PENDING` não é sucesso

Vamos pedir um valor que a conta não tem:

```bash
pnpm run pay $DEST 999999 native
```

```
Enviando 999999 native → GCIRRM7D...7Y67
Hash: 3d98d2705212b032586970d247f721bd5107fa6b1f6ae4fd544fd6611cff7b0e
❌ Transação falhou no ledger 4454313
```

**Repare na ordem:** a rede **aceitou** a transação e devolveu um hash. Só depois, ao aplicá-la em um ledger, ela falhou.

Quando você envia, o RPC responde `PENDING` — "recebi, está na fila". Isso **não** é confirmação. O resultado só existe quando um ledger fecha, alguns segundos depois, e para saber qual foi você precisa perguntar de novo, usando o hash.

**Três coisas que todo código de envio precisa ter, e que o exemplo da documentação oficial não tem:**

- **Um limite de tempo.** Perguntar para sempre é um travamento em produção.
- **Espera crescente entre perguntas.** Perguntar a cada segundo faz o provedor te bloquear.
- **Distinguir "ainda não sei" de "falhou".** São saídas diferentes: uma pede paciência, a outra não adianta esperar.

---

## Slide 19 — Por que tudo isso vira polling

Junte duas coisas que já apareceram:

**O protocolo não tem streaming.** A rede nunca te avisa; você pergunta.

**Perguntar tem custo.** Todo provedor tem limite de requisições, e ultrapassá-lo devolve erro em vez de dado.

A soma das duas é a regra que sustenta o projeto inteiro: **pergunte em intervalos, e aumente o intervalo quando levar um "não".** No Stellar Watch isso é o `retry.ts`, o arquivo mais curto do projeto e o mais usado por todos os outros.

**E há um terceiro problema, que a Aula 2 resolve:** se você pergunta em intervalos e o seu programa cai entre duas perguntas, o que aconteceu no meio-tempo você nunca viu. Se ao voltar você retomar do "agora", esse pedaço some — sem erro, sem log, sem ninguém perceber.

> É assim que pagamentos desaparecem em integrações reais. Na Aula 2 vamos derrubar a conexão de propósito e ver acontecer.

---

## Slide 20 — O que você leva daqui

**Não existe "a API da Stellar".** Existem quatro camadas, e a primeira decisão de qualquer projeto é qual delas responde a sua pergunta.

**Sonde antes de perguntar.** `pnpm run probe` em qualquer provedor novo. O `Oldest ledger` define o que você pode perguntar; a linha `Histórico` define se você pode ir além.

**O RPC é o presente.** Estado atual, simulação, envio. Histórico é outra camada.

**Nada é confirmado até fechar em um ledger.** `PENDING` é um recibo de entrega, não uma confirmação.

**O que já está construído:**

```
probe  → onde estou e o que posso perguntar
read   → estado de um contrato, nos três espaços
pay    → construir, simular, enviar e aguardar de verdade
```

**Aula 2 — memória.** Não perder nada entre duas perguntas, e ler o passado distante além da janela.
**Aula 3 — reconciliação.** A mesma conta em três fontes, e onde cada uma para de responder.

> O Stellar Watch já sabe **onde está** e **o que pode perguntar**. Na Aula 2 ele ganha memória. 🚀

---

## Anexo A — Glossário

*Uma linha por termo. Para o aluno consultar depois.*

**Ledger** — a fotografia numerada do estado completo da rede, fechada a cada ~5 segundos.

**Stellar RPC** — o servidor que responde sobre o estado atual e recebe transações. Memória curta.

**JSON-RPC** — o estilo de API do Stellar RPC: um endereço só, o método vai no corpo da requisição.

**XDR** — o formato binário em que a Stellar guarda e transmite tudo. O SDK traduz.

**Retenção / janela** — quanto do passado um servidor específico ainda guarda. Decisão de quem o opera.

**`oldestLedger`** — o ledger mais antigo que aquele servidor conhece. Abaixo dele, ele não responde.

**Data lake** — os ledgers antigos despejados em armazenamento barato, lidos sob demanda. Existe um público e gratuito.

**Hubble** — o banco analítico público da SDF no BigQuery. Histórico completo, mas não em tempo real.

**Indexador** — serviço que lê a blockchain e entrega o dado já pronto para exibir.

**Horizon** — a API REST original da Stellar. Legado; histórico público truncado para um ano desde agosto de 2024.

**Storage de contrato** — o dicionário de um contrato, dividido em `instance`, `persistent` e `temporary`.

**Simulação** — executar uma transação sem gravar, para descobrir custo e resultado. Obrigatória em chamada de contrato.

**Resource fee** — a parte da taxa que corresponde ao trabalho computacional, calculada pela simulação.

**`PENDING`** — "recebi sua transação". Não é confirmação.

**Hash de transação** — o identificador com que você pergunta depois se ela deu certo.

**Polling** — perguntar em intervalos, porque o protocolo não avisa.

**Backoff** — aumentar o intervalo entre perguntas depois de um erro, para não ser bloqueado.

**Sequence number** — o contador da conta que impede reenvio da mesma transação.

**SAC (Stellar Asset Contract)** — o contrato que representa um ativo clássico dentro do mundo dos smart contracts.

**Testnet / Mainnet** — a rede de testes, com dinheiro falso e reset periódico, e a rede real.

---

## Anexo B — Equivalência sem Horizon

*Referência para quem for manter código legado.*

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

**A única dependência residual** é o *path finding* (`/paths`): as operações de path payment continuam funcionando, mas quem calculava a rota era o Horizon. Alternativas: calcular a rota a partir das offers, usar um agregador de ecossistema, ou manter um Horizon de terceiro só para esse endpoint. Assunto do Módulo 5.
