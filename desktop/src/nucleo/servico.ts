/**
 * O serviço do Margem dentro do app: Postgres embutido, API e worker, nessa ordem, e o desligamento
 * na ordem inversa. Não importa nada do Electron (os testes e o `fumaca` rodam isto direto).
 */
import { existsSync } from 'node:fs';
import { chmod, mkdir, readdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import pg from 'pg';
import {
  pastasDaBiblioteca, segredosDaBiblioteca, senhaDaBiblioteca, type ConfiguracaoDoApp, type PastasDaBiblioteca, type PastasDoApp,
} from './configuracao.js';
import {
  avisoDaPastaSincronizada, copiarAntesDeMigrar, copiarCluster, MARCA_DE_RESTAURACAO, migracoesEmpacotadas, migrarBancoParaLocal,
  pendentesQuePedemCopia, type DadosDoManifesto, type ManifestoDaCopia,
} from './banco-local.js';
import { chaveDaInstalacao } from './chave-local.js';
import { fazerCopiaDeSeguranca, gravarUltimaCopia, type ResultadoDaCopiaDeSeguranca } from './copia-de-seguranca.js';
import { adotarDoLegado, identificarBiblioteca, IdentidadeCancelada, type RespostaDaCopia } from './identidade.js';
import { renomearComRetentativa } from './disco.js';
import { decidirConfinamento, type TestarBwrap } from './confinamento.js';
import { avisoDaPorta, escolherPorta, FAIXA_DA_EXTENSAO, motivoDaPortaOcupada, PORTA_DA_EXTENSAO } from './porta.js';
import {
  BANCO, ErroDoBanco, conferirEspaco, inicializarCluster, mensagemDeVersaoDiferente, parar as pararPostgres, redefinirSenha,
  restaurarHbaSeFicou, sanear, subir as subirPostgres, tratarLockVelho, urlDoBanco, versaoDoCluster, versaoDosBinarios,
} from './postgres.js';
import type { BinariosDoPostgres, RecursosResolvidos } from './recursos.js';
import { girarSeGrande, Registro } from './registros.js';
import { Supervisor } from './supervisor.js';

/** Extensão do navegador publicada (Chrome/Edge/Brave), a mesma do compose da instalação Docker. */
export const EXTENSAO_PADRAO = 'chrome-extension://gbgnmhhgfmdgchhfhabdaneaehcamcma';

export interface EntradaDoAmbiente {
  base: NodeJS.ProcessEnv;
  recursos: RecursosResolvidos;
  pastasDoApp: PastasDoApp;
  biblioteca: PastasDaBiblioteca;
  portaDaApi: number;
  urlDoBanco: string;
  /** Raiz que o serviço enxerga (`MARGEM_RAIZ`). */
  raiz: string;
  /** Variáveis decididas na hora (ex.: `MARGEM_CONFINAMENTO=nativo` sem bwrap). */
  extras?: Record<string, string>;
  /** Avisos para o estado da instalação (`MARGEM_AVISOS`). */
  avisos?: readonly string[];
  /** `pg_ctl` e pasta do cluster: o worker para o banco se o app sumir (L-06). */
  banco?: { pgCtl: string; pasta: string };
  sistema?: NodeJS.Platform;
}

/**
 * Ambiente da API e do worker (contrato com o J114): o do app, mais as variáveis do Margem. O que a
 * pessoa já definiu para modelo, slots e extensões vale; o resto é do app.
 */
export function ambienteDosFilhos(entrada: EntradaDoAmbiente): NodeJS.ProcessEnv {
  const { base, recursos } = entrada;
  const separador = (entrada.sistema ?? process.platform) === 'win32' ? ';' : delimiter;
  const ambiente: NodeJS.ProcessEnv = { ...base };
  // Variáveis do Postgres do usuário não podem redirecionar o `pg` do serviço.
  for (const nome of Object.keys(ambiente)) if (/^PG/u.test(nome)) delete ambiente[nome];
  const caminhoAtual = base.PATH ?? base.Path ?? '';
  delete ambiente.Path;
  ambiente.PATH = recursos.pastaBin === null ? caminhoAtual : [recursos.pastaBin, caminhoAtual].filter((p) => p !== '').join(separador);
  Object.assign(ambiente, {
    NODE_ENV: 'production',
    MARGEM_MODO: 'instalado',
    MARGEM_APP_DESKTOP: '1',
    // Só loopback: no modo instalado o padrão seria 0.0.0.0 (era a interface do container).
    MARGEM_ENDERECO: '127.0.0.1',
    MARGEM_PORTA: String(entrada.portaDaApi),
    DATABASE_URL: entrada.urlDoBanco,
    MARGEM_DADOS: entrada.biblioteca.biblioteca,
    MARGEM_RAIZ: entrada.raiz,
    CODEX_HOME: entrada.pastasDoApp.codexHome,
    // S-02: segredos do serviço (a chave da ElevenLabs) no app, nunca na biblioteca, que pode estar num Dropbox;
    // um por biblioteca (R-04).
    MARGEM_SEGREDOS: segredosDaBiblioteca(entrada.pastasDoApp.segredos, entrada.biblioteca.id),
    MARGEM_MODELO: base.MARGEM_MODELO ?? 'conta',
    MARGEM_SLOTS: base.MARGEM_SLOTS ?? '2',
    MARGEM_EXTENSOES: base.MARGEM_EXTENSOES ?? EXTENSAO_PADRAO,
  });
  const caminhos: [string, { caminho: string } | null][] = [
    ['MARGEM_CODEX_MOTOR', recursos.codex],
    ['MARGEM_MOTOR', recursos.motor],
    ['MARGEM_YT_DLP', recursos.ytDlp],
    ['MARGEM_FFMPEG', recursos.ffmpeg],
    ['MARGEM_FFPROBE', recursos.ffprobe],
    ['MARGEM_FONTE', recursos.fonte],
  ];
  for (const [nome, valor] of caminhos) {
    if (valor === null) delete ambiente[nome];
    else ambiente[nome] = valor.caminho;
  }
  Object.assign(ambiente, entrada.extras ?? {});
  if (entrada.banco === undefined) { delete ambiente.MARGEM_PG_CTL; delete ambiente.MARGEM_PG_DADOS; }
  else Object.assign(ambiente, { MARGEM_PG_CTL: entrada.banco.pgCtl, MARGEM_PG_DADOS: entrada.banco.pasta });
  if (entrada.avisos !== undefined && entrada.avisos.length > 0) ambiente.MARGEM_AVISOS = entrada.avisos.join('\n');
  else delete ambiente.MARGEM_AVISOS;
  // MARGEM_RECURSOS fica como a pessoa deixou (o padrão do serviço vale sem ela). MARGEM_ARTE_DIR também
  // não é definido: as obras que a pessoa importa vão para o padrão do serviço, <MARGEM_DADOS>/quadros (J118).
  delete ambiente.MARGEM_ARTE_DIR;
  return ambiente;
}

/** Segredos que o serviço gravava em `<biblioteca>/segredos` antes do S-02. */
const SEGREDOS_DA_BIBLIOTECA = ['elevenlabs.chave'] as const;

export type DesfechoDosSegredos = { arquivo: string; desfecho: 'migrado' | 'ja_havia' | 'conflito' | 'falhou' };

/**
 * S-02: leva os segredos antigos da biblioteca para a pasta do app desta biblioteca (`segredos`, de
 * `segredosDaBiblioteca`) — copia (0600), confere byte a byte e só então apaga o da biblioteca; a pasta
 * `segredos` vazia sai junto. Se o app já tem um igual, a cópia da biblioteca sai. Diferente (R-04: trocado
 * aqui depois, ou outro computador ainda numa versão antiga gravou outro), nada é apagado: o do app vale
 * e o da biblioteca fica onde está, como `conflito` no registro. Falha na cópia não impede a abertura e
 * deixa o original onde estava (a próxima abertura tenta de novo).
 */
export async function migrarSegredosDaBiblioteca(biblioteca: string, segredos: string): Promise<DesfechoDosSegredos[]> {
  const pastaAntiga = join(biblioteca, 'segredos');
  const desfechos: DesfechoDosSegredos[] = [];
  for (const nome of SEGREDOS_DA_BIBLIOTECA) {
    const antigo = join(pastaAntiga, nome);
    if (!existsSync(antigo)) continue;
    const destino = join(segredos, nome);
    try {
      const conteudo = await readFile(antigo);
      let desfecho: DesfechoDosSegredos['desfecho'] = 'ja_havia';
      if (existsSync(destino) && !(await readFile(destino)).equals(conteudo)) {
        desfechos.push({ arquivo: nome, desfecho: 'conflito' });
        continue;
      }
      if (!existsSync(destino)) {
        await mkdir(segredos, { recursive: true, mode: 0o700 });
        const temporario = `${destino}.${String(process.pid)}.tmp`;
        await writeFile(temporario, conteudo, { mode: 0o600 });
        await renomearComRetentativa(temporario, destino);
        if (!(await readFile(destino)).equals(conteudo)) throw new Error('a cópia não confere');
        desfecho = 'migrado';
      }
      await rm(antigo, { force: true });
      desfechos.push({ arquivo: nome, desfecho });
    } catch {
      desfechos.push({ arquivo: nome, desfecho: 'falhou' });
    }
  }
  try { if ((await readdir(pastaAntiga)).length === 0) await rmdir(pastaAntiga); } catch { /* não existe */ }
  return desfechos;
}

/** Um botão para a caixa de erro da abertura (o link da versão nova, a página de restauração). */
export interface AcaoDoErro { rotulo: string; url: string }

export class ErroDoServico extends Error {
  constructor(readonly codigo: string, mensagem: string, readonly detalhe?: string, readonly acao?: AcaoDoErro) {
    super(mensagem);
    this.name = 'ErroDoServico';
  }
}

export const LINK_DO_DOWNLOAD = 'https://margem.dev/download/';
export const LINK_DA_RESTAURACAO = 'https://margem.dev/docs/backup/#restaurar';

export interface OpcoesDoServico {
  recursos: RecursosResolvidos;
  raizApp: string;
  pastasDoApp: PastasDoApp;
  biblioteca: string;
  configuracao: ConfiguracaoDoApp;
  registro: Registro;
  /** Ambiente de origem (padrão: o do app). */
  ambiente?: NodeJS.ProcessEnv;
  /** Executável que roda os bundles (padrão: `process.execPath`). */
  executavel?: string;
  /** Etapas para a janela de boas-vindas (texto curto). */
  aoProgresso?: (etapa: string) => void;
  /** API ou worker desistiram de reiniciar. */
  aoCair?: (processo: 'api' | 'worker') => void;
  prazoDaApiMs?: number;
  /** Teto da espera enquanto a API migra o banco (D-02). */
  prazoDaMigracaoMs?: number;
  /** Troca a sonda do bwrap (testes). */
  testarBwrap?: TestarBwrap;
  /** Eco das linhas da API e do worker (o `--sem-janela` manda para a saída padrão). */
  eco?: (linha: string) => void;
  /** Troca as operações do banco (testes: atrasos controlados, falhas). */
  operacoes?: Partial<OperacoesDoBanco>;
  /**
   * W-02: a mesma biblioteca (mesmo id) está em dois caminhos ao mesmo tempo; a pessoa diz se moveu ou
   * copiou. Sem isto (sem janela), é cópia: a pasta ganha id e banco próprios.
   */
  perguntarSeCopiou?: (pergunta: { biblioteca: string; outra: string }) => Promise<RespostaDaCopia>;
}

/** Onde mora cada coisa desta biblioteca (Configurações → Cópia de segurança, Sobre). */
export interface LocaisDaBiblioteca {
  biblioteca: string;
  banco: string;
  /** O banco fica fora da pasta da biblioteca (pasta sincronizada, ou ela saiu de uma). */
  bancoSeparado: boolean;
  sincronizada: string | null;
  /** A cópia automática de antes da última atualização do banco (D-06), se houver. */
  copiaAntesDeMigrar: string | null;
}

/** O que o serviço faz com o Postgres; os testes trocam por dublês com atrasos e falhas controlados. */
export interface OperacoesDoBanco {
  versaoDosBinarios: (binarios: BinariosDoPostgres) => Promise<number>;
  inicializarCluster: (binarios: BinariosDoPostgres, pasta: string, senha: string, temporaria: string) => Promise<void>;
  tratarLockVelho: (binarios: BinariosDoPostgres, pasta: string) => Promise<string>;
  redefinirSenha: (binarios: BinariosDoPostgres, pasta: string, senha: string, opcoes: { porta: number; arquivoDeLog: string }) => Promise<void>;
  subir: (binarios: BinariosDoPostgres, pasta: string, porta: number, arquivoDeLog: string) => Promise<void>;
  parar: (binarios: BinariosDoPostgres, pasta: string) => Promise<boolean>;
  conferirSenha: (senha: string, porta: number) => Promise<boolean>;
  garantirBanco: (senha: string, porta: number) => Promise<void>;
  /** Nomes na tabela `migracao` do banco da biblioteca; `null` sem a tabela (banco novo). */
  migracoesAplicadas: (senha: string, porta: number) => Promise<string[] | null>;
  copiarAntesDeMigrar: (origem: string, destino: string, dados: DadosDoManifesto) => Promise<{ pasta: string; manifesto: ManifestoDaCopia }>;
  /** O banco local da original para a cópia de uma biblioteca (W-02). */
  copiarCluster: (origem: string, destino: string) => Promise<void>;
}

async function migracoesAplicadasPeloPg(senha: string, porta: number): Promise<string[] | null> {
  const cliente = new pg.Client({ connectionString: urlDoBanco(senha, porta), connectionTimeoutMillis: 10_000 });
  await cliente.connect();
  try {
    const tabela = (await cliente.query<{ t: string | null }>("SELECT to_regclass('migracao')::text AS t")).rows[0]?.t;
    if (!tabela) return null;
    return (await cliente.query<{ nome: string }>('SELECT nome FROM migracao ORDER BY nome')).rows.map((linha) => linha.nome);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

/** Versão do app gravada na raiz pelo build (`versao.json`); `null` fora do pacote. */
async function versaoDoApp(raizApp: string): Promise<string | null> {
  try {
    const dados = JSON.parse(await readFile(join(raizApp, 'versao.json'), 'utf8')) as { versao?: unknown };
    return typeof dados.versao === 'string' ? dados.versao : null;
  } catch {
    return null;
  }
}

async function conferirSenhaPeloPg(senha: string, porta: number): Promise<boolean> {
  const cliente = new pg.Client({ connectionString: urlDoBanco(senha, porta, 'postgres'), connectionTimeoutMillis: 10_000 });
  try {
    await cliente.connect();
    return true;
  } catch (erro) {
    if ((erro as { code?: string }).code === '28P01') return false;
    throw new ErroDoBanco('subida', 'O banco subiu mas não aceita conexão.', (erro as Error).message);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

async function garantirBancoPeloPg(senha: string, porta: number): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlDoBanco(senha, porta, 'postgres'), connectionTimeoutMillis: 10_000 });
  await cliente.connect();
  try {
    const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [BANCO]);
    if (existe.rowCount === 0) await cliente.query(`CREATE DATABASE ${BANCO}`);
  } finally {
    await cliente.end().catch(() => undefined);
  }
}

const OPERACOES_PADRAO: OperacoesDoBanco = {
  versaoDosBinarios: (binarios) => versaoDosBinarios(binarios),
  inicializarCluster: (binarios, pasta, senha, temporaria) => inicializarCluster(binarios, pasta, senha, temporaria),
  tratarLockVelho: (binarios, pasta) => tratarLockVelho(binarios, pasta),
  redefinirSenha: (binarios, pasta, senha, opcoes) => redefinirSenha(binarios, pasta, senha, opcoes),
  subir: (binarios, pasta, porta, arquivoDeLog) => subirPostgres(binarios, pasta, porta, arquivoDeLog),
  parar: (binarios, pasta) => pararPostgres(binarios, pasta),
  conferirSenha: conferirSenhaPeloPg,
  garantirBanco: garantirBancoPeloPg,
  migracoesAplicadas: migracoesAplicadasPeloPg,
  copiarAntesDeMigrar: (origem, destino, dados) => copiarAntesDeMigrar(origem, destino, dados),
  copiarCluster: (origem, destino) => copiarCluster(origem, destino),
};

/** A abertura foi interrompida porque pediram para parar (fechar o app durante a abertura; L-02). */
export const ABERTURA_INTERROMPIDA = 'abertura_interrompida';

export interface ServicoNoAr { portaDaApi: number; portaDoBanco: number; url: string; banco: 'criado' | 'reaproveitado' }

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

export class ServicoDoMargem {
  private api: Supervisor | null = null;
  /** A API (ou o worker) disse que o banco é de uma versão mais nova do Margem (D-07): não adianta reiniciar. */
  private bancoMaisNovo: string[] | null = null;
  private worker: Supervisor | null = null;
  private binarios: BinariosDoPostgres | null = null;
  private pastas: PastasDaBiblioteca;
  /** O app pode ter posto o Postgres no ar (subida feita ou em curso): a parada tem de tentar pará-lo. */
  private bancoTocado = false;
  private pararPedido = false;
  private iniciando: Promise<ServicoNoAr> | null = null;
  private parando: Promise<void> | null = null;
  private readonly ops: OperacoesDoBanco;

  constructor(private readonly opcoes: OpcoesDoServico) {
    this.pastas = pastasDaBiblioteca(opcoes.biblioteca, { bancosLocais: opcoes.pastasDoApp.bancosLocais, ambiente: opcoes.ambiente ?? process.env });
    this.ops = { ...OPERACOES_PADRAO, ...opcoes.operacoes };
  }

  get biblioteca(): PastasDaBiblioteca { return this.pastas; }

  /** A cópia automática do D-06 desta biblioteca. */
  private get pastaDaCopiaAntesDeMigrar(): string {
    return join(this.opcoes.pastasDoApp.copias, this.pastas.id);
  }

  get locais(): LocaisDaBiblioteca {
    const copia = this.pastaDaCopiaAntesDeMigrar;
    return {
      biblioteca: this.pastas.biblioteca, banco: this.pastas.banco, bancoSeparado: this.pastas.banco !== this.pastas.bancoNaBiblioteca,
      sincronizada: this.pastas.sincronizada, copiaAntesDeMigrar: existsSync(join(copia, 'manifesto.json')) ? join(copia, 'banco') : null,
    };
  }
  get pids(): { api?: number; worker?: number } {
    return { ...(this.api?.pid === undefined ? {} : { api: this.api.pid }), ...(this.worker?.pid === undefined ? {} : { worker: this.worker.pid }) };
  }

  private evento(evento: string, detalhe: Record<string, unknown> = {}): void {
    this.opcoes.registro.evento(evento, detalhe);
  }

  private progresso(etapa: string): void {
    this.opcoes.aoProgresso?.(etapa);
  }

  /** Pediram para parar no meio da abertura: nenhuma etapa nova começa (L-02). */
  private seguir(): void {
    if (this.pararPedido) throw new ErroDoServico(ABERTURA_INTERROMPIDA, 'A abertura da biblioteca foi interrompida.');
  }

  /** Sobe banco, API e worker. Uma parada pedida no meio interrompe a abertura na etapa seguinte. */
  iniciar(): Promise<ServicoNoAr> {
    this.iniciando ??= this.abrir().catch((erro: unknown) => {
      // W-06: o registro guarda o diagnóstico (código do sistema, executável, saída saneada), não só a frase.
      const falha = erro as { codigo?: string; detalhe?: string; falha?: unknown };
      if (falha.codigo !== ABERTURA_INTERROMPIDA) {
        this.evento('servico_falhou_diagnostico', {
          codigo: falha.codigo ?? null, ...(falha.falha === undefined ? {} : { falha: falha.falha }),
          ...(falha.detalhe === undefined ? {} : { detalhe: sanear(falha.detalhe, 1200) }),
        });
      }
      throw erro;
    });
    return this.iniciando;
  }

  private async abrir(): Promise<ServicoNoAr> {
    const { recursos, pastasDoApp, configuracao } = this.opcoes;
    const inicial = this.pastas;
    this.progresso('Preparando a pasta da biblioteca');
    try {
      await mkdir(inicial.biblioteca, { recursive: true });
      await mkdir(inicial.interna, { recursive: true });
    } catch (erro) {
      throw new ErroDoServico('pasta', `Não foi possível usar a pasta ${inicial.biblioteca}: ${(erro as Error).message}`);
    }
    await conferirEspaco(inicial.biblioteca);
    if (inicial.sincronizada !== null || inicial.banco !== inicial.bancoNaBiblioteca) {
      await mkdir(pastasDoApp.bancosLocais, { recursive: true });
      await conferirEspaco(pastasDoApp.bancosLocais);
    }
    if (recursos.postgres === null) {
      throw new ErroDoBanco('binarios_ausentes', 'O banco embutido não veio com esta instalação do Margem. Reinstale o app.');
    }
    const binarios = recursos.postgres;
    this.binarios = binarios;
    await this.identificar(binarios);
    const pastas = this.pastas;

    this.progresso('Preparando o banco');
    const versaoDosProgramas = await this.ops.versaoDosBinarios(binarios);
    this.seguir();
    const arquivoDeLog = join(pastasDoApp.registros, 'postgres.log');
    girarSeGrande(arquivoDeLog);
    if (pastas.sincronizada !== null) {
      // Pasta sincronizada: o banco mora na pasta local do app (V-W8). Um banco antigo na biblioteca é copiado uma vez.
      const migracao = await migrarBancoParaLocal(binarios, pastas);
      this.seguir();
      this.evento('banco_pasta_sincronizada', {
        sincronizador: pastas.sincronizada, desfecho: migracao.desfecho,
        ...(migracao.antigoRenomeado === undefined ? {} : { antigo: migracao.antigoRenomeado }),
        ...(migracao.localAnterior === undefined ? {} : { local_anterior: migracao.localAnterior }),
      });
    }
    // U-03: uma cópia de segurança restaurada em `.margem/banco` (a marca vem dentro dela) já está no lugar.
    if (existsSync(join(pastas.banco, MARCA_DE_RESTAURACAO))) {
      // R2-3: copiada à mão (pendrive, zip, gerenciador de arquivos), a pasta pode ter perdido o 0700 que o
      // Postgres exige; a restauração é reconhecida aqui, antes de ele subir.
      if (process.platform !== 'win32') await chmod(pastas.banco, 0o700).catch(() => undefined);
      await rm(join(pastas.banco, MARCA_DE_RESTAURACAO), { force: true });
      this.evento('banco_restaurado', { local: pastas.banco !== pastas.bancoNaBiblioteca });
    }
    const versaoDaPasta = await versaoDoCluster(pastas.banco);
    const { senha, nova } = await senhaDaBiblioteca(pastasDoApp.segredos, pastas.biblioteca, pastas.id);
    let banco: ServicoNoAr['banco'];
    if (versaoDaPasta === null) {
      if (existsSync(pastas.banco) && (await readdir(pastas.banco)).length > 0) {
        throw new ErroDoBanco('pasta_invalida', `A pasta ${pastas.banco} já existe e não é um banco do Margem. Mova-a para outro lugar e abra de novo.`);
      }
      this.progresso('Criando o banco da biblioteca');
      await this.ops.inicializarCluster(binarios, pastas.banco, senha, pastasDoApp.temporaria);
      this.seguir();
      banco = 'criado';
      this.evento('banco_criado', { versao: versaoDosProgramas });
    } else {
      if (versaoDaPasta !== versaoDosProgramas) {
        throw new ErroDoBanco('versao_diferente', mensagemDeVersaoDiferente(versaoDaPasta, versaoDosProgramas));
      }
      const lock = await this.ops.tratarLockVelho(binarios, pastas.banco);
      this.seguir();
      if (lock !== 'sem_lock') this.evento('banco_lock', { decisao: lock });
      if (await restaurarHbaSeFicou(pastas.banco)) this.evento('banco_hba_restaurado');
      if (nova) {
        await this.redefinirSenha(binarios, senha, arquivoDeLog);
        this.evento('banco_senha_redefinida', { motivo: 'biblioteca_nova_neste_computador' });
        this.seguir();
      }
      banco = 'reaproveitado';
      this.evento('banco_reaproveitado', { versao: versaoDaPasta });
    }

    this.progresso('Ligando o banco');
    // A partir daqui o Postgres pode estar no ar: a parada tenta pará-lo, mesmo que a subida falhe no meio.
    this.bancoTocado = true;
    let portaDoBanco = await this.subirBanco(binarios, arquivoDeLog, configuracao.portaDoBanco);
    this.seguir();
    if (!(await this.ops.conferirSenha(senha, portaDoBanco))) {
      // Senha recusada (cluster de outro computador com o mesmo caminho, arquivo de senha trocado…).
      await this.pararBancoOuFalhar(binarios);
      await this.redefinirSenha(binarios, senha, arquivoDeLog);
      this.evento('banco_senha_redefinida', { motivo: 'senha_recusada' });
      this.seguir();
      portaDoBanco = await this.subirBanco(binarios, arquivoDeLog, portaDoBanco);
      if (!(await this.ops.conferirSenha(senha, portaDoBanco))) throw new ErroDoBanco('senha', 'O banco da biblioteca recusou a senha do app.');
    }
    await this.ops.garantirBanco(senha, portaDoBanco);
    this.seguir();
    if (banco === 'reaproveitado') portaDoBanco = await this.copiarSeForMigrar(binarios, senha, portaDoBanco, arquivoDeLog, versaoDosProgramas);
    this.evento('banco_no_ar', { porta: portaDoBanco });
    this.seguir();

    this.progresso('Ligando a biblioteca');
    const portaDaApi = await escolherPorta({ preferidas: [...FAIXA_DA_EXTENSAO, configuracao.portaDaApi], evitar: [portaDoBanco] });
    let avisoDaApi: string | null = null;
    if (portaDaApi !== PORTA_DA_EXTENSAO) {
      // V-W9: a extensão do navegador procura o Margem em 8730–8739; o estado explica o que houve com a 8730.
      const ocupada = await motivoDaPortaOcupada(PORTA_DA_EXTENSAO);
      this.evento('porta_8730_ocupada', { ...ocupada, porta_api: portaDaApi, extensao_acha: FAIXA_DA_EXTENSAO.includes(portaDaApi) });
      avisoDaApi = avisoDaPorta(portaDaApi, ocupada);
    }
    const segredos = await migrarSegredosDaBiblioteca(pastas.biblioteca, segredosDaBiblioteca(pastasDoApp.segredos, pastas.id));
    if (segredos.length > 0) this.evento('segredos_da_biblioteca', { arquivos: segredos });
    const raiz = this.opcoes.raizApp;
    const base = this.opcoes.ambiente ?? process.env;
    const confinamento = await decidirConfinamento({ ambiente: base, ...(this.opcoes.testarBwrap ? { testar: this.opcoes.testarBwrap } : {}) });
    const avisoDaPasta = avisoDaPastaSincronizada(pastas);
    const ambiente = ambienteDosFilhos({
      base, recursos, pastasDoApp, biblioteca: pastas,
      portaDaApi, urlDoBanco: urlDoBanco(senha, portaDoBanco), raiz,
      extras: { ...confinamento.variaveis, MARGEM_CHAVE_LOCAL: await chaveDaInstalacao(pastasDoApp.segredos) }, // S-01 (J161)
      banco: { pgCtl: binarios.pgCtl, pasta: pastas.banco },
      avisos: [confinamento.aviso, avisoDaPasta, avisoDaApi].filter((aviso): aviso is string => aviso !== null),
    });
    this.evento('servico_ambiente', {
      porta_api: portaDaApi, porta_banco: portaDoBanco, raiz, confinamento: confinamento.resumo,
      motor: recursos.motor === null ? 'ausente' : 'congelado',
    });
    this.api = this.supervisor('api', join(this.opcoes.raizApp, 'servico', 'api.mjs'), ambiente);
    this.api.iniciar();
    await this.esperarApi(portaDaApi);
    this.seguir();
    this.worker = this.supervisor('worker', join(this.opcoes.raizApp, 'servico', 'worker.mjs'), ambiente);
    this.worker.iniciar();
    const url = `http://127.0.0.1:${String(portaDaApi)}`;
    this.evento('servico_no_ar', { url });
    return { portaDaApi, portaDoBanco, url, banco };
  }

  /**
   * W-02: o id da pasta localiza o banco local, a senha e as cópias. A cópia de uma biblioteca (mesmo id
   * em dois caminhos) ganha id novo; se a original tinha banco local e a cópia não trouxe banco dentro
   * da pasta, ela começa com uma cópia conferida dele (o Postgres da original não está no ar: o app abre
   * uma biblioteca por vez, e um órfão é parado antes).
   */
  private async identificar(binarios: BinariosDoPostgres): Promise<void> {
    const { pastasDoApp } = this.opcoes;
    const ambiente = this.opcoes.ambiente ?? process.env;
    const inicial = this.pastas;
    let copiouDaOriginal = false;
    // R2-5: o banco da original é copiado antes de a cópia ganhar o id novo (ver `prepararCopia`).
    const prepararCopia = async ({ id, anterior }: { id: string; anterior: string }): Promise<void> => {
      const daOriginal = join(pastasDoApp.bancosLocais, anterior);
      const local = join(pastasDoApp.bancosLocais, id);
      if (!existsSync(join(daOriginal, 'PG_VERSION')) || existsSync(join(inicial.bancoNaBiblioteca, 'PG_VERSION')) || existsSync(local)) return;
      this.progresso('Copiando o banco da biblioteca original');
      await this.ops.tratarLockVelho(binarios, daOriginal);
      await this.ops.copiarCluster(daOriginal, local);
      copiouDaOriginal = true;
    };
    let identidade;
    try {
      identidade = await identificarBiblioteca(inicial.biblioteca, {
        registro: pastasDoApp.bibliotecas,
        temBancoAntigo: (legado) => [inicial.bancoNaBiblioteca, join(pastasDoApp.bancosLocais, legado)].some((pasta) => existsSync(join(pasta, 'PG_VERSION'))),
        adotarLegado: (legado, id) => adotarDoLegado(pastasDoApp, legado, id, { antesDeMoverOBanco: (pasta) => this.ops.tratarLockVelho(binarios, pasta) }),
        prepararCopia,
        ...(this.opcoes.perguntarSeCopiou === undefined ? {} : { perguntar: this.opcoes.perguntarSeCopiou }),
      });
    } catch (erro) {
      if (erro instanceof IdentidadeCancelada) throw new ErroDoServico('identidade_cancelada', erro.message);
      if (erro instanceof ErroDoBanco) throw erro;
      throw new ErroDoServico('pasta', `Não foi possível identificar a biblioteca em ${inicial.biblioteca}: ${(erro as Error).message}`);
    }
    this.seguir();
    this.pastas = pastasDaBiblioteca(inicial.biblioteca, { bancosLocais: pastasDoApp.bancosLocais, ambiente, id: identidade.id });
    this.evento('biblioteca_identificada', {
      desfecho: identidade.desfecho, ...(identidade.caminhoAnterior === undefined ? {} : { caminho_anterior: identidade.caminhoAnterior }),
      ...(identidade.legadoAdotado === undefined ? {} : { legado_adotado: true }),
    });
    if (copiouDaOriginal) this.evento('banco_copiado_da_original', {});
  }

  /**
   * U-03: "Fazer cópia de segurança…". Com o serviço no ar, lê as migrações aplicadas; para tudo (worker,
   * API e Postgres, como ao fechar); copia biblioteca e banco para uma pasta nova dentro de `destino`.
   * O serviço fica PARADO (este objeto não sobe de novo): quem chama abre a biblioteca outra vez.
   */
  async fazerCopiaDeSeguranca(destino: string, aoProgresso?: (etapa: string) => void): Promise<ResultadoDaCopiaDeSeguranca> {
    const noAr = this.iniciando === null ? null : await this.iniciando.catch(() => null);
    let aplicadas: string[] | null = null;
    if (noAr !== null) {
      const { senha } = await senhaDaBiblioteca(this.opcoes.pastasDoApp.segredos, this.pastas.biblioteca, this.pastas.id);
      aplicadas = await this.ops.migracoesAplicadas(senha, noAr.portaDoBanco).catch(() => null);
    }
    aoProgresso?.('Fechando a biblioteca para copiar');
    await this.parar();
    const versaoPostgres = this.binarios === null ? null : await versaoDoCluster(this.pastas.banco);
    const resultado = await fazerCopiaDeSeguranca(this.pastas, destino, {
      versaoDoApp: await versaoDoApp(this.opcoes.raizApp), versaoPostgres, migracoesAplicadas: aplicadas,
    }, aoProgresso === undefined ? {} : { aoProgresso });
    this.evento('copia_de_seguranca', { arquivos: resultado.manifesto.biblioteca.arquivos, bytes: resultado.manifesto.biblioteca.bytes + resultado.manifesto.banco.bytes });
    await gravarUltimaCopia(this.opcoes.pastasDoApp.copiasDeSeguranca, this.pastas.id, { pasta: resultado.pasta, criada_em: resultado.manifesto.criada_em })
      .catch(() => undefined);
    return resultado;
  }

  /** Senha nova no cluster parado: modo monousuário (a porta só serve ao caminho do administrador no Windows). */
  private async redefinirSenha(binarios: BinariosDoPostgres, senha: string, arquivoDeLog: string): Promise<void> {
    const porta = await escolherPorta({ preferidas: [], evitar: [PORTA_DA_EXTENSAO] });
    await this.ops.redefinirSenha(binarios, this.pastas.banco, senha, { porta, arquivoDeLog });
  }

  private async subirBanco(binarios: BinariosDoPostgres, arquivoDeLog: string, preferida: number | null): Promise<number> {
    let ultima: unknown;
    for (let tentativa = 0; tentativa < 4; tentativa += 1) {
      const porta = await escolherPorta({ preferidas: tentativa === 0 ? [preferida] : [], evitar: [PORTA_DA_EXTENSAO] });
      try {
        await this.ops.subir(binarios, this.pastas.banco, porta, arquivoDeLog);
        return porta;
      } catch (erro) {
        ultima = erro;
        if (erro instanceof ErroDoBanco && erro.codigo === 'subida') throw this.erroDoBancoQueNaoSubiu(erro);
        if (!(erro instanceof ErroDoBanco && erro.codigo === 'porta')) throw erro;
        this.evento('banco_porta_ocupada', { porta });
      }
    }
    throw ultima instanceof Error ? ultima : new ErroDoBanco('porta', 'Nenhuma porta livre para o banco.');
  }

  /**
   * D-06: a API vai aplicar migrações neste banco? Então, antes, uma cópia do cluster com o Postgres parado
   * (`<copias>/<id da biblioteca>`, só a última válida, com manifesto). Sem cópia, sem migração: o erro
   * explica e o banco fica como estava. Devolve a porta do banco, que volta a subir.
   */
  private async copiarSeForMigrar(binarios: BinariosDoPostgres, senha: string, porta: number, arquivoDeLog: string, versaoPostgres: number): Promise<number> {
    const aplicadas = await this.ops.migracoesAplicadas(senha, porta);
    const pendentes = pendentesQuePedemCopia(await migracoesEmpacotadas(join(this.opcoes.raizApp, 'servico', 'src', 'db', 'migrations')), aplicadas);
    if (pendentes.length === 0) return porta;
    this.progresso('Guardando uma cópia do banco antes de atualizá-lo');
    await this.pararBancoOuFalhar(binarios);
    this.seguir();
    const destino = this.pastaDaCopiaAntesDeMigrar;
    const { manifesto } = await this.ops.copiarAntesDeMigrar(this.pastas.banco, destino, {
      versao_do_app: await versaoDoApp(this.opcoes.raizApp), biblioteca: this.pastas.biblioteca, banco: this.pastas.banco,
      versao_postgres: versaoPostgres, migracoes_aplicadas: aplicadas?.length ?? 0, ultima_aplicada: aplicadas?.at(-1) ?? null, pendentes,
    });
    this.evento('banco_copiado_antes_de_migrar', { pasta: destino, pendentes: pendentes.length, bytes: manifesto.bytes, arquivos: manifesto.arquivos });
    this.seguir();
    this.progresso('Ligando o banco');
    return this.subirBanco(binarios, arquivoDeLog, porta);
  }

  /**
   * D-14: o Postgres não subiu por um motivo que não é porta, disco cheio nem bloqueio. Nada de reparo:
   * a orientação é preservar a pasta do banco e, se continuar, restaurar a última cópia.
   */
  private erroDoBancoQueNaoSubiu(erro: ErroDoBanco): ErroDoServico {
    const copia = this.locais.copiaAntesDeMigrar;
    return new ErroDoServico('subida', [
      'O banco da biblioteca não subiu.',
      '',
      `Não apague nem mexa na pasta do banco (${this.pastas.banco}): os seus dados continuam nela.`,
      'Reinicie o computador e abra o Margem de novo. Se continuar, guarde uma cópia dessa pasta e restaure a última cópia de segurança'
        + (copia === null ? '.' : ` (o Margem guardou uma antes da última atualização do banco, em ${copia}).`),
      'O passo a passo está em margem.dev/docs/backup.',
    ].join('\n'), erro.detalhe, { rotulo: 'Como restaurar', url: LINK_DA_RESTAURACAO });
  }

  /** D-07: a API (ou o worker) recusou o banco, que é de uma versão mais nova do Margem. */
  private erroDoBancoMaisNovo(): ErroDoServico {
    const copia = this.locais.copiaAntesDeMigrar;
    return new ErroDoServico('banco_mais_novo', [
      'Esta biblioteca foi aberta por uma versão mais nova do Margem, e esta versão não pode usá-la sem arriscar os seus dados. Nada foi alterado.',
      '',
      'Instale a versão mais recente do Margem (margem.dev/download).',
      copia === null
        ? 'Se você voltou para esta versão de propósito, restaure uma cópia de segurança feita antes da atualização (veja margem.dev/docs/backup).'
        : `Se você voltou para esta versão de propósito, restaure a cópia do banco que o Margem guardou antes da atualização, em ${copia} (veja margem.dev/docs/backup).`,
    ].join('\n'), `migracoes desconhecidas: ${(this.bancoMaisNovo ?? []).join(', ')}`, { rotulo: 'Baixar a versão nova', url: LINK_DO_DOWNLOAD });
  }

  /** `{"evento":"banco_mais_novo","migracoes":[...]}` na saída de erro da API ou do worker (J156). */
  private lerBancoMaisNovo(linha: string, supervisor: Supervisor): void {
    if (!linha.includes('banco_mais_novo')) return;
    let dados: { evento?: unknown; migracoes?: unknown };
    try { dados = JSON.parse(linha) as typeof dados; } catch { return; }
    if (dados.evento !== 'banco_mais_novo') return;
    const migracoes = Array.isArray(dados.migracoes) ? dados.migracoes.filter((m): m is string => typeof m === 'string') : [];
    if (this.bancoMaisNovo === null) this.evento('banco_mais_novo', { migracoes });
    this.bancoMaisNovo = migracoes;
    supervisor.naoReiniciar('banco_mais_novo');
  }

  /** Para o Postgres no meio da abertura; se não parar, a abertura não segue por cima dele. */
  private async pararBancoOuFalhar(binarios: BinariosDoPostgres): Promise<void> {
    if (!(await this.ops.parar(binarios, this.pastas.banco))) throw erroDaParada();
  }

  private supervisor(nome: 'api' | 'worker', script: string, ambiente: NodeJS.ProcessEnv): Supervisor {
    const registro = new Registro(join(this.opcoes.pastasDoApp.registros, `${nome}.log`));
    const eco = this.opcoes.eco;
    const supervisor: Supervisor = new Supervisor({
      nome, script, ambiente, cwd: this.pastas.biblioteca,
      ...(this.opcoes.executavel === undefined ? {} : { executavel: this.opcoes.executavel }),
    }, {
      prazoDeParadaMs: nome === 'worker' ? 45_000 : 15_000,
      aoLinha: (linha, fluxo) => {
        if (nome === 'api') this.lerSinalDaMigracao(linha);
        if (fluxo === 'erro') this.lerBancoMaisNovo(linha, supervisor);
        const texto = fluxo === 'erro' ? `[erro] ${linha}` : linha;
        registro.escrever(texto);
        eco?.(`${nome}: ${texto}`);
      },
      anotar: (evento, detalhe) => { this.evento(evento, detalhe); },
      aoDesistir: () => { this.opcoes.aoCair?.(nome); },
    });
    return supervisor;
  }

  /**
   * D-02 (contrato com o J156): a API anuncia no stdout `{"evento":"migracao_inicio"}` e
   * `{"evento":"migracao_fim"}`, e a saúde responde 503 `{"estado":"migrando"}` enquanto migra.
   */
  private migrandoDesde: number | null = null;

  private lerSinalDaMigracao(linha: string): void {
    if (!linha.includes('migracao_')) return;
    let evento: unknown;
    try { evento = (JSON.parse(linha) as { evento?: unknown }).evento; } catch { return; }
    if (evento === 'migracao_inicio') this.marcarMigrando(true);
    else if (evento === 'migracao_fim') this.marcarMigrando(false);
  }

  private marcarMigrando(migrando: boolean): void {
    if (migrando && this.migrandoDesde === null) {
      this.migrandoDesde = Date.now();
      this.evento('banco_migrando');
      this.progresso('Atualizando o banco da biblioteca (pode levar alguns minutos)');
    } else if (!migrando && this.migrandoDesde !== null) {
      this.evento('banco_migrado', { duracao_ms: Date.now() - this.migrandoDesde });
      this.migrandoDesde = null;
      this.progresso('Ligando a biblioteca');
    }
  }

  /**
   * Espera a saúde da API. O prazo comum (`prazoDaApiMs`) não vale enquanto ela migra o banco (D-02): a
   * migração tem o próprio teto (`prazoDaMigracaoMs`, padrão 1 h) e, ao terminar, o prazo comum recomeça.
   */
  private async esperarApi(porta: number): Promise<void> {
    const prazo = this.opcoes.prazoDaApiMs ?? 120_000;
    const tetoDaMigracao = this.opcoes.prazoDaMigracaoMs ?? 3_600_000;
    let limite = Date.now() + prazo;
    for (;;) {
      this.seguir();
      if (this.bancoMaisNovo !== null) throw this.erroDoBancoMaisNovo();
      if (this.api?.estado === 'desistiu') break;
      if (this.migrandoDesde !== null) {
        if (Date.now() - this.migrandoDesde > tetoDaMigracao) {
          throw new ErroDoServico('api', 'A atualização do banco da biblioteca está demorando demais. Feche o Margem e abra de novo; nada se perde.');
        }
        limite = Math.max(limite, Date.now() + prazo);
      } else if (Date.now() >= limite) break;
      try {
        const resposta = await fetch(`http://127.0.0.1:${String(porta)}/api/saude`, { signal: AbortSignal.timeout(3_000) });
        if (resposta.ok) { this.marcarMigrando(false); return; }
        if (resposta.status === 503) {
          const corpo = await resposta.json().catch(() => null) as { estado?: unknown } | null;
          this.marcarMigrando(corpo?.estado === 'migrando');
        }
      } catch {
        // Ainda subindo.
      }
      await esperar(400);
    }
    if (this.bancoMaisNovo !== null) throw this.erroDoBancoMaisNovo();
    throw new ErroDoServico('api', 'A biblioteca não respondeu a tempo. Veja os registros (Ajuda → Registros).');
  }

  /**
   * Worker e API (pedindo com educação), depois o Postgres com `pg_ctl stop -m fast`. Idempotente.
   * Pedida durante a abertura (L-02), espera a etapa em curso terminar (a abertura não começa outra) e então
   * limpa tudo. O Postgres que não para (L-05) é erro: quem chama não segue para a atualização, e pode
   * tentar de novo; o banco nunca é morto à força.
   */
  parar(): Promise<void> {
    this.pararPedido = true;
    this.parando ??= this.encerrar().catch((erro: unknown) => {
      this.parando = null;
      throw erro;
    });
    return this.parando;
  }

  private async encerrar(): Promise<void> {
    if (this.iniciando !== null) await this.iniciando.catch(() => undefined);
    const [worker, api] = await Promise.all([this.worker?.parar(), this.api?.parar()]);
    this.evento('servico_parado', { worker: worker ?? 'nao_iniciado', api: api ?? 'nao_iniciada' });
    if (this.binarios !== null && this.bancoTocado) {
      const ok = await this.ops.parar(this.binarios, this.pastas.banco);
      this.evento('banco_parado', { ok });
      if (!ok) throw erroDaParada();
      this.bancoTocado = false;
    }
  }
}

function erroDaParada(): ErroDoServico {
  return new ErroDoServico('parada',
    'O banco da biblioteca não fechou. Para não arriscar os seus dados, o Margem não o encerrou à força (e não instala '
    + 'uma atualização com ele aberto). Tente de novo em alguns segundos; se continuar, reinicie o computador.');
}
