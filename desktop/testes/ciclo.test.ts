/**
 * Ciclo de vida do serviço com operações do banco falsas e atrasos controlados (L-02, L-05): nada de
 * Postgres de verdade; API e worker são scripts Node pequenos.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CONFIGURACAO_PADRAO, pastasDoApp, prepararPastasDoApp } from '../src/nucleo/configuracao.js';
import type { RecursosResolvidos } from '../src/nucleo/recursos.js';
import { Registro } from '../src/nucleo/registros.js';
import { ABERTURA_INTERROMPIDA, ServicoDoMargem, type OperacoesDoBanco } from '../src/nucleo/servico.js';

let raiz = '';
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), 'margem-ciclo-')); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

function adiado<T = void>(): { promessa: Promise<T>; resolver: (valor: T) => void } {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((r) => { resolver = r; });
  return { promessa, resolver };
}

const esperarAte = async (condicao: () => boolean, prazoMs = 10_000): Promise<void> => {
  const limite = Date.now() + prazoMs;
  while (!condicao()) {
    if (Date.now() > limite) throw new Error('prazo esgotado');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/** API que nunca responde à saúde (ainda "subindo") e sai quando pedem pelo IPC. */
const API_MUDA = `
  process.on('message', (m) => { if (m === 'margem:parar') process.exit(0); });
  setInterval(() => {}, 1000);
`;

async function montar(opcoes: { cluster: boolean; api?: string; operacoes: Partial<OperacoesDoBanco>; prazoDaApiMs?: number }) {
  const pastas = pastasDoApp(join(raiz, 'app'));
  await prepararPastasDoApp(pastas);
  const biblioteca = join(raiz, 'biblioteca');
  if (opcoes.cluster) {
    await mkdir(join(biblioteca, '.margem', 'banco'), { recursive: true });
    await writeFile(join(biblioteca, '.margem', 'banco', 'PG_VERSION'), '18\n');
  }
  const raizApp = join(raiz, 'raiz');
  await mkdir(join(raizApp, 'servico'), { recursive: true });
  await writeFile(join(raizApp, 'servico', 'api.mjs'), opcoes.api ?? API_MUDA);
  await writeFile(join(raizApp, 'servico', 'worker.mjs'), API_MUDA);
  const eventos: string[] = [];
  const registro = new Registro(join(pastas.registros, 'app.log'));
  const evento = registro.evento.bind(registro);
  registro.evento = (nome, detalhe) => { eventos.push(nome); evento(nome, detalhe); };
  const recursos: RecursosResolvidos = {
    postgres: { initdb: '/pg/initdb', pgCtl: '/pg/pg_ctl', postgres: '/pg/postgres', origem: 'embutido' },
    codex: null, motor: null, fonte: null, ytDlp: null, ffmpeg: null, ffprobe: null, pastaBin: null,
  };
  const servico = new ServicoDoMargem({
    recursos, raizApp, pastasDoApp: pastas, biblioteca, configuracao: { ...CONFIGURACAO_PADRAO }, registro,
    executavel: process.execPath, prazoDaApiMs: opcoes.prazoDaApiMs ?? 60_000, ambiente: { PATH: process.env.PATH ?? '' },
    testarBwrap: () => Promise.resolve({ ok: true, detalhe: '' }),
    operacoes: {
      versaoDosBinarios: () => Promise.resolve(18),
      tratarLockVelho: () => Promise.resolve('sem_lock'),
      redefinirSenha: () => Promise.resolve(),
      inicializarCluster: () => Promise.resolve(),
      conferirSenha: () => Promise.resolve(true),
      garantirBanco: () => Promise.resolve(),
      migracoesAplicadas: () => Promise.resolve(null),
      ...opcoes.operacoes,
    },
  });
  return { servico, eventos };
}

describe('L-02: fechar durante a abertura', () => {
  it('parada pedida enquanto o pg_ctl start trabalha: o banco é parado depois que sobe e nenhum processo começa', async () => {
    const subida = adiado();
    let subiu = false;
    const paradas: string[] = [];
    const { servico } = await montar({
      cluster: true,
      operacoes: {
        subir: async () => { subiu = true; await subida.promessa; },
        parar: (_b, pasta) => { paradas.push(pasta); return Promise.resolve(true); },
      },
    });
    const abertura = servico.iniciar();
    await esperarAte(() => subiu);
    const parada = servico.parar();
    expect(paradas).toEqual([]);
    subida.resolver();
    await expect(abertura).rejects.toMatchObject({ codigo: ABERTURA_INTERROMPIDA });
    await parada;
    expect(paradas).toHaveLength(1);
    expect(servico.pids).toEqual({});
  });

  it('parada durante o initdb: nada sobe e não há banco para parar', async () => {
    const criacao = adiado();
    let criando = false;
    const chamadas: string[] = [];
    const { servico } = await montar({
      cluster: false,
      operacoes: {
        inicializarCluster: async () => { criando = true; await criacao.promessa; },
        subir: () => { chamadas.push('subir'); return Promise.resolve(); },
        parar: () => { chamadas.push('parar'); return Promise.resolve(true); },
      },
    });
    const abertura = servico.iniciar();
    await esperarAte(() => criando);
    const parada = servico.parar();
    criacao.resolver();
    await expect(abertura).rejects.toMatchObject({ codigo: ABERTURA_INTERROMPIDA });
    await parada;
    expect(chamadas).toEqual([]);
  });

  it('parada durante a espera da API: a API sai, o worker nunca começa e o banco para', { timeout: 30_000 }, async () => {
    const chamadas: string[] = [];
    const { servico, eventos } = await montar({
      cluster: true,
      operacoes: {
        subir: () => { chamadas.push('subir'); return Promise.resolve(); },
        parar: () => { chamadas.push('parar'); return Promise.resolve(true); },
      },
    });
    const abertura = servico.iniciar();
    await esperarAte(() => servico.pids.api !== undefined);
    const inicio = Date.now();
    await servico.parar();
    await expect(abertura).rejects.toMatchObject({ codigo: ABERTURA_INTERROMPIDA });
    expect(Date.now() - inicio).toBeLessThan(10_000);
    expect(chamadas).toEqual(['subir', 'parar']);
    expect(eventos.filter((e) => e === 'processo_iniciado')).toHaveLength(1);
    expect(servico.pids).toEqual({});
  });
});

describe('L-05: o banco que não para', () => {
  it('a parada falha com erro claro, sem matar o banco, e pode ser tentada de novo', async () => {
    let tentativas = 0;
    const { servico, eventos } = await montar({
      cluster: true,
      operacoes: {
        subir: () => Promise.reject(Object.assign(new Error('não subiu'), { codigo: 'subida' })),
        parar: () => { tentativas += 1; return Promise.resolve(tentativas > 1); },
      },
    });
    await expect(servico.iniciar()).rejects.toThrow('não subiu');
    await expect(servico.parar()).rejects.toMatchObject({ codigo: 'parada' });
    expect(eventos).toContain('banco_parado');
    await expect(servico.parar()).resolves.toBeUndefined();
    expect(tentativas).toBe(2);
    // Já parado: nada mais a fazer.
    await servico.parar();
    expect(tentativas).toBe(2);
  });
});

describe('D-06: cópia antes de migrar, na abertura', () => {
  async function comMigracoes(): Promise<void> {
    const pasta = join(raiz, 'raiz', 'servico', 'src', 'db', 'migrations');
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, '0001_a.sql'), '');
    await writeFile(join(pasta, '0002_b.sql'), '');
  }

  it('com migração pendente, o banco para, é copiado e volta antes da API', { timeout: 30_000 }, async () => {
    const passos: string[] = [];
    const { servico, eventos } = await montar({
      cluster: true,
      operacoes: {
        migracoesAplicadas: () => Promise.resolve(['0001_a.sql']),
        subir: () => { passos.push('subir'); return Promise.resolve(); },
        parar: () => { passos.push('parar'); return Promise.resolve(true); },
        copiarAntesDeMigrar: (_o, destino, dados) => {
          passos.push(`copiar ${dados.pendentes.join(',')}`);
          return Promise.resolve({ pasta: destino, manifesto: { ...dados, criada_em: '', arquivos: 1, bytes: 1 } });
        },
      },
    });
    await comMigracoes();
    const abertura = servico.iniciar();
    await esperarAte(() => servico.pids.api !== undefined);
    expect(passos).toEqual(['subir', 'parar', 'copiar 0002_b.sql', 'subir']);
    expect(eventos).toContain('banco_copiado_antes_de_migrar');
    await servico.parar();
    await abertura.catch(() => undefined);
  });

  it('sem cópia, sem migração: a API não sobe e o erro explica', async () => {
    const passos: string[] = [];
    const { servico } = await montar({
      cluster: true,
      operacoes: {
        migracoesAplicadas: () => Promise.resolve(['0001_a.sql']),
        subir: () => { passos.push('subir'); return Promise.resolve(); },
        parar: () => { passos.push('parar'); return Promise.resolve(true); },
        copiarAntesDeMigrar: () => Promise.reject(Object.assign(new Error('não há espaço'), { codigo: 'copia' })),
      },
    });
    await comMigracoes();
    await expect(servico.iniciar()).rejects.toMatchObject({ codigo: 'copia' });
    expect(servico.pids).toEqual({});
    expect(passos).toEqual(['subir', 'parar']);
    await servico.parar();
  });

  it('sem pendentes, nenhuma cópia', { timeout: 30_000 }, async () => {
    const passos: string[] = [];
    const { servico } = await montar({
      cluster: true,
      operacoes: {
        migracoesAplicadas: () => Promise.resolve(['0001_a.sql', '0002_b.sql']),
        subir: () => { passos.push('subir'); return Promise.resolve(); },
        parar: () => { passos.push('parar'); return Promise.resolve(true); },
        copiarAntesDeMigrar: () => Promise.reject(new Error('não devia copiar')),
      },
    });
    await comMigracoes();
    const abertura = servico.iniciar();
    await esperarAte(() => servico.pids.api !== undefined);
    expect(passos).toEqual(['subir']);
    await servico.parar();
    await abertura.catch(() => undefined);
  });
});

describe('D-02: esperar a API enquanto ela migra', () => {
  // A API anuncia a migração no stdout e a saúde responde 503 "migrando" (contrato com o J156); a
  // migração dura mais que o prazo comum da API.
  const api = (comAnuncio: boolean) => `
    import http from 'node:http';
    const porta = Number(process.env.MARGEM_PORTA);
    let migrando = true;
    const servidor = http.createServer((_req, res) => {
      if (migrando) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, estado: 'migrando' })); return; }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
    });
    servidor.listen(porta, '127.0.0.1');
    ${comAnuncio ? "console.log(JSON.stringify({ evento: 'migracao_inicio', pendentes: 1 }));" : ''}
    setTimeout(() => { migrando = false; ${comAnuncio ? "console.log(JSON.stringify({ evento: 'migracao_fim', duracao_ms: 1500 }));" : ''} }, 1500);
    process.on('message', (m) => { if (m === 'margem:parar') process.exit(0); });
  `;

  for (const comAnuncio of [true, false]) {
    it(`migração além do prazo comum não derruba a abertura (${comAnuncio ? 'anúncio no stdout' : 'só a saúde 503'})`, { timeout: 30_000 }, async () => {
      const { servico, eventos } = await montar({
        cluster: true, api: api(comAnuncio), prazoDaApiMs: 600,
        operacoes: { subir: () => Promise.resolve(), parar: () => Promise.resolve(true) },
      });
      await expect(servico.iniciar()).resolves.toMatchObject({ banco: 'reaproveitado' });
      expect(eventos).toContain('banco_migrando');
      expect(eventos).toContain('banco_migrado');
      await servico.parar();
    });
  }

  it('sem sinal de migração, o prazo comum continua valendo', { timeout: 30_000 }, async () => {
    const { servico } = await montar({
      cluster: true, prazoDaApiMs: 600,
      operacoes: { subir: () => Promise.resolve(), parar: () => Promise.resolve(true) },
    });
    await expect(servico.iniciar()).rejects.toMatchObject({ codigo: 'api' });
    await servico.parar();
  });
});
