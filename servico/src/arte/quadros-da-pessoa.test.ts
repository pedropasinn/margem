/**
 * Quadros da pessoa (J118): envio da imagem (tipos, limite, assinatura), a fila do envio até a obra
 * pronta com executor falso e dossiê de fixture (sem rede), identificação proposta e corrigida, falha e
 * nova tentativa, narração com o provedor falso, remoção e a leitura do acervo antigo.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { validarQuadroDaPessoa, type QuadroDaPessoaV1 } from '@margem/contratos';
import { ANALISE, ANALISE_SO_PELA_IMAGEM, ARQUIVO_DA_EDUCACAO, IDENTIFICACAO_DO_TESTE_DE_14_10, identificacaoDoCodex, REDE_DA_EDUCACAO, redeDeFixture } from '../../testes/quadros.js';
import type { ModeloDaObraV1 } from '@margem/contratos';
import { conferirModeloDaObra } from '../../../core/src/arte.js';
import { comBanco } from '../../testes/apoio.js';
import { gravarChave, gravarPreferencias } from '../audio/configuracao.js';
import { provedorFalso } from '../audio/voz/falso.js';
import { criarExecutorFalso, type PassoRoteiro } from '../executor/fake.js';
import type { Executor } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker, type AnotacaoWorker } from '../worker/worker.js';
import { formatoPelaAssinatura, LIMITE_DA_IMAGEM_DO_QUADRO, normalizadorComFfmpeg, orientacaoExif } from './imagem-enviada.js';
import { manipuladoresDosQuadros, type ConfiguracaoDoPreparo } from './preparo.js';
import type { Buscar } from './v2/dossie-auto.js';
import { acharItemDaObra, mesmoArtista, semelhancaDeTitulo } from './v2/dossie-auto.js';

const ESCRITA = { 'X-Margem': '1' };
const temporarios: string[] = [];
let dados = '';

beforeEach(async () => {
  dados = await mkdtemp(join(tmpdir(), 'margem-quadros-')); temporarios.push(dados);
  process.env.MARGEM_DADOS = dados;
  delete process.env.MARGEM_ARTE_DIR;
  delete process.env.MARGEM_SEGREDOS;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  delete process.env.MARGEM_DADOS;
  for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true });
});

/** JPEG mínimo pela assinatura (o serviço não decodifica no envio; o worker normaliza). */
const jpeg = (semente: number, tamanho = 2048): Uint8Array => {
  const bytes = new Uint8Array(tamanho);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < tamanho; i += 1) bytes[i] = (i * 7 + semente) % 251;
  return bytes;
};
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3]);
const WEBP = new Uint8Array([...Buffer.from('RIFF'), 0x10, 0, 0, 0, ...Buffer.from('WEBPVP8 '), 1, 2, 3, 4]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...Buffer.from('ftypheic'), 0, 0, 0, 0, ...Buffer.from('mif1heic')]);

function formulario(bytes: Uint8Array | null, campos: Record<string, string> = {}, nome = 'foto.jpg', tipo = 'image/jpeg'): FormData {
  const f = new FormData();
  if (bytes) f.append('arquivo', new File([Buffer.from(bytes)], nome, { type: tipo }));
  for (const [k, v] of Object.entries(campos)) f.append(k, v);
  return f;
}

function cliente(banco: pg.Pool) {
  const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); }, recursos: new Set(['arte']) });
  const pedir = async (caminho: string, inicio: RequestInit = {}) => {
    const resposta = await api.request(caminho, inicio);
    const texto = resposta.headers.get('content-type')?.includes('json') ? await resposta.text() : '';
    return { status: resposta.status, corpo: (texto === '' ? null : JSON.parse(texto)) as Record<string, unknown>, resposta };
  };
  return {
    pedir,
    enviar: (f: FormData) => pedir('/api/arte', { method: 'POST', headers: ESCRITA, body: f }),
    lista: async () => (await pedir('/api/arte')).corpo as { obras: { slug: string; titulo: string; artista: string; removivel: boolean; exemplo: boolean; analises: { rotulo: string; audio: boolean }[] }[]; preparando: QuadroDaPessoaV1[] },
  };
}

/** Worker de um ciclo com a configuração do preparo (executor falso, rede de fixture, imagem falsa). */
async function rodarWorker(banco: pg.Pool, extra: Partial<ConfiguracaoDoPreparo> & { executor: Executor }): Promise<AnotacaoWorker[]> {
  const slots = await mkdtemp(join(tmpdir(), 'margem-quadros-slots-')); temporarios.push(slots);
  const anotacoes: AnotacaoWorker[] = [];
  const config: ConfiguracaoDoPreparo = {
    banco, buscar: redeDeFixture(),
    normalizar: async (origem, destino) => { await copyFile(origem, destino); return { largura: 1200, altura: 1400, convertida: false }; },
    preparar: async (_origem, destino) => { await writeFile(destino, 'jpg'); },
    ...extra,
  };
  await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDosQuadros(config), slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000, anotar: (a) => { anotacoes.push(a); } }).rodar();
  return anotacoes;
}

const passos = (...conteudos: unknown[]): PassoRoteiro[] => conteudos.map((conteudo, i) => ({ quando: { ordem: i + 1 }, tipo: 'ok', conteudo }));
const pasta = (slug: string) => join(dados, 'quadros', slug);

describe('assinatura e orientação da imagem', () => {
  test('JPEG, PNG e WebP pelo conteúdo; HEIC reconhecido para recusar; o resto, nada', () => {
    expect(formatoPelaAssinatura(jpeg(1))).toBe('jpeg');
    expect(formatoPelaAssinatura(PNG)).toBe('png');
    expect(formatoPelaAssinatura(WEBP)).toBe('webp');
    expect(formatoPelaAssinatura(HEIC)).toBe('heif');
    expect(formatoPelaAssinatura(new TextEncoder().encode('%PDF-1.7 não é imagem'))).toBeNull();
    expect(formatoPelaAssinatura(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
  test('orientação EXIF de um JPEG (big e little endian); sem EXIF, 1', () => {
    const exif = (le: boolean, valor: number): Uint8Array => {
      const tiff = Buffer.alloc(26);
      tiff.write(le ? 'II' : 'MM', 0, 'latin1');
      const u16 = (v: number, o: number) => (le ? tiff.writeUInt16LE(v, o) : tiff.writeUInt16BE(v, o));
      const u32 = (v: number, o: number) => (le ? tiff.writeUInt32LE(v, o) : tiff.writeUInt32BE(v, o));
      u16(42, 2); u32(8, 4); u16(1, 8); u16(0x0112, 10); u16(3, 12); u32(1, 14); u16(valor, 18);
      const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
      const tamanho = Buffer.alloc(2); tamanho.writeUInt16BE(app1.length + 2);
      return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), tamanho, app1, Buffer.from([0xff, 0xda, 0, 2])]);
    };
    expect(orientacaoExif(exif(false, 6))).toBe(6);
    expect(orientacaoExif(exif(true, 8))).toBe(8);
    expect(orientacaoExif(jpeg(3))).toBe(1);
  });
  test('procura no Wikidata: artista pelo sobrenome, título pelas palavras; cópia de outro artista fica de fora', async () => {
    expect(mesmoArtista('Vermeer', 'Johannes Vermeer')).toBe(true);
    expect(mesmoArtista('johannes vermeer', 'Jan Vermeer')).toBe(true);
    expect(mesmoArtista('Johannes Vermeer', 'Han van Meegeren')).toBe(false);
    expect(semelhancaDeTitulo('A leiteira', 'A Leiteira')).toBe(1);
    expect(semelhancaDeTitulo('A Leiteira', 'Moça com brinco de pérola')).toBe(0);
    expect(await acharItemDaObra({ titulo: 'A leiteira', artista: 'Vermeer' }, redeDeFixture())).toBe('Q100');
    expect(await acharItemDaObra({ titulo: 'A Leiteira', artista: 'Rembrandt' }, redeDeFixture())).toBeNull();
  });
});

test('envio: tipos aceitos e recusados, limite, assinatura, campos e imagem repetida', async () => comBanco('quadros_envio', async (banco) => {
  const { pedir, enviar, lista } = cliente(banco);
  expect((await enviar(formulario(null, { titulo: 'Sem imagem' }))).corpo).toMatchObject({ erro: 'sem_imagem' });
  // O nome e o tipo declarados não valem: um PDF chamado .jpg é recusado; um PNG declarado JPEG passa.
  expect(await enviar(formulario(new TextEncoder().encode('%PDF-1.7'), {}, 'quadro.jpg'))).toMatchObject({ status: 415, corpo: { erro: 'imagem_invalida' } });
  const heic = await enviar(formulario(HEIC, {}, 'IMG_0001.HEIC', 'image/heic'));
  expect(heic).toMatchObject({ status: 415, corpo: { erro: 'heic_nao_suportado' } });
  expect(String(heic.corpo.detalhe)).toContain('JPEG');
  const grande = new Uint8Array(LIMITE_DA_IMAGEM_DO_QUADRO + 1); grande.set([0xff, 0xd8, 0xff]);
  expect(await enviar(formulario(grande))).toMatchObject({ status: 413, corpo: { erro: 'imagem_grande_demais' } });
  expect(await enviar(formulario(jpeg(1), { titulo: 'duas\nlinhas' }))).toMatchObject({ status: 400, corpo: { erro: 'campo_invalido' } });
  // Escrita sem o cabeçalho do app é recusada antes de tudo.
  expect((await pedir('/api/arte', { method: 'POST', body: formulario(jpeg(1)) })).status).toBe(403);

  const png = await enviar(formulario(PNG, {}, 'scan.png', 'image/jpeg'));
  expect(png.status).toBe(202);
  expect(validarQuadroDaPessoa(png.corpo)).toBe(true);
  expect(png.corpo).toMatchObject({ estado: 'na_fila', etapa: null, identificacao: null, imagem: { formato: 'png', bytes: PNG.length, nome: 'scan.png' } });
  const webp = await enviar(formulario(WEBP, { titulo: '  A Leiteira ', artista: 'Johannes Vermeer', ano: '1658' }, 'leiteira.webp', 'image/webp'));
  expect(webp.corpo).toMatchObject({ slug: expect.stringMatching(/^a-leiteira-[a-z0-9]{6}$/u) as unknown, imagem: { formato: 'webp' }, identificacao: { titulo: 'A Leiteira', artista: 'Johannes Vermeer', ano: '1658', origem: 'pessoa' } });
  const slug = String(webp.corpo.slug);
  expect(await readFile(join(pasta(slug), 'original.webp'))).toEqual(Buffer.from(WEBP));
  expect(await enviar(formulario(WEBP, {}, 'outra.webp'))).toMatchObject({ status: 409, corpo: { erro: 'quadro_duplicado', slug } });

  const { preparando, obras } = await lista();
  expect(preparando.map((q) => q.slug).sort()).toEqual([String(png.corpo.slug), slug].sort());
  expect(obras.every((o) => o.exemplo)).toBe(true); // só as duas de exemplo do repositório
  // Enquanto prepara, a capa é o próprio original.
  const capa = await pedir(`/api/arte/${slug}/miniatura`);
  expect(capa.status).toBe(200);
  expect(capa.resposta.headers.get('content-type')).toBe('image/webp');
  expect((await pedir(`/api/arte/${slug}`)).status).toBe(404);
}));

test('da imagem à obra pronta: o Codex identifica, o dossiê vem da fixture, a análise publica; corrigir refaz', async () => comBanco('quadros_fila', async (banco) => {
  const { pedir, enviar, lista } = cliente(banco);
  const enviado = await enviar(formulario(jpeg(7), {}, 'museu.jpg'));
  const slug = String(enviado.corpo.slug);
  expect(slug).toMatch(/^obra-[a-z0-9]{6}$/u);

  const urls: string[] = [];
  const executor = criarExecutorFalso({ versao: 1, passos: passos(identificacaoDoCodex(), ...ANALISE) });
  const anotacoes = await rodarWorker(banco, { executor, buscar: redeDeFixture(urls) });
  expect(anotacoes.map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(executor.chamadas).toBe(5);
  expect(urls.every((u) => u.startsWith('https://'))).toBe(true);

  const { preparando, obras } = await lista();
  expect(preparando).toEqual([]);
  const obra = obras.find((o) => o.slug === slug)!;
  expect(obra).toMatchObject({ titulo: 'A Leiteira', artista: 'Johannes Vermeer', removivel: true, exemplo: false });
  expect(obra.analises[0]!.audio).toBe(false); // sem chave de voz, sem narração
  const detalhe = (await pedir(`/api/arte/${slug}`)).corpo as { analise: { modelo: { fontes: { url: string }[]; imagem: { credito: string } }; curta: { batidas: unknown[] } } };
  expect(detalhe.analise.modelo.fontes.map((f) => f.url)).toEqual(['https://www.wikidata.org/wiki/Q100', 'https://pt.wikipedia.org/wiki/A_Leiteira']);
  expect(detalhe.analise.modelo.imagem.credito).toBe('Imagem enviada por você');
  expect(detalhe.analise.curta.batidas).toHaveLength(6);
  expect(JSON.parse(await readFile(join(pasta(slug), 'identificacao.json'), 'utf8'))).toMatchObject({ reconhecida: true, titulo: 'A Leiteira', confianca: 'alta' });
  expect(JSON.parse(await readFile(join(pasta(slug), 'publicado.json'), 'utf8'))).toEqual({ analise: `geracoes/${obra.analises[0]!.rotulo}` });
  expect((await pedir(`/api/arte/${slug}/miniatura`)).status).toBe(200);

  // A pessoa corrige a identificação: dossiê refeito numa geração nova, sem chamar a identificação.
  const corrigida = await pedir(`/api/arte/${slug}/identificacao`, { method: 'PUT', headers: { ...ESCRITA, 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'Het melkmeisje', artista: 'Vermeer', ano: '1658' }) });
  expect(corrigida).toMatchObject({ status: 202, corpo: { estado: 'na_fila', identificacao: { titulo: 'Het melkmeisje', artista: 'Vermeer', origem: 'pessoa' } } });
  expect(existsSync(join(pasta(slug), 'dossie-auto.json'))).toBe(false);
  // Enquanto refaz, a obra aparece só como "preparando".
  expect((await lista()).obras.some((o) => o.slug === slug)).toBe(false);
  const segunda = criarExecutorFalso({ versao: 1, passos: passos(...ANALISE) });
  expect((await rodarWorker(banco, { executor: segunda })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(segunda.chamadas).toBe(4);
  const depois = (await lista()).obras.find((o) => o.slug === slug)!;
  expect(depois.analises).toHaveLength(2);
  expect((await pedir('/api/arte/x/identificacao', { method: 'PUT', headers: { ...ESCRITA, 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'A' }) })).status).toBe(400);
}));

test('falhas visíveis e nova tentativa: obra não reconhecida, rede fora do ar, cota; retoma o que já fez', async () => comBanco('quadros_falhas', async (banco) => {
  const { pedir, enviar, lista } = cliente(banco);
  const slug = String((await enviar(formulario(jpeg(11)))).corpo.slug);

  // 1. O Codex não reconhece: a obra segue só pela imagem (V-W5), com o palpite à vista; a cota acaba na
  // primeira chamada da análise e a obra espera na fila.
  const naoReconhece = criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: identificacaoDoCodex(false) }, { quando: { ordem: 2 }, tipo: 'cota', not_before: '2026-10-14T10:00:00Z' }] });
  expect((await rodarWorker(banco, { executor: naoReconhece })).map((a) => a.evento)).toEqual(['reservado', 'adiado']);
  let quadro = (await lista()).preparando.find((q) => q.slug === slug)!;
  expect(validarQuadroDaPessoa(quadro)).toBe(true);
  expect(quadro).toMatchObject({ estado: 'na_fila', identificacao: null, palpite: { texto: 'Pintura de interior sem traço que a identifique.', titulo: null, confianca: 'baixa' } });

  // 2. A pessoa informa título e artista; a rede cai no dossiê: falha clara, sem análise.
  await pedir(`/api/arte/${slug}/identificacao`, { method: 'PUT', headers: { ...ESCRITA, 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'A Leiteira', artista: 'Johannes Vermeer' }) });
  const semRede: Buscar = () => Promise.reject(new Error('getaddrinfo ENOTFOUND'));
  const nunca = criarExecutorFalso({ versao: 1, passos: [] });
  await rodarWorker(banco, { executor: nunca, buscar: semRede });
  expect(nunca.chamadas).toBe(0);
  quadro = (await lista()).preparando.find((q) => q.slug === slug)!;
  expect(quadro).toMatchObject({ estado: 'falhou', etapa: 'dossie', erro: { codigo: 'indisponivel' } });

  // 3. Tentar de novo: a cota acaba na segunda chamada da análise; fica na fila com aviso.
  expect((await pedir(`/api/arte/${slug}/tentar-de-novo`, { method: 'POST', headers: ESCRITA })).corpo).toMatchObject({ estado: 'na_fila' });
  expect((await pedir(`/api/arte/${slug}/tentar-de-novo`, { method: 'POST', headers: ESCRITA })).status).toBe(409);
  const cota = criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: ANALISE[0] }, { quando: { ordem: 2 }, tipo: 'cota', not_before: '2026-10-14T10:00:00Z' }] });
  expect((await rodarWorker(banco, { executor: cota })).map((a) => a.evento)).toEqual(['reservado', 'adiado']);
  quadro = (await lista()).preparando.find((q) => q.slug === slug)!;
  expect(quadro).toMatchObject({ estado: 'na_fila' });
  expect(quadro.aviso).toContain('Cota do Codex');

  // 4. Volta da cota: só as três chamadas que faltavam.
  await banco.query("UPDATE job SET not_before = now() - interval '1 second' WHERE estado = 'adiado'");
  const resto = criarExecutorFalso({ versao: 1, passos: passos(...ANALISE.slice(1)) });
  expect((await rodarWorker(banco, { executor: resto })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(resto.chamadas).toBe(3);
  expect((await lista()).obras.find((o) => o.slug === slug)).toMatchObject({ titulo: 'A Leiteira', removivel: true });
  expect((await pedir(`/api/arte/${slug}/tentar-de-novo`, { method: 'POST', headers: ESCRITA })).status).toBe(409);
}));

test('narração com a voz da pessoa: o áudio fica ao lado da análise; sem chave, nenhuma narração', async () => comBanco('quadros_voz', async (banco) => {
  const { enviar, lista, pedir } = cliente(banco);
  const slug = String((await enviar(formulario(jpeg(21), { titulo: 'A Leiteira', artista: 'Johannes Vermeer' }))).corpo.slug);
  await gravarChave('sk_0123456789abcdef0123456789abcdefQUADRO1');
  await gravarPreferencias({ voz_id: 'vozfalsa0000000000001', voz_nome: 'Clara', modelo_id: 'eleven_flash_v2_5' });
  const registro: string[] = [];
  const executor = criarExecutorFalso({ versao: 1, passos: passos(...ANALISE) });
  expect((await rodarWorker(banco, { executor, criarProvedor: () => provedorFalso({ registro }) })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  const obra = (await lista()).obras.find((o) => o.slug === slug)!;
  expect(obra.analises[0]!.audio).toBe(true);
  const manifesto = (await pedir(`/api/arte/${slug}/audio/${obra.analises[0]!.rotulo}/manifesto.json`)).corpo as { batidas: { inicio_s: number; palavras: unknown[] }[]; voz: { perfil: string } };
  expect(manifesto.batidas).toHaveLength(6);
  expect(manifesto.voz.perfil).toBe('Clara');
  expect(manifesto.batidas.every((b) => b.palavras.length > 0)).toBe(true);
  expect(registro.join(' ')).toContain('Uma mulher despeja leite');
}));

test('remover: a obra da pessoa sai (pasta e linha), mesmo em preparo; as de exemplo e o acervo antigo não', async () => comBanco('quadros_remover', async (banco) => {
  const { pedir, enviar, lista } = cliente(banco);
  // Acervo antigo em <dados>/arte/obras: continua lido, mas não se remove pelo app.
  const antiga = join(dados, 'arte/obras/educacao-antiga');
  await mkdir(antiga, { recursive: true });
  const raizDoRepo = new URL('../../../', import.meta.url);
  const imagem = await readFile(new URL('web/public/arte/educacao.jpg', raizDoRepo));
  await writeFile(join(antiga, 'imagem.jpg'), imagem);
  await copyFile(new URL('fixtures/arte/educacao.modelo.json', raizDoRepo), join(antiga, 'esperado.modelo.json'));
  await copyFile(new URL('fixtures/arte/educacao.curta.json', raizDoRepo), join(antiga, 'esperado.curta.json'));
  expect(createHash('sha256').update(imagem).digest('hex')).toMatch(/^[a-f0-9]{64}$/u);

  const pronta = String((await enviar(formulario(jpeg(31), { titulo: 'A Leiteira', artista: 'Johannes Vermeer' }))).corpo.slug);
  await rodarWorker(banco, { executor: criarExecutorFalso({ versao: 1, passos: passos(...ANALISE) }) });
  const naFila = String((await enviar(formulario(jpeg(32)))).corpo.slug);
  const antes = await lista();
  expect(antes.obras.find((o) => o.slug === 'educacao-antiga')).toMatchObject({ removivel: false, exemplo: false });
  expect(antes.obras.find((o) => o.slug === pronta)).toMatchObject({ removivel: true });

  expect((await pedir(`/api/arte/${pronta}`, { method: 'DELETE', headers: ESCRITA })).status).toBe(204);
  expect(existsSync(pasta(pronta))).toBe(false);
  expect((await pedir(`/api/arte/${naFila}`, { method: 'DELETE', headers: ESCRITA })).status).toBe(204);
  expect((await banco.query("SELECT estado FROM job WHERE tipo='preparar_quadro' ORDER BY criado_em DESC LIMIT 1")).rows[0]).toEqual({ estado: 'cancelado' });
  // O worker não acha nada para preparar (o job cancelado não é reservado).
  expect(await rodarWorker(banco, { executor: criarExecutorFalso({ versao: 1, passos: [] }) })).toEqual([]);
  expect((await pedir('/api/arte/educacao-antiga', { method: 'DELETE', headers: ESCRITA })).corpo).toMatchObject({ erro: 'obra_do_acervo' });
  expect((await pedir('/api/arte/educacao', { method: 'DELETE', headers: ESCRITA })).corpo).toMatchObject({ erro: 'obra_do_acervo' });
  expect((await pedir('/api/arte/nao-existe', { method: 'DELETE', headers: ESCRITA })).status).toBe(404);
  const depois = await lista();
  expect(depois.obras.map((o) => o.slug)).not.toContain(pronta);
  expect(depois.preparando).toEqual([]);
  expect(depois.obras.map((o) => o.slug)).toContain('educacao-antiga');
}));

test('não reconhecida (V-W5): "Educação Obrigatória" vira análise só pela imagem, sem fato; informar título e artista refaz com fontes', async () => comBanco('quadros_so_imagem', async (banco) => {
  const { pedir, enviar, lista } = cliente(banco);
  const slug = String((await enviar(formulario(jpeg(41), {}, 'Educação obrigatória.jpg'))).corpo.slug);
  const prompts: string[] = [];
  const falso = criarExecutorFalso({ versao: 1, passos: passos(IDENTIFICACAO_DO_TESTE_DE_14_10, ...ANALISE_SO_PELA_IMAGEM) });
  const executor: Executor = (pedido) => { prompts.push(pedido.prompt); return falso(pedido); };
  const urls: string[] = [];
  expect((await rodarWorker(banco, { executor, buscar: redeDeFixture(urls) })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(falso.chamadas).toBe(5);
  expect(urls).toEqual([]); // sem identificação, nenhuma consulta ao Wikidata
  // A identificação vai sem as regras; o modelo, a revisão e o roteiro, com elas.
  expect(prompts.map((p) => p.includes('Obra não identificada: só pela imagem'))).toEqual([false, false, true, true, true]);

  const obra = (await lista()).obras.find((o) => o.slug === slug)!;
  const rotulo = obra.analises[0]!.rotulo;
  expect(obra).toMatchObject({ titulo: 'Obra não identificada', artista: 'Artista não identificado', removivel: true, nao_identificada: true,
    palpite: { texto: IDENTIFICACAO_DO_TESTE_DE_14_10.justificativa, titulo: null, artista: null, ano: null, confianca: 'baixa' } });
  const detalhe = (await pedir(`/api/arte/${slug}`)).corpo as { nao_identificada: boolean; palpite: { texto: string }; analise: { modelo: ModeloDaObraV1 } };
  const modelo = detalhe.analise.modelo;
  expect(detalhe.nao_identificada).toBe(true);
  expect(detalhe.palpite.texto).toContain('cenas sentimentais britânicas');
  expect(modelo.afirmacoes.filter((a) => a.tipo === 'fato')).toEqual([]);
  expect(new Set(modelo.afirmacoes.map((a) => a.tipo))).toEqual(new Set(['observacao', 'inferencia_ia']));
  expect(conferirModeloDaObra(modelo)).toEqual([]);
  expect(modelo.identidade).toMatchObject({ titulo: 'Obra não identificada', afirmacoes: [] });
  expect(modelo.fontes).toEqual([expect.objectContaining({ categoria: 'imagem_enviada', url: `margem:quadros/${slug}/imagem.jpg` })]);
  expect(modelo.limites[0]).toContain('só pela imagem');
  const registro = JSON.parse(await readFile(join(pasta(slug), 'geracoes', rotulo, 'registro.json'), 'utf8')) as { dossie: string; diagnosticos: { cortes: { motivo: string }[] } };
  expect(registro.dossie).toBe('imagem');
  expect(registro.diagnosticos.cortes.map((c) => c.motivo)).toEqual(expect.arrayContaining(['so_pela_imagem']));
  // O palpite entrou no dossiê como apoio (nunca como fonte).
  const dados = JSON.parse(await readFile(join(pasta(slug), 'geracoes', rotulo, 'brutos', 'modelo.dados.json'), 'utf8')) as { dossie: { apoio: { texto: string }[]; fontes: unknown[] } };
  expect(dados.dossie.apoio[0]!.texto).toContain('cenas sentimentais britânicas');

  // A pessoa informa título e artista depois: a obra é preparada de novo, agora com o dossiê.
  const informada = await pedir(`/api/arte/${slug}/identificacao`, { method: 'PUT', headers: { ...ESCRITA, 'Content-Type': 'application/json' }, body: JSON.stringify({ titulo: 'A Leiteira', artista: 'Johannes Vermeer' }) });
  expect(informada).toMatchObject({ status: 202, corpo: { estado: 'na_fila', identificacao: { origem: 'pessoa' } } });
  expect(informada.corpo).not.toHaveProperty('palpite');
  const segunda = criarExecutorFalso({ versao: 1, passos: passos(...ANALISE) });
  expect((await rodarWorker(banco, { executor: segunda })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(segunda.chamadas).toBe(4);
  const depois = (await lista()).obras.find((o) => o.slug === slug)!;
  expect(depois).toMatchObject({ titulo: 'A Leiteira', artista: 'Johannes Vermeer' });
  expect(depois).not.toHaveProperty('nao_identificada');
  expect(depois.analises).toHaveLength(2);
}));

test('proposta do Codex que o Wikidata não conhece também segue só pela imagem, com o nome como palpite', async () => comBanco('quadros_palpite', async (banco) => {
  const { enviar, lista } = cliente(banco);
  const slug = String((await enviar(formulario(jpeg(43)))).corpo.slug);
  const rendeira = { titulo: 'A Rendeira', titulo_original: 'De kantwerkster', artista: 'Johannes Vermeer', ano: null, confianca: 'media', pistas: 'Moça debruçada sobre o bilro.' };
  const proposta = { ...identificacaoDoCodex(), titulo: 'A Rendeira', titulo_original: 'De kantwerkster', confianca: 'media', candidatos: [rendeira] };
  const executor = criarExecutorFalso({ versao: 1, passos: passos(proposta, ...ANALISE_SO_PELA_IMAGEM) });
  expect((await rodarWorker(banco, { executor })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  const obra = (await lista()).obras.find((o) => o.slug === slug)!;
  expect(obra).toMatchObject({ titulo: 'Obra não identificada', nao_identificada: true, palpite: { titulo: 'A Rendeira', artista: 'Johannes Vermeer', confianca: 'media' } });
}));

test('a imagem de uma obra de exemplo é reconhecida pelo SHA-256, sem chamar o Codex; o dossiê vem do Commons (o Wikidata não tem a obra)', async () => comBanco('quadros_acervo', async (banco) => {
  const { enviar, lista, pedir } = cliente(banco);
  const bytes = await readFile(new URL('../../../web/public/arte/educacao.jpg', import.meta.url));
  const slug = String((await enviar(formulario(new Uint8Array(bytes), {}, 'educacao.jpg'))).corpo.slug);
  const urls: string[] = [];
  const executor = criarExecutorFalso({ versao: 1, passos: passos(...ANALISE) });
  expect((await rodarWorker(banco, { executor, buscar: redeDeFixture(urls, REDE_DA_EDUCACAO) })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(executor.chamadas).toBe(4); // só a análise
  expect(JSON.parse(await readFile(join(pasta(slug), 'identificacao.json'), 'utf8'))).toMatchObject({
    reconhecida: true, titulo: 'Educação Obrigatória', artista: 'Briton Rivière', ano: '1887', modelo: 'acervo',
    confirmacao: { metodo: 'acervo', arquivo_commons: ARQUIVO_DA_EDUCACAO, distancia: 0 },
  });
  // Nada de Wikidata pelo título: o dossiê parte do arquivo do Commons da obra de exemplo.
  expect(urls.some((u) => u.includes('www.wikidata.org'))).toBe(false);
  expect((await lista()).obras.find((o) => o.slug === slug)).toMatchObject({ titulo: 'Educação Obrigatória', artista: 'Briton Rivière' });
  const detalhe = (await pedir(`/api/arte/${slug}`)).corpo as { nao_identificada?: boolean; analise: { modelo: ModeloDaObraV1 } };
  expect(detalhe.nao_identificada).toBeUndefined();
  expect(detalhe.analise.modelo.fontes.map((f) => f.url)).toEqual([
    'https://commons.wikimedia.org/wiki/File:Briton_Rivi%C3%A8re_Compulsory_Education.jpg', 'https://en.wikipedia.org/wiki/Briton_Rivi%C3%A8re',
  ]);
}));

const comFfmpeg = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' }).stdout?.includes('libwebp') === true;
const ffmpegOk = (...argumentos: string[]) => expect(spawnSync('ffmpeg', ['-v', 'error', '-y', ...argumentos]).status).toBe(0);

test.skipIf(!comFfmpeg)('V-T2: "Educação Obrigatória" em WebP, reduzida e recortada (o envio do teste de 14/10) é a obra de exemplo pelo pHash, sem Codex', async () => comBanco('quadros_phash', async (banco) => {
  const { enviar, lista } = cliente(banco);
  const webp = await readFile(new URL('../../../fixtures/arte/variacoes/educacao-enviada.webp', import.meta.url));
  const slug = String((await enviar(formulario(new Uint8Array(webp), {}, 'Educação obrigatória.webp', 'image/webp'))).corpo.slug);
  const executor = criarExecutorFalso({ versao: 1, passos: passos(...ANALISE) });
  // A imagem passa pelo ffmpeg de verdade (WebP → JPEG), como no app de computador.
  const anotacoes = await rodarWorker(banco, { executor, buscar: redeDeFixture([], REDE_DA_EDUCACAO), normalizar: normalizadorComFfmpeg() });
  expect(anotacoes.map((a) => a.evento)).toEqual(['reservado', 'publicado']);
  expect(executor.chamadas).toBe(4); // nenhuma chamada para identificar
  const proposta = JSON.parse(await readFile(join(pasta(slug), 'identificacao.json'), 'utf8')) as { confirmacao: { distancia: number } };
  expect(proposta).toMatchObject({ reconhecida: true, titulo: 'Educação Obrigatória', modelo: 'acervo', confirmacao: { metodo: 'acervo', arquivo_commons: ARQUIVO_DA_EDUCACAO } });
  expect(proposta.confirmacao.distancia).toBeGreaterThan(0);
  expect(proposta.confirmacao.distancia).toBeLessThanOrEqual(10);
  expect((await lista()).obras.find((o) => o.slug === slug)).toMatchObject({ titulo: 'Educação Obrigatória', artista: 'Briton Rivière' });
}));

test.skipIf(!comFfmpeg)('V-T2: candidatos do Codex conferidos no Commons pela imagem: o errado cai (o Codex compara e nega), o certo confirma pelo pHash', async () => comBanco('quadros_candidatos', async (banco) => {
  const { enviar, lista } = cliente(banco);
  // Uma "pintura" que não está no acervo de exemplo, e a reprodução dela no Commons: recortada, menor, em JPEG.
  const tmp = await mkdtemp(join(tmpdir(), 'margem-vt2-')); temporarios.push(tmp);
  ffmpegOk('-f', 'lavfi', '-i', 'mandelbrot=size=640x800', '-frames:v', '1', join(tmp, 'obra.png'));
  ffmpegOk('-i', join(tmp, 'obra.png'), '-vf', 'crop=iw*0.9:ih*0.9:iw*0.04:ih*0.06,scale=480:-2', '-q:v', '6', join(tmp, 'commons-certa.jpg'));
  ffmpegOk('-f', 'lavfi', '-i', 'testsrc2=size=640x800', '-frames:v', '1', join(tmp, 'commons-errada.jpg'));
  const slug = String((await enviar(formulario(new Uint8Array(await readFile(join(tmp, 'obra.png'))), {}, 'fractal.png', 'image/png'))).corpo.slug);

  const errada = { titulo: 'Composição em Barras', titulo_original: 'Bars Composition', artista: 'Fulano de Tal', ano: '1950', confianca: 'baixa', pistas: 'Cores fortes em faixas.' };
  const certa = { titulo: 'Fractal Azul', titulo_original: 'Blue Fractal', artista: 'Benoit Mandelbrot', ano: '1980', confianca: 'baixa', pistas: 'O contorno do conjunto.' };
  const resposta = { reconhecida: false, titulo: errada.titulo, titulo_original: errada.titulo_original, artista: errada.artista, ano: errada.ano, confianca: 'baixa', justificativa: 'Imagem abstrata; dois palpites.', candidatos: [errada, certa] };
  const pedidos: { prompt: string; imagens: string[]; busca: boolean }[] = [];
  const falso = criarExecutorFalso({ versao: 1, passos: passos(resposta, { mesma_obra: false, confianca: 'alta', justificativa: 'Composições diferentes.' }, ...ANALISE_SO_PELA_IMAGEM) });
  const executor: Executor = (pedido) => { pedidos.push({ prompt: pedido.prompt, imagens: pedido.imagens ?? [], busca: pedido.buscaNaWeb === true }); return falso(pedido); };
  const arquivo = (titulo: string, miniatura: string) => ({ pageid: 1, title: titulo, imageinfo: [{ thumburl: miniatura, extmetadata: { Artist: { value: titulo.includes('Bars') ? 'Fulano de Tal' : 'Benoit Mandelbrot' }, ObjectName: { value: titulo.includes('Bars') ? 'Bars Composition' : 'Blue Fractal' } } }] });
  const urls: string[] = [];
  const buscar: Buscar = (url) => {
    urls.push(url);
    if (url.includes('www.wikidata.org')) return Promise.resolve({ query: { search: [] }, search: [], entities: {} });
    const bars = decodeURIComponent(url).includes('Bars');
    if (url.includes('list=search&srnamespace=6')) return Promise.resolve({ query: { search: [{ title: bars ? 'File:Bars Composition.jpg' : 'File:Blue Fractal.jpg' }] } });
    if (url.includes('iiprop=url|extmetadata')) return Promise.resolve({ query: { pages: [bars ? arquivo('File:Bars Composition.jpg', 'https://upload.wikimedia.org/errada.jpg') : arquivo('File:Blue Fractal.jpg', 'https://upload.wikimedia.org/certa.jpg')] } });
    if (url.includes('iiprop=extmetadata')) return Promise.resolve({ query: { pages: [{ pageid: 7, imageinfo: [{ extmetadata: { ObjectName: { value: 'Blue Fractal' }, Artist: { value: 'Benoit Mandelbrot' }, DateTimeOriginal: { value: '1980' } } }] }] } });
    if (url.includes('ids=M7')) return Promise.resolve({ entities: { M7: { statements: {} } } });
    return Promise.reject(new Error(`sem fixture: ${url}`));
  };
  const baixar = async (url: string) => new Uint8Array(await readFile(join(tmp, url.endsWith('certa.jpg') ? 'commons-certa.jpg' : 'commons-errada.jpg')));
  expect((await rodarWorker(banco, { executor, buscar, baixar, normalizar: normalizadorComFfmpeg() })).map((a) => a.evento)).toEqual(['reservado', 'publicado']);

  // 1 identificação (com a busca na web e a imagem), 1 comparação (as duas imagens), 4 da análise.
  expect(pedidos.map((p) => [p.imagens, p.busca])).toEqual([[['obra.jpg'], true], [['enviada.jpg', 'referencia.jpg'], false], ...Array.from({ length: 4 }, (): unknown[] => [expect.any(Array) as unknown, false])]);
  expect(pedidos[0]!.prompt).toContain('"nome_do_arquivo":"fractal.png"');
  const proposta = JSON.parse(await readFile(join(pasta(slug), 'identificacao.json'), 'utf8')) as Record<string, unknown> & { tentativas: { resultado: string; comparacao: boolean | null; distancia: number }[] };
  expect(proposta).toMatchObject({ reconhecida: true, reconhecida_pelo_modelo: false, titulo: 'Fractal Azul', artista: 'Benoit Mandelbrot', confianca: 'alta',
    confirmacao: { metodo: 'imagem', qid: null, arquivo_commons: 'File:Blue Fractal.jpg' } });
  expect(proposta.tentativas.map((t) => [t.resultado, t.comparacao])).toEqual([['imagem_diferente', false], ['confirmado', null]]);
  expect(proposta.tentativas[1]!.distancia).toBeLessThanOrEqual(10);
  expect((await lista()).obras.find((o) => o.slug === slug)).toMatchObject({ titulo: 'Fractal Azul', artista: 'Benoit Mandelbrot' });
  expect(urls.some((u) => u.includes('prop=imageinfo&iiprop=extmetadata&titles=File%3ABlue%20Fractal.jpg'))).toBe(true);
}));
