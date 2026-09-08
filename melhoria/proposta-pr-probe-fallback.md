# Proposta de Pull Request: Diagnóstico Híbrido & Fallback do Data Lake no `probe.ts`

Esta proposta de melhoria conecta diretamente os conceitos da **Aula 1 (Arquitetura de Dados Quentes vs. Frios)** com a engenharia prática do **Stellar Watch**. Ela transforma o comando `probe` em um assistente de diagnóstico inteligente, auxiliando o desenvolvedor a entender onde seus dados estão e como recuperá-los de forma resiliente.

---

## 🛠️ O Código Alterado (`src/probe.ts`)

Aqui está a implementação completa e atualizada do arquivo `probe.ts` em TypeScript, utilizando o **`fetch` nativo do Node 22** e gerenciamento resiliente de timeouts via **`AbortController`**.

```typescript
import { rpc, getNetworkConfig } from './config'; // Assumindo a importação de configurações do projeto

/**
 * Valida de forma independente se o S3 Data Lake público da SDF está operacional.
 * Atua como um diagnóstico alternativo quando o RPC não possui data lake integrado.
 */
async function checkS3DataLakeConnection(network: string): Promise<boolean> {
  // URLs oficiais do histórico do Data Lake da SDF para Testnet e Mainnet/Pubnet
  const s3Url = network === 'mainnet' || network === 'pubnet'
    ? 'https://history.stellar.org/prd/core-live/core_live_001/.well-known/stellar-history.json'
    : 'https://history-testnet.stellar.org/prd/core-testnet/core_testnet_001/.well-known/stellar-history.json';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 segundos de timeout

    // HEAD request para testar apenas conectividade de cabeçalho, economizando banda
    const response = await fetch(s3Url, {
      method: 'HEAD',
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    return response.ok;
  } catch (error) {
    // Falha de rede ou timeout
    return false;
  }
}

/**
 * Função principal do comando de sondagem (probe)
 */
export async function runProbe() {
  const network = process.env.STELLAR_NETWORK || 'testnet';
  console.log(`🔍 Iniciando sondagem na rede: ${network.toUpperCase()}...\n`);

  try {
    // 1. Consulta inicial ao RPC para ler os limites da janela de retenção
    const latestLedgerResponse = await rpc.getLatestLedger();
    const latestLedger = latestLedgerResponse.sequence;
    
    // O RPC expõe qual o ledger mais antigo que ele mantém em memória quente
    const oldestLedger = latestLedgerResponse.oldestLedger || (latestLedger - 100); 

    console.log("--- 📊 DADOS DO SERVIDOR RPC ---");
    console.log(`Ledger Atual:  ${latestLedger}`);
    console.log(`Oldest Ledger: ${oldestLedger}`);
    console.log(`Janela Quente: Retenção de ${latestLedger - oldestLedger} ledgers em memória.\n`);

    // 2. Testando suporte nativo do RPC para consultas históricas profundas
    let hasNativeDataLake = false;
    try {
      // Forçamos uma consulta por um ledger abaixo do limite físico do RPC (oldestLedger - 1)
      const targetLedger = oldestLedger - 1;
      if (targetLedger > 0) {
        await rpc.getLedger(targetLedger);
        hasNativeDataLake = true;
      }
    } catch (rpcError: any) {
      // Erro clássico JSON-RPC -32600 indica limite de retenção excedido sem data lake acoplado
      if (rpcError?.code === -32600) {
        hasNativeDataLake = false;
      } else {
        // Outros erros de rede ou timeout
        throw rpcError;
      }
    }

    // 3. Execução do Diagnóstico Híbrido de Rede
    console.log("--- 🌐 DIAGNÓSTICO DE HISTÓRICO HÍBRIDO ---");
    if (hasNativeDataLake) {
      console.log("Suporte RPC:   ✅ Ativo! Este nó RPC consegue ler o histórico profundo nativamente.");
      console.log("Arquitetura:   Híbrida de alta capacidade.");
    } else {
      console.log("Suporte RPC:   ⚠️  Inativo. Este nó de RPC tem memória curta (oldestLedger).");
      
      // Iniciando teste independente do S3
      console.log("S3 Data Lake:  Avaliando conectividade direta com a AWS SDF...");
      const s3Online = await checkS3DataLakeConnection(network);

      if (s3Online) {
        console.log("S3 Data Lake:  ✅ ONLINE! O armazenamento de dados frios da SDF está acessível.");
        console.log("\n💡 Diagnóstico & Aprendizado:");
        console.log("   Como este nó de RPC não possui Data Lake integrado, requisições de ledgers passados");
        console.log(`   (abaixo de ${oldestLedger}) falharão se feitas via chamadas RPC tradicionais.`);
        console.log("   No entanto, o Data Lake da SDF está operacional!");
        console.log("   Você pode ignorar a limitação de gravidade do RPC rodando o comando local do S3:");
        console.log("   👉 pnpm run lake <ledger>\n");
      } else {
        console.log("S3 Data Lake:  ❌ OFFLINE ou Inacessível (Sem rede/DNS ou bloqueio de firewall).");
        console.log(`Histórico:     🚨 Estritamente limitado à janela quente do RPC (${oldestLedger} a ${latestLedger}).\n`);
      }
    }

  } catch (error: any) {
    console.error("❌ Falha crítica ao executar a sondagem do probe:", error?.message || error);
  }
}
