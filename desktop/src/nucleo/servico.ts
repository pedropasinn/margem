/**
 * O serviço do Margem dentro do app: Postgres embutido, API e worker, nessa ordem, e o desligamento
 * na ordem inversa. Não importa nada do Electron (os testes e o `fumaca` rodam isto direto).
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import pg from 'pg';
import {
  pastasDaBiblioteca, senhaDaBiblioteca, type ConfiguracaoDoApp, type PastasDaBiblioteca, type PastasDoApp,
} from './configuracao.js';
import { avisoDaPastaSincronizada, migrarBancoParaLocal } from './banco-local.js';
import { decidirConfinamento, type TestarBwrap } from './confinamento.js';
import { avisoDaPorta, escolherPorta, FAIXA_DA_EXTENSAO, motivoDaPortaOcupada, PORTA_DA_EXTENSAO } from './porta.js';
import {
  BANCO, ErroDoBanco, conferirEspaco, inicializarCluster, mensagemDeVersaoDiferente, parar as pararPostgres, redefinirSenha,
  restaurarHbaSeFicou, subir as subirPostgres, tratarLockVelho, urlDoBanco, versaoDoCluster, versaoDosBinarios,
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
  if (entrada.avisos !== undefined && entrada.avisos.length > 0) ambiente.MARGEM_AVISOS = entrada.avisos.join('\n');
  else delete ambiente.MARGEM_AVISOS;
  // MARGEM_RECURSOS fica como a pessoa deixou (o padrão do serviço vale sem ela). MARGEM_ARTE_DIR também
  // não é definido: as obras que a pessoa importa vão para o padrão do serviço, <MARGEM_DADOS>/quadros (J118).
  delete ambiente.MARGEM_ARTE_DIR;
  return ambiente;
}

export class ErroDoServico extends Error {
  constructor(readonly codigo: string, mensagem: string, readonly detalhe?: string) {
    super(mensagem);
    this.name = 'ErroDoServico';
  }
}

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
  /** Troca a sonda do bwrap (testes). */
  testarBwrap?: TestarBwrap;
  /** Eco das linhas da API e do worker (o `--sem-janela` manda para a saída padrão). */
  eco?: (linha: string) => void;
}

export interface ServicoNoAr { portaDaApi: number; portaDoBanco: number; url: string; banco: 'criado' | 'reaproveitado' }

function esperar(ms: number): Promise<void> {
  return new Promise((resolver) => setTimeout(resolver, ms));
}

export class ServicoDoMargem {
  private api: Supervisor | null = null;
  private worker: Supervisor | null = null;
  private binarios: BinariosDoPostgres | null = null;
  private pastas: PastasDaBiblioteca;
  private postgresNoAr = false;
  private parando: Promise<void> | null = null;

  constructor(private readonly opcoes: OpcoesDoServico) {
    this.pastas = pastasDaBiblioteca(opcoes.biblioteca, { bancosLocais: opcoes.pastasDoApp.bancosLocais, ambiente: opcoes.ambiente ?? process.env });
  }

  get biblioteca(): PastasDaBiblioteca { return this.pastas; }
  get pids(): { api?: number; worker?: number } {
    return { ...(this.api?.pid === undefined ? {} : { api: this.api.pid }), ...(this.worker?.pid === undefined ? {} : { worker: this.worker.pid }) };
  }

  private evento(evento: string, detalhe: Record<string, unknown> = {}): void {
    this.opcoes.registro.evento(evento, detalhe);
  }

  private progresso(etapa: string): void {
    this.opcoes.aoProgresso?.(etapa);
  }

  async iniciar(): Promise<ServicoNoAr> {
    const { recursos, pastasDoApp, configuracao } = this.opcoes;
    const pastas = this.pastas;
    this.progresso('Preparando a pasta da biblioteca');
    try {
      await mkdir(pastas.biblioteca, { recursive: true });
      await mkdir(pastas.interna, { recursive: true });
    } catch (erro) {
      throw new ErroDoServico('pasta', `Não foi possível usar a pasta ${pastas.biblioteca}: ${(erro as Error).message}`);
    }
    await conferirEspaco(pastas.biblioteca);
    if (pastas.banco !== pastas.bancoNaBiblioteca) {
      await mkdir(pastasDoApp.bancosLocais, { recursive: true });
      await conferirEspaco(pastasDoApp.bancosLocais);
    }
    if (recursos.postgres === null) {
      throw new ErroDoBanco('binarios_ausentes', 'O banco embutido não veio com esta instalação do Margem. Reinstale o app.');
    }
    const binarios = recursos.postgres;
    this.binarios = binarios;

    this.progresso('Preparando o banco');
    const versaoDosProgramas = await versaoDosBinarios(binarios);
    const arquivoDeLog = join(pastasDoApp.registros, 'postgres.log');
    girarSeGrande(arquivoDeLog);
    if (pastas.sincronizada !== null) {
      // Pasta sincronizada: o banco mora na pasta local do app (V-W8). Um banco antigo na biblioteca é copiado uma vez.
      const migracao = await migrarBancoParaLocal(binarios, pastas);
      this.evento('banco_pasta_sincronizada', {
        sincronizador: pastas.sincronizada, desfecho: migracao.desfecho,
        ...(migracao.antigoRenomeado === undefined ? {} : { antigo: migracao.antigoRenomeado }),
      });
    }
    const versaoDaPasta = await versaoDoCluster(pastas.banco);
    const { senha, nova } = await senhaDaBiblioteca(pastasDoApp.segredos, pastas.biblioteca);
    let banco: ServicoNoAr['banco'];
    if (versaoDaPasta === null) {
      if (existsSync(pastas.banco) && (await readdir(pastas.banco)).length > 0) {
        throw new ErroDoBanco('pasta_invalida', `A pasta ${pastas.banco} já existe e não é um banco do Margem. Mova-a para outro lugar e abra de novo.`);
      }
      this.progresso('Criando o banco da biblioteca');
      await inicializarCluster(binarios, pastas.banco, senha, pastasDoApp.temporaria);
      banco = 'criado';
      this.evento('banco_criado', { versao: versaoDosProgramas });
    } else {
      if (versaoDaPasta !== versaoDosProgramas) {
        throw new ErroDoBanco('versao_diferente', mensagemDeVersaoDiferente(versaoDaPasta, versaoDosProgramas));
      }
      const lock = await tratarLockVelho(binarios, pastas.banco);
      if (lock !== 'sem_lock') this.evento('banco_lock', { decisao: lock });
      if (await restaurarHbaSeFicou(pastas.banco)) this.evento('banco_hba_restaurado');
      if (nova) {
        await this.redefinirSenha(binarios, senha, arquivoDeLog);
        this.evento('banco_senha_redefinida', { motivo: 'biblioteca_nova_neste_computador' });
      }
      banco = 'reaproveitado';
      this.evento('banco_reaproveitado', { versao: versaoDaPasta });
    }

    this.progresso('Ligando o banco');
    let portaDoBanco = await this.subirBanco(binarios, arquivoDeLog, configuracao.portaDoBanco);
    this.postgresNoAr = true;
    if (!(await this.conferirSenha(senha, portaDoBanco))) {
      // Senha recusada (cluster de outro computador com o mesmo caminho, arquivo de senha trocado…).
      await pararPostgres(binarios, pastas.banco);
      await this.redefinirSenha(binarios, senha, arquivoDeLog);
      this.evento('banco_senha_redefinida', { motivo: 'senha_recusada' });
      portaDoBanco = await this.subirBanco(binarios, arquivoDeLog, portaDoBanco);
      if (!(await this.conferirSenha(senha, portaDoBanco))) throw new ErroDoBanco('senha', 'O banco da biblioteca recusou a senha do app.');
    }
    await this.garantirBanco(senha, portaDoBanco);
    this.evento('banco_no_ar', { porta: portaDoBanco });

    this.progresso('Ligando a biblioteca');
    const portaDaApi = await escolherPorta({ preferidas: [...FAIXA_DA_EXTENSAO, configuracao.portaDaApi], evitar: [portaDoBanco] });
    let avisoDaApi: string | null = null;
    if (portaDaApi !== PORTA_DA_EXTENSAO) {
      // V-W9: a extensão do navegador procura o Margem em 8730–8739; o estado explica o que houve com a 8730.
      const ocupada = await motivoDaPortaOcupada(PORTA_DA_EXTENSAO);
      this.evento('porta_8730_ocupada', { ...ocupada, porta_api: portaDaApi, extensao_acha: FAIXA_DA_EXTENSAO.includes(portaDaApi) });
      avisoDaApi = avisoDaPorta(portaDaApi, ocupada);
    }
    const raiz = this.opcoes.raizApp;
    const base = this.opcoes.ambiente ?? process.env;
    const confinamento = await decidirConfinamento({ ambiente: base, ...(this.opcoes.testarBwrap ? { testar: this.opcoes.testarBwrap } : {}) });
    const avisoDaPasta = avisoDaPastaSincronizada(pastas);
    const ambiente = ambienteDosFilhos({
      base, recursos, pastasDoApp, biblioteca: pastas,
      portaDaApi, urlDoBanco: urlDoBanco(senha, portaDoBanco), raiz,
      extras: confinamento.variaveis,
      avisos: [confinamento.aviso, avisoDaPasta, avisoDaApi].filter((aviso): aviso is string => aviso !== null),
    });
    this.evento('servico_ambiente', {
      porta_api: portaDaApi, porta_banco: portaDoBanco, raiz, confinamento: confinamento.resumo,
      motor: recursos.motor === null ? 'ausente' : 'congelado',
    });
    this.api = this.supervisor('api', join(this.opcoes.raizApp, 'servico', 'api.mjs'), ambiente);
    this.api.iniciar();
    await this.esperarApi(portaDaApi);
    this.worker = this.supervisor('worker', join(this.opcoes.raizApp, 'servico', 'worker.mjs'), ambiente);
    this.worker.iniciar();
    const url = `http://127.0.0.1:${String(portaDaApi)}`;
    this.evento('servico_no_ar', { url });
    return { portaDaApi, portaDoBanco, url, banco };
  }

  /** Senha nova no cluster parado: subida curta numa porta livre com o pg_hba.conf temporário (postgres.ts). */
  private async redefinirSenha(binarios: BinariosDoPostgres, senha: string, arquivoDeLog: string): Promise<void> {
    const porta = await escolherPorta({ preferidas: [], evitar: [PORTA_DA_EXTENSAO] });
    await redefinirSenha(binarios, this.pastas.banco, senha, { porta, arquivoDeLog });
  }

  private async subirBanco(binarios: BinariosDoPostgres, arquivoDeLog: string, preferida: number | null): Promise<number> {
    let ultima: unknown;
    for (let tentativa = 0; tentativa < 4; tentativa += 1) {
      const porta = await escolherPorta({ preferidas: tentativa === 0 ? [preferida] : [], evitar: [PORTA_DA_EXTENSAO] });
      try {
        await subirPostgres(binarios, this.pastas.banco, porta, arquivoDeLog);
        return porta;
      } catch (erro) {
        ultima = erro;
        if (!(erro instanceof ErroDoBanco && erro.codigo === 'porta')) throw erro;
        this.evento('banco_porta_ocupada', { porta });
      }
    }
    throw ultima instanceof Error ? ultima : new ErroDoBanco('porta', 'Nenhuma porta livre para o banco.');
  }

  private async conferirSenha(senha: string, porta: number): Promise<boolean> {
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

  private async garantirBanco(senha: string, porta: number): Promise<void> {
    const cliente = new pg.Client({ connectionString: urlDoBanco(senha, porta, 'postgres'), connectionTimeoutMillis: 10_000 });
    await cliente.connect();
    try {
      const existe = await cliente.query('SELECT 1 FROM pg_database WHERE datname = $1', [BANCO]);
      if (existe.rowCount === 0) await cliente.query(`CREATE DATABASE ${BANCO}`);
    } finally {
      await cliente.end().catch(() => undefined);
    }
  }

  private supervisor(nome: 'api' | 'worker', script: string, ambiente: NodeJS.ProcessEnv): Supervisor {
    const registro = new Registro(join(this.opcoes.pastasDoApp.registros, `${nome}.log`));
    const eco = this.opcoes.eco;
    return new Supervisor({
      nome, script, ambiente, cwd: this.pastas.biblioteca,
      ...(this.opcoes.executavel === undefined ? {} : { executavel: this.opcoes.executavel }),
    }, {
      prazoDeParadaMs: nome === 'worker' ? 45_000 : 15_000,
      aoLinha: (linha, fluxo) => {
        const texto = fluxo === 'erro' ? `[erro] ${linha}` : linha;
        registro.escrever(texto);
        eco?.(`${nome}: ${texto}`);
      },
      anotar: (evento, detalhe) => { this.evento(evento, detalhe); },
      aoDesistir: () => { this.opcoes.aoCair?.(nome); },
    });
  }

  private async esperarApi(porta: number): Promise<void> {
    const limite = Date.now() + (this.opcoes.prazoDaApiMs ?? 120_000);
    while (Date.now() < limite) {
      if (this.api?.estado === 'desistiu') break;
      try {
        const resposta = await fetch(`http://127.0.0.1:${String(porta)}/api/saude`, { signal: AbortSignal.timeout(3_000) });
        if (resposta.ok) return;
      } catch {
        // Ainda subindo.
      }
      await esperar(400);
    }
    throw new ErroDoServico('api', 'A biblioteca não respondeu a tempo. Veja os registros (Ajuda → Registros).');
  }

  /** Worker e API (pedindo com educação), depois o Postgres com `pg_ctl stop -m fast`. Idempotente. */
  parar(): Promise<void> {
    this.parando ??= (async () => {
      const [worker, api] = await Promise.all([this.worker?.parar(), this.api?.parar()]);
      this.evento('servico_parado', { worker: worker ?? 'nao_iniciado', api: api ?? 'nao_iniciada' });
      if (this.binarios !== null && this.postgresNoAr) {
        const ok = await pararPostgres(this.binarios, this.pastas.banco);
        this.postgresNoAr = !ok;
        this.evento('banco_parado', { ok });
      }
    })();
    return this.parando;
  }
}
