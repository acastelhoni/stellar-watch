/**
 * Aula 1 · arquivo 1 de 4
 *
 * Configuração por rede + o cliente de RPC do projeto.
 *
 * Três decisões que valem a pena entender aqui:
 *
 *  1. Fábricas lazy. `requireEnv` só roda para a rede selecionada. Se rodasse
 *     no carregamento do módulo, ninguém conseguiria rodar o projeto sem ter
 *     as credenciais de TODAS as redes.
 *  2. A URL é montada, não copiada. Uma constante por rede colada no código
 *     significa a chave repetida em dois lugares; uma função significa um.
 *  3. Um cliente, não dois. `@stellar/stellar-sdk` já traz o namespace `rpc`.
 *     Não existe mais `soroban-client` separado — tutorial que pede isso é velho.
 *
 * Trocar Testnet por Mainnet é mudar UMA linha do .env. Nada no código muda.
 */
import "dotenv/config";
import * as StellarSdk from "@stellar/stellar-sdk";

export type NetworkName = "mainnet" | "testnet" | "futurenet" | "local";

export interface NetworkConfig {
  network: NetworkName;
  rpcUrl: string;
  networkPassphrase: string;
  /** null em Mainnet: lá o XLM não cai do céu. */
  friendbotUrl: string | null;
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  return value;
};

/**
 * A chave da Alchemy vai NA URL. Consequências:
 *   - nunca versione (.env no .gitignore, sempre);
 *   - nunca use em código de frontend — a chave viaja para o navegador
 *     do usuário e vira chave de qualquer um.
 * Frontend que precisa de RPC chama o SEU backend, que chama o provedor.
 */
const alchemy = (net: "mainnet" | "testnet"): string =>
  `https://stellar-${net}.g.alchemy.com/v2/${requireEnv("ALCHEMY_API_KEY")}`;

/**
 * Cada fábrica recebe o override de STELLAR_RPC_URL. Isso importa: sem ele,
 * `alchemy()` rodaria — e exigiria a chave — mesmo para quem apontou o projeto
 * para o RPC público de Testnet ou para um nó próprio.
 */
const configs: Record<NetworkName, (rpcUrl?: string) => NetworkConfig> = {
  mainnet: (rpcUrl) => ({
    network: "mainnet",
    // A SDF não roda RPC público de Mainnet. Provedor de ecossistema ou nó próprio.
    rpcUrl: rpcUrl ?? alchemy("mainnet"),
    networkPassphrase: StellarSdk.Networks.PUBLIC,
    friendbotUrl: null,
  }),
  testnet: (rpcUrl) => ({
    network: "testnet",
    rpcUrl: rpcUrl ?? alchemy("testnet"),
    networkPassphrase: StellarSdk.Networks.TESTNET,
    friendbotUrl: "https://friendbot.stellar.org",
  }),
  // As duas abaixo não estão no deck; existem para quem quiser rodar a aula
  // sem chave da Alchemy (o RPC público de Testnet também serve: basta
  // apontar STELLAR_RPC_URL para https://soroban-testnet.stellar.org).
  futurenet: (rpcUrl) => ({
    network: "futurenet",
    rpcUrl: rpcUrl ?? "https://rpc-futurenet.stellar.org",
    networkPassphrase: StellarSdk.Networks.FUTURENET,
    friendbotUrl: "https://friendbot-futurenet.stellar.org",
  }),
  local: (rpcUrl) => ({
    network: "local",
    rpcUrl: rpcUrl ?? "http://localhost:8000/soroban/rpc",
    networkPassphrase: StellarSdk.Networks.STANDALONE,
    friendbotUrl: "http://localhost:8000/friendbot",
  }),
};

const isNetworkName = (value: string): value is NetworkName =>
  Object.prototype.hasOwnProperty.call(configs, value);

const selected = process.env.STELLAR_NETWORK ?? "testnet";
if (!isNetworkName(selected)) {
  throw new Error(
    `Rede desconhecida: ${selected}. Use uma de: ${Object.keys(configs).join(", ")}`,
  );
}

/**
 * Escotilha de fuga: STELLAR_RPC_URL vence a URL do provedor padrão.
 * Serve para nó próprio, provedor alternativo ou o RPC público de Testnet.
 */
export const config: NetworkConfig = configs[selected](process.env.STELLAR_RPC_URL);

export const rpc = new StellarSdk.rpc.Server(config.rpcUrl, {
  allowHttp: config.rpcUrl.startsWith("http://"),
});

/** Esconde a API key ao imprimir a URL do RPC em log ou terminal. */
export const redactedRpcUrl = (url: string = config.rpcUrl): string =>
  url.replace(/\/v2\/[^/?#]+/, "/v2/***");
