import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, test } from 'vitest';
import type { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { ARQUIVO_SAIDA, executarCodex, montarArgumentos } from './codex.js';
import { conferirResposta, escreverSchemaDoCodex } from './artefato.js';
import { ARQUIVO_PROMPT, PONTEIRO_DO_PROMPT, promptCabeNaLinha, tamanhoNaLinhaDoWindows } from './entrada.js';
import { classificarSaida, esforcoDaSaida, horarioDeVolta, modeloDaSaida } from './classificacao.js';
import type { Capacidades } from './capacidades.js';
import { FLAGS_NECESSARIAS } from './capacidades.js';

const CAPACIDADES: Capacidades = {
  versao: 'codex-cli 0.154.0',
  flags: Object.fromEntries(FLAGS_NECESSARIAS.map((flag) => [flag, true])),
  faltando: [],
};

const SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object', additionalProperties: false, required: ['ok'],
  properties: { ok: { type: 'boolean' } },
};

let base = '';
let entrada = '';
let schema = '';
let artefatos = '';

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'margem-teste-codex-'));
  entrada = join(base, 'entrada');
  artefatos = join(base, 'artefatos');
  schema = join(base, 'schema.json');
  await writeFile(join(base, 'guardado'), 'x');
  await rm(join(base, 'guardado'));
  await import('node:fs/promises').then(({ mkdir }) => mkdir(entrada, { recursive: true }));
  await writeFile(join(entrada, 'metodo.md'), '# método\n');
  await writeFile(join(entrada, 'parte.txt'), 'texto da parte\n');
  await writeFile(schema, JSON.stringify(SCHEMA));
});

afterAll(async () => { await rm(base, { recursive: true, force: true }); });

const injetadas = ['DATABASE_URL', 'PGPASSWORD'];
afterEach(() => { for (const nome of injetadas) delete process.env[nome]; });

interface Encenacao {
  stderr?: string;
  codigo?: number | null;
  saida?: string;
  atrasoMs?: number;
  erro?: string;
}

interface Chamada { arquivo: string; argumentos: string[]; opcoes: SpawnOptions }

function spawnFalso(encenacao: Encenacao, registro: Chamada[]): typeof spawn {
  return ((arquivo: string, argumentos: readonly string[], opcoes: SpawnOptions) => {
    registro.push({ arquivo, argumentos: [...argumentos], opcoes });
    const filho = new EventEmitter() as unknown as ChildProcess & { stderr: Readable };
    filho.stderr = Readable.from([Buffer.from(encenacao.stderr ?? '')]);
    Object.defineProperty(filho, 'pid', { value: undefined });
    Object.defineProperty(filho, 'exitCode', { value: null, configurable: true, writable: true });
    filho.kill = () => true;
    setTimeout(() => {
      if (encenacao.erro !== undefined) { filho.emit('error', new Error(encenacao.erro)); return; }
      const alvo = argumentos.at(argumentos.indexOf('--output-last-message') + 1);
      const escrever = encenacao.saida !== undefined && alvo !== undefined
        ? writeFile(alvo, encenacao.saida)
        : Promise.resolve();
      void escrever.then(() => { filho.emit('close', encenacao.codigo ?? 0); });
    }, encenacao.atrasoMs ?? 1);
    return filho;
  }) as unknown as typeof spawn;
}

test('monta o comando com o perfil restrito pedido pelo desenho', () => {
  const argumentos = montarArgumentos({
    diretorio: '/tmp/margem-job-abc', schema: '/tmp/margem-job-abc/schema.json',
    saida: '/tmp/margem-job-abc/saida.json', prompt: 'leia', modelo: 'gpt-5.6-sol', esforco: 'high',
  });
  const texto = argumentos.join(' ');
  expect(argumentos[0]).toBe('exec');
  expect(texto).toContain('--sandbox read-only');
  expect(texto).toContain('-C /tmp/margem-job-abc');
  expect(texto).toContain('--skip-git-repo-check');
  expect(texto).toContain('--dangerously-bypass-hook-trust');
  expect(texto).toContain('approval_policy="never"');
  expect(texto).toContain('web_search="disabled"');
  expect(texto).toContain('mcp_servers={}');
  expect(texto).toContain('--output-schema /tmp/margem-job-abc/schema.json');
  expect(texto).toContain('--output-last-message /tmp/margem-job-abc/saida.json');
  expect(texto).toContain('model_reasoning_effort="high"');
  expect(texto).toContain('-m gpt-5.6-sol');
  expect(argumentos.at(-1)).toBe('leia');
  expect(argumentos).not.toContain('--worktree');
  expect(argumentos).not.toContain('--dangerously-bypass-approvals-and-sandbox');
});

test('V-T2: a busca na web do Codex só liga quando pedida (identificação de quadro)', () => {
  const base = { diretorio: '/tmp/margem-job-abc', schema: '/tmp/s.json', saida: '/tmp/o.json', prompt: 'que obra é esta?', imagens: ['/tmp/margem-job-abc/obra.jpg'] };
  const ligada = montarArgumentos({ ...base, buscaNaWeb: true }).join(' ');
  expect(ligada).toContain('web_search="live"');
  expect(ligada).not.toContain('web_search="disabled"');
  expect(ligada).toContain('--image /tmp/margem-job-abc/obra.jpg -- que obra é esta?');
  expect(montarArgumentos(base).join(' ')).toContain('web_search="disabled"');
});

test('com imagens, o prompt vem depois de -- e não vira mais uma imagem (codex 0.154+)', () => {
  const argumentos = montarArgumentos({ diretorio: '/d', schema: '/s', saida: '/o', prompt: 'resolva', imagens: ['/d/recorte.png', '/d/extra.png'] });
  expect(argumentos.slice(-2)).toEqual(['--', 'resolva']);
  expect(argumentos.indexOf('--')).toBeGreaterThan(argumentos.lastIndexOf('/d/extra.png'));
});

test('sem modelo e sem esforço o comando não inventa valores', () => {
  const argumentos = montarArgumentos({ diretorio: '/d', schema: '/s', saida: '/o', prompt: 'p' });
  expect(argumentos).not.toContain('-m');
  expect(argumentos.join(' ')).not.toContain('model_reasoning_effort');
});

test('o processo do motor não recebe credenciais nem variáveis do Margem', async () => {
  process.env.DATABASE_URL = 'postgres://usuario:senha@127.0.0.1:5435/margem';
  process.env.PGPASSWORD = 'senha-do-postgres';
  const registro: Chamada[] = [];
  const resultado = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'leia', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":true}', stderr: 'model: gpt-5.6-sol\n' }, registro) },
  );
  expect(resultado.estado).toBe('ok');
  const chamada = registro[0];
  expect(chamada).toBeDefined();
  const ambiente = chamada?.opcoes.env ?? {};
  expect(ambiente).not.toHaveProperty('DATABASE_URL');
  expect(ambiente).not.toHaveProperty('PGPASSWORD');
  expect(JSON.stringify(ambiente)).not.toContain('senha');
  expect(chamada?.opcoes.stdio).toEqual(['ignore', 'ignore', 'pipe']);
  if (resultado.estado === 'ok') {
    expect(resultado.modelo).toBe('gpt-5.6-sol');
    expect(await readFile(resultado.artefato, 'utf8')).toBe('{"ok":true}');
  }
});

test('o diretório temporário desaparece no sucesso e na falha', async () => {
  const registro: Chamada[] = [];
  const bom = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'a', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":true}' }, registro) },
  );
  expect(bom.estado).toBe('ok');
  const ruim = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'b', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ codigo: 1, stderr: 'estourou' }, registro) },
  );
  expect(ruim.estado).toBe('falhou');
  for (const chamada of registro) {
    const diretorio = chamada.argumentos.at(chamada.argumentos.indexOf('-C') + 1);
    expect(diretorio).toBeDefined();
    expect(existsSync(diretorio ?? '')).toBe(false);
  }
});

test('resposta fora do schema vira falha de schema e resposta truncada vira json_invalido', async () => {
  const foraDoSchema = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'c', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":"talvez"}' }, []) },
  );
  expect(foraDoSchema).toMatchObject({ estado: 'falhou', codigo: 'schema' });
  const truncada = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'd', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":' }, []) },
  );
  expect(truncada).toMatchObject({ estado: 'falhou', codigo: 'json_invalido' });
});

test('cota vira adiamento com horário de volta e autenticação vira auth', async () => {
  const adiado = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'e', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ codigo: 1, stderr: 'You have hit your usage limit. Try again at 2099-09-21T10:27:00Z' }, []) },
  );
  expect(adiado.estado).toBe('adiado');
  if (adiado.estado === 'adiado') {
    expect(adiado.codigo).toBe('cota');
    expect(adiado.not_before.toISOString()).toBe('2099-09-21T10:27:00.000Z');
  }
  const semSessao = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'f', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ codigo: 1, stderr: 'Error: not logged in; run codex login' }, []) },
  );
  expect(semSessao).toMatchObject({ estado: 'falhou', codigo: 'auth' });
});

test('falha do processo devolve código de saída, classe, causa legível e stderr redigido (V-W2)', async () => {
  const stderr = [
    '2026-10-14T12:33:00.1Z ERROR codex_models_manager::manager: failed to refresh available models: unexpected status 401 Unauthorized, cf-ray: 8f429-GRU',
    'Authorization: Bearer token-que-nao-pode-sair',
    'ERROR: unexpected status 400 Bad Request: {"error":{"code":"invalid_json_schema"}}',
  ].join('\n');
  const resultado = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'r', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ codigo: 1, stderr }, []) },
  );
  // O 401 do aviso de modelos não vira "sem sessão".
  expect(resultado).toMatchObject({
    estado: 'falhou', codigo: 'processo',
    mensagem: 'O Codex recusou o formato de resposta pedido pelo Margem. É um defeito do Margem; avise o suporte.',
    detalhe: { codigo_saida: 1, classe: 'desconhecido', causa: 'O Codex recusou o formato de resposta pedido pelo Margem. É um defeito do Margem; avise o suporte.' },
  });
  if (resultado.estado !== 'falhou') throw new Error('esperava falha');
  expect(resultado.detalhe?.stderr_resumo).toContain('invalid_json_schema');
  expect(resultado.detalhe?.stderr_resumo).not.toContain('token-que-nao-pode-sair');

  const semCausa = await executarCodex(
    { diretorioEntrada: entrada, prompt: 's', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ codigo: 3, stderr: 'ERROR: algo que ninguém previu' }, []) },
  );
  expect(semCausa).toMatchObject({ estado: 'falhou', codigo: 'processo', mensagem: 'A CLI terminou com código 3.', detalhe: { codigo_saida: 3, causa: null } });

  const naoAbriu = await executarCodex(
    { diretorioEntrada: entrada, prompt: 't', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ erro: 'spawn ENAMETOOLONG' }, []) },
  );
  expect(naoAbriu).toMatchObject({ estado: 'falhou', codigo: 'processo', mensagem: 'A linha de comando do Codex ficou longa demais para este sistema.', detalhe: { codigo_saida: null } });
});

test('Windows: prompt que estoura a linha de comando vai para prompt.md; Linux mantém o teto por argumento (V-W4)', async () => {
  const longo = `Leia "isto" com cuidado. ${'texto da parte com aspas " e barras \\ '.repeat(1_100)}`;
  expect(longo.length).toBeGreaterThan(40_000);
  const rodar = async (plataforma: NodeJS.Platform) => {
    const registro: Chamada[] = [];
    const falso = spawnFalso({ saida: '{"ok":true}' }, registro);
    let noArquivo: string | null = null;
    const gerar = ((arquivo: string, argumentos: readonly string[], opcoes: SpawnOptions) => {
      const caminho = join(String(opcoes.cwd), ARQUIVO_PROMPT);
      noArquivo = existsSync(caminho) ? readFileSync(caminho, 'utf8') : null;
      return falso(arquivo, argumentos, opcoes);
    }) as unknown as typeof spawn;
    const resultado = await executarCodex(
      { diretorioEntrada: entrada, prompt: longo, schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
      { capacidades: CAPACIDADES, gerar, plataforma, binario: 'C:\\Program Files\\Margem\\resources\\codex\\codex.exe' },
    );
    expect(resultado.estado).toBe('ok');
    return { chamada: registro[0]!, noArquivo: noArquivo as string | null };
  };
  const windows = await rodar('win32');
  expect(windows.chamada.argumentos.at(-1)).toBe(PONTEIRO_DO_PROMPT);
  expect(windows.noArquivo).toBe(longo);
  expect(tamanhoNaLinhaDoWindows([windows.chamada.arquivo, ...windows.chamada.argumentos])).toBeLessThan(30_000);
  // 40 mil caracteres cabem num argumento do Linux (até 100 KB): lá nada muda.
  const linux = await rodar('linux');
  expect(linux.chamada.argumentos.at(-1)).toBe(longo);
  expect(linux.noArquivo).toBeNull();
  // Prompt curto no Windows continua por argumento.
  const registro: Chamada[] = [];
  await executarCodex(
    { diretorioEntrada: entrada, prompt: 'Leia a parte.', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":true}' }, registro), plataforma: 'win32' },
  );
  expect(registro[0]!.argumentos.at(-1)).toBe('Leia a parte.');
});

test('tamanho da linha do Windows conta aspas e escapes que o Node acrescenta', () => {
  expect(tamanhoNaLinhaDoWindows(['codex', 'exec'])).toBe(11);
  expect(tamanhoNaLinhaDoWindows(['a b'])).toBe(6);
  expect(tamanhoNaLinhaDoWindows(['diz "oi"'])).toBe(13);
  expect(promptCabeNaLinha('x'.repeat(29_000), ['codex', 'x'.repeat(29_000)], 'win32')).toBe(true);
  expect(promptCabeNaLinha('x'.repeat(31_000), ['codex', 'x'.repeat(31_000)], 'win32')).toBe(false);
  expect(promptCabeNaLinha('x'.repeat(31_000), ['codex', 'x'.repeat(31_000)], 'linux')).toBe(true);
});

test('prazo estourado mata o processo e cancelamento devolve cancelado', async () => {
  const estourou = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'g', schema, prazoMs: 20, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ atrasoMs: 300 }, []) },
  );
  expect(estourou).toMatchObject({ estado: 'falhou', codigo: 'timeout' });
  const controlador = new AbortController();
  const promessa = executarCodex(
    { diretorioEntrada: entrada, prompt: 'h', schema, prazoMs: 5_000, sinal: controlador.signal, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ atrasoMs: 300 }, []) },
  );
  setTimeout(() => { controlador.abort(); }, 20);
  expect(await promessa).toMatchObject({ estado: 'falhou', codigo: 'cancelado' });
});

test('falha ao iniciar a CLI é classificada como processo', async () => {
  const resultado = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'i', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ erro: 'spawn codex ENOENT' }, []) },
  );
  expect(resultado).toMatchObject({ estado: 'falhou', codigo: 'processo' });
});

test('o registro da execução guarda medidas, nunca o prompt', async () => {
  const anotacoes: { estado: string; sha256_prompt: string; tamanho_prompt: number }[] = [];
  await executarCodex(
    { diretorioEntrada: entrada, prompt: 'segredo do prompt', schema, prazoMs: 5_000, diretorioArtefatos: artefatos },
    {
      capacidades: CAPACIDADES,
      gerar: spawnFalso({ saida: '{"ok":true}' }, []),
      registrar: (registro) => { anotacoes.push(registro); },
    },
  );
  const anotacao = anotacoes[0];
  expect(anotacao?.estado).toBe('ok');
  expect(JSON.stringify(anotacoes)).not.toContain('segredo do prompt');
  expect(anotacao?.sha256_prompt).toMatch(/^[0-9a-f]{64}$/);
  expect(anotacao?.tamanho_prompt).toBe('segredo do prompt'.length);
});

test('classificação de stderr e horário de volta', () => {
  expect(classificarSaida('you hit your usage limit', 1)).toBe('cota');
  expect(classificarSaida('401 Unauthorized', 1)).toBe('auth');
  expect(classificarSaida('boom', null)).toBe('processo');
  expect(classificarSaida('boom', 3)).toBe('desconhecido');
  const agora = new Date('2026-09-20T12:00:00Z');
  expect(horarioDeVolta('usage limit; retry in 30 minutes', agora).toISOString()).toBe('2026-09-20T12:30:00.000Z');
  expect(horarioDeVolta('usage limit', agora).toISOString()).toBe('2026-09-20T13:00:00.000Z');
  expect(modeloDaSaida('model: gpt-5.6-sol\n')).toBe('gpt-5.6-sol');
  expect(modeloDaSaida('nada aqui')).toBeNull();
});

test('proveniência: modelo e esforço efetivos vêm do stderr da CLI; sem anúncio, vale o pedido (J14)', async () => {
  expect(esforcoDaSaida('model: gpt-6-astra\nreasoning effort: medium\n')).toBe('medium');
  expect(esforcoDaSaida('nada aqui')).toBeNull();
  const anunciado = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'leia', schema, prazoMs: 5_000, diretorioArtefatos: artefatos, modelo: 'gpt-5.6-sol', esforco: 'high' },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":true}', stderr: 'model: gpt-6-astra\nreasoning effort: medium\n' }, []) },
  );
  expect(anunciado).toMatchObject({ estado: 'ok', modelo: 'gpt-6-astra', esforco: 'medium' });
  const calado = await executarCodex(
    { diretorioEntrada: entrada, prompt: 'leia', schema, prazoMs: 5_000, diretorioArtefatos: artefatos, esforco: 'high' },
    { capacidades: CAPACIDADES, gerar: spawnFalso({ saida: '{"ok":true}', stderr: '' }, []) },
  );
  expect(calado).toMatchObject({ estado: 'ok', esforco: 'high' });
});

test('o nome do arquivo de saída é estável', () => {
  expect(ARQUIVO_SAIDA).toBe('saida.json');
});

test('o schema que vai para a CLI perde `uniqueItems`, e a conferência usa o original', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-schema-'));
  try {
    const original = join(pasta, 'original.json');
    const destino = join(pasta, 'destino.json');
    await writeFile(original, JSON.stringify({
      type: 'object', additionalProperties: false, required: ['itens'],
      properties: { itens: { type: 'array', uniqueItems: true, items: { type: 'string' } } },
    }));
    await escreverSchemaDoCodex(original, destino);
    const enviado = JSON.parse(await readFile(destino, 'utf8')) as {
      properties: { itens: Record<string, unknown> };
    };
    expect('uniqueItems' in enviado.properties.itens).toBe(false);
    expect(enviado.properties.itens['items']).toEqual({ type: 'string' });

    // A régua da resposta continua sendo o arquivo original, com `uniqueItems`.
    const resposta = join(pasta, 'saida.json');
    await writeFile(resposta, JSON.stringify({ itens: ['a', 'a'] }));
    const conferencia = await conferirResposta(resposta, original);
    expect(conferencia.estado).toBe('schema');
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test('imagens anexadas vão com --image, antes do prompt (J34)', () => {
  const argumentos = montarArgumentos({ diretorio: '/d', schema: '/s', saida: '/o', prompt: 'p', imagens: ['/d/recorte.png'] });
  expect(argumentos.slice(-4)).toEqual(['--image', '/d/recorte.png', '--', 'p']);
});
