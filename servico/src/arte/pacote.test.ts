/**
 * Pacote do acervo de quadros (J110): empacotador com obras de fixture (nunca o acervo real),
 * instalador (manifesto, hash, caminhos, idempotência, conflito) e o estado vazio da API.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModeloDaObraV1 } from '@margem/contratos';
import { lerAcervo } from './acervo';
import { conferirLicenca, conferirManifestoDoPacote, empacotarAcervo, instalarPacote, type ManifestoDoPacote } from './pacote';
import { pacoteParaBaixar } from './pacote-publicado';
import { escreverTarGz, lerTarGz, type EntradaParaEscrever } from './tar';
import { estadoDoAcervo, registrarRotasDeArte } from '../http/rotas-arte';
import { recursosEfetivos } from '../http/app';

const doRepo = (relativo: string): string => fileURLToPath(new URL(`../../../${relativo}`, import.meta.url));
const modeloDe = async (nome: string): Promise<ModeloDaObraV1> => JSON.parse(await readFile(doRepo(`fixtures/arte/${nome}.modelo.json`), 'utf8')) as ModeloDaObraV1;
const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');

let base = '';
let origem = '';
let pacote = '';
let manifesto: ManifestoDoPacote;

async function obra(slug: string, nome: 'educacao' | 'tolo', imagemJson: Record<string, unknown> | null, extras: { geracao?: boolean; audio?: boolean; lixo?: boolean } = {}): Promise<void> {
  const pasta = join(origem, slug);
  await mkdir(pasta, { recursive: true });
  await copyFile(doRepo(`web/public/arte/${nome}.jpg`), join(pasta, 'imagem.jpg'));
  if (imagemJson) await writeFile(join(pasta, 'imagem.json'), JSON.stringify(imagemJson));
  await copyFile(doRepo(`fixtures/arte/${nome}.modelo.json`), join(pasta, 'esperado.modelo.json'));
  await copyFile(doRepo(`fixtures/arte/${nome}.curta.json`), join(pasta, 'esperado.curta.json'));
  if (extras.geracao) {
    const g = join(pasta, 'geracoes', 'v2-teste');
    await mkdir(join(g, 'brutos'), { recursive: true });
    await mkdir(join(g, 'imagens'), { recursive: true });
    await copyFile(doRepo(`fixtures/arte/${nome}.modelo.json`), join(g, 'modelo.json'));
    await copyFile(doRepo(`fixtures/arte/${nome}.curta.json`), join(g, 'curta.json'));
    await writeFile(join(g, 'brutos', 'leitura.json'), '{"bruto":true}');
    await writeFile(join(g, 'imagens', 'visao.jpg'), 'x');
    await writeFile(join(g, 'avaliacao.md'), '# avaliação');
    await writeFile(join(pasta, 'publicado.json'), JSON.stringify({ analise: 'geracoes/v2-teste' }));
  }
  if (extras.audio) {
    const bytes = await readFile(join(pasta, 'esperado.curta.json'));
    const curta = JSON.parse(bytes.toString('utf8')) as { batidas: { narracao: string }[] };
    let t = 0;
    const batidas = curta.batidas.map((b, indice) => { const inicio_s = t; t += 2; return { indice, inicio_s, fim_s: t, texto: b.narracao, palavras: [{ texto: 'a', inicio_s, fim_s: inicio_s + 0.5 }] }; });
    await mkdir(join(pasta, 'audio', 'esperado'), { recursive: true });
    await writeFile(join(pasta, 'audio', 'esperado', 'manifesto.json'), JSON.stringify({ versao: 1, analise: 'esperado', curta_sha256: sha(bytes), voz: { perfil: 'p', modelo: 'm', seed: 1 }, arquivo: 'narracao.mp3', duracao_s: t, batidas }));
    await writeFile(join(pasta, 'audio', 'esperado', 'narracao.mp3'), Buffer.alloc(2000, 3));
    await writeFile(join(pasta, 'audio', 'esperado', 'narracao.wav'), Buffer.alloc(4000, 3));
  }
  if (extras.lixo) {
    await mkdir(join(pasta, 'fontes'), { recursive: true });
    await writeFile(join(pasta, 'fontes', 'auto-wp-en.txt'), 'texto da Wikipédia');
    await writeFile(join(pasta, 'dossie-auto.json'), '{}');
    await mkdir(join(pasta, '.cache'), { recursive: true });
    await writeFile(join(pasta, '.cache', 'miniatura-640.jpg'), 'x');
  }
}

const dominioPublico = (extra: Record<string, unknown> = {}) => ({ origem_url: 'https://commons.wikimedia.org/wiki/File:x.jpg', licenca: 'Domínio público (Wikimedia Commons: "Public domain")', licenca_commons: 'Public domain', credito: 'Quadro — Artista. Via Wikimedia Commons.', baixado_em: '2026-10-01', ...extra });

beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'pacote-arte-'));
  origem = join(base, 'origem');
  await obra('quadro-a', 'educacao', dominioPublico({ credito: 'Google Arts &amp; Culture. Via Wikimedia Commons.' }), { geracao: true, audio: true, lixo: true });
  // Sem imagem.json: vale a declaração de domínio público do próprio modelo (as obras do J94).
  await obra('quadro-b', 'tolo', null);
  await obra('quadro-nc', 'educacao', dominioPublico({ licenca: 'CC BY-NC-SA 4.0', licenca_commons: 'CC BY-NC-SA 4.0' }));
  await obra('quadro-sa', 'educacao', dominioPublico({ licenca: 'Licença livre da fotografia (Wikimedia Commons: "CC BY-SA 4.0"); obra retratada em domínio público. Atribuição: Briton Rivière', licenca_commons: 'CC BY-SA 4.0' }));
  await obra('quadro-outra-imagem', 'educacao', dominioPublico({ sha256: 'f'.repeat(64) }));
  pacote = join(base, 'acervo.tar.gz');
  manifesto = (await empacotarAcervo({ origem, destino: pacote, versao: '2026.10.12', agora: () => new Date('2026-10-12T12:00:00Z') })).manifesto;
}, 60_000);
afterAll(async () => { await rm(base, { recursive: true, force: true }); });

async function entradasDe(arquivo: string): Promise<{ caminho: string; bytes: Buffer; mtime: number }[]> {
  const lista: { caminho: string; bytes: Buffer; mtime: number }[] = [];
  await lerTarGz(arquivo, (e) => {
    const partes: Buffer[] = [];
    return Promise.resolve({ pedaco: (b: Buffer) => { partes.push(Buffer.from(b)); return Promise.resolve(); }, fim: () => { lista.push({ caminho: e.caminho, bytes: Buffer.concat(partes), mtime: e.mtime }); return Promise.resolve(); } });
  });
  return lista;
}

async function regravar(destino: string, mudar: (lista: { caminho: string; bytes: Buffer; mtime: number }[]) => { caminho: string; bytes: Buffer; mtime: number }[]): Promise<string> {
  const lista = mudar(await entradasDe(pacote));
  const entradas: EntradaParaEscrever[] = lista.map((e) => ({ caminho: e.caminho, origem: { bytes: e.bytes }, bytes: e.bytes.length, mtime: e.mtime }));
  await escreverTarGz(destino, entradas);
  return destino;
}

describe('licença de cada obra', () => {
  it('aceita domínio público e CC0; recusa NC, atribuição ao próprio artista, ausência de registro e hash divergente', async () => {
    const m = await modeloDe('educacao');
    const s = m.imagem.sha256;
    expect(conferirLicenca(dominioPublico(), m, s)).toMatchObject({ licenca: { tipo: 'dominio-publico' } });
    expect(conferirLicenca(dominioPublico({ licenca: 'Domínio público (Wikimedia Commons: "CC0")', licenca_commons: 'CC0' }), m, s)).toMatchObject({ licenca: { tipo: 'cc0' } });
    expect(conferirLicenca(dominioPublico({ licenca: 'Licença livre da fotografia (CC BY-SA 3.0). Atribuição: Philip Pikart', licenca_commons: 'CC BY-SA 3.0' }), m, s)).toMatchObject({ licenca: { tipo: 'cc-by-sa-3.0', atribuicao: 'Philip Pikart' } });
    expect(conferirLicenca(dominioPublico({ licenca: 'CC BY-NC 4.0', licenca_commons: 'CC BY-NC 4.0' }), m, s)).toMatchObject({ motivo: expect.stringContaining('restritiva') as string });
    expect(conferirLicenca(dominioPublico({ licenca: `CC BY-SA 4.0. Atribuição: ${m.identidade.artista}`, licenca_commons: 'CC BY-SA 4.0' }), m, s)).toMatchObject({ motivo: expect.stringContaining('próprio artista') as string });
    expect(conferirLicenca(dominioPublico({ licenca: 'CC BY 4.0', licenca_commons: 'CC BY 4.0' }), m, s)).toMatchObject({ motivo: expect.stringContaining('atribuição') as string });
    expect(conferirLicenca(dominioPublico({ licenca: 'Copyright do museu' , licenca_commons: null }), m, s)).toMatchObject({ motivo: expect.stringContaining('não reconhecida') as string });
    expect(conferirLicenca(dominioPublico({ origem_url: null }), m, s)).toMatchObject({ motivo: expect.stringContaining('origem_url') as string });
    expect(conferirLicenca(null, { ...m, imagem: { ...m.imagem, credito: 'Reprodução do museu.' } }, s)).toMatchObject({ motivo: expect.stringContaining('não registrada') as string });
    expect(conferirLicenca(null, m, s)).toMatchObject({ licenca: { tipo: 'dominio-publico' } });
  });
});

describe('empacotador', () => {
  it('leva só as obras redistribuíveis, com o motivo de cada exclusão', () => {
    expect(manifesto.obras.map((o) => o.slug)).toEqual(['quadro-a', 'quadro-b']);
    const motivos = Object.fromEntries(manifesto.excluidas.map((e) => [e.slug, e.motivo]));
    expect(motivos['quadro-nc']).toMatch(/restritiva/u);
    expect(motivos['quadro-sa']).toMatch(/próprio artista/u);
    expect(motivos['quadro-outra-imagem']).toMatch(/outra imagem/u);
    expect(manifesto.totais.obras).toBe(2);
    expect(manifesto.obras[0]!.credito).toBe('Google Arts & Culture. Via Wikimedia Commons.');
    expect(() => conferirManifestoDoPacote(JSON.parse(JSON.stringify(manifesto)))).not.toThrow();
  });

  it('só os arquivos que as rotas usam; a imagem vai byte a byte (o hash ancorado não muda)', async () => {
    const entradas = await entradasDe(pacote);
    const caminhos = entradas.map((e) => e.caminho);
    expect(caminhos.slice(0, 2)).toEqual(['manifesto.json', 'CREDITOS.md']);
    expect(caminhos.filter((c) => c.startsWith('obras/quadro-a/')).sort()).toEqual([
      'obras/quadro-a/audio/esperado/manifesto.json', 'obras/quadro-a/audio/esperado/narracao.mp3',
      'obras/quadro-a/esperado.curta.json', 'obras/quadro-a/esperado.modelo.json',
      'obras/quadro-a/geracoes/v2-teste/curta.json', 'obras/quadro-a/geracoes/v2-teste/modelo.json',
      'obras/quadro-a/imagem.jpg', 'obras/quadro-a/imagem.json', 'obras/quadro-a/publicado.json',
    ]);
    expect(caminhos.some((c) => /fontes|dossie|brutos|imagens\/|avaliacao|\.cache|\.wav/u.test(c))).toBe(false);
    const imagem = entradas.find((e) => e.caminho === 'obras/quadro-b/imagem.jpg')!;
    expect(sha(imagem.bytes)).toBe((await modeloDe('tolo')).imagem.sha256);
    expect(JSON.parse(entradas.find((e) => e.caminho === 'obras/quadro-a/publicado.json')!.bytes.toString('utf8'))).toEqual({ analise: 'geracoes/v2-teste' });
    const sintetizado = JSON.parse(entradas.find((e) => e.caminho === 'obras/quadro-b/imagem.json')!.bytes.toString('utf8')) as { licenca: string; origem_url: string };
    expect(sintetizado.licenca).toMatch(/^Domínio público/u);
    expect(sintetizado.origem_url).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/u);
    const creditos = entradas[1]!.bytes.toString('utf8');
    expect(creditos).toContain('Educação Obrigatória');
    expect(creditos).toContain('quadro-nc');
  });
});

describe('instalador', () => {
  it('instala, as rotas passam a listar as obras, e rodar de novo não muda nada', async () => {
    const raiz = join(base, 'instalado-1');
    const r = await instalarPacote({ pacote, raiz });
    expect(r).toMatchObject({ versao: '2026.10.12', ja_instalado: false, instaladas: ['quadro-a', 'quadro-b'], conflitos: [] });
    const obras = await lerAcervo({ raiz, fixtures: false, aviso: () => undefined });
    expect(obras.map((o) => o.slug).sort()).toEqual(['quadro-a', 'quadro-b']);
    expect(obras.find((o) => o.slug === 'quadro-a')!.publicada).toBe('v2-teste');
    expect(obras.find((o) => o.slug === 'quadro-a')!.analises.find((a) => a.rotulo === 'esperado')!.audio).not.toBeNull();
    expect(existsSync(join(raiz, '.pacote', 'CREDITOS.md'))).toBe(true);
    const segunda = await instalarPacote({ pacote, raiz });
    expect(segunda).toMatchObject({ ja_instalado: true, instaladas: [], atualizadas: [], iguais: ['quadro-a', 'quadro-b'] });
    expect((await readdir(raiz)).filter((n) => n.startsWith('.instalando'))).toEqual([]);
  });

  it('não sobrescreve uma obra da pessoa com o mesmo nome; troca o que veio de pacote anterior', async () => {
    const raiz = join(base, 'instalado-2');
    await mkdir(join(raiz, 'quadro-b'), { recursive: true });
    await writeFile(join(raiz, 'quadro-b', 'imagem.json'), '{"meu":"arquivo"}');
    const r = await instalarPacote({ pacote, raiz });
    expect(r.instaladas).toEqual(['quadro-a']);
    expect(r.conflitos).toEqual([{ slug: 'quadro-b', motivo: expect.stringContaining('não veio de um pacote') as string }]);
    expect(await readFile(join(raiz, 'quadro-b', 'imagem.json'), 'utf8')).toBe('{"meu":"arquivo"}');
    // Pacote novo com o crédito da quadro-a corrigido: o arquivo veio do pacote anterior, então é trocado.
    const novo = await regravar(join(base, 'novo.tar.gz'), (lista) => {
      const json = Buffer.from('{"origem_url":"https://commons.wikimedia.org/wiki/File:x.jpg","licenca":"Domínio público","credito":"Crédito corrigido"}\n');
      const m = JSON.parse(lista[0]!.bytes.toString('utf8')) as ManifestoDoPacote;
      m.versao = '2026.10.13';
      const a = m.obras[0]!.arquivos.find((x) => x.caminho === 'obras/quadro-a/imagem.json')!;
      m.totais.bytes += json.length - a.bytes;
      Object.assign(a, { sha256: sha(json), bytes: json.length });
      return lista.map((e) => (e.caminho === 'manifesto.json' ? { ...e, bytes: Buffer.from(JSON.stringify(m)) } : e.caminho === 'obras/quadro-a/imagem.json' ? { ...e, bytes: json } : e));
    });
    const atualizacao = await instalarPacote({ pacote: novo, raiz });
    expect(atualizacao).toMatchObject({ versao: '2026.10.13', atualizadas: ['quadro-a'] });
    expect(await readFile(join(raiz, 'quadro-a', 'imagem.json'), 'utf8')).toContain('Crédito corrigido');
  });

  it('recusa manifesto inválido, hash que não confere, arquivo fora do manifesto, caminho para fora e SHA-256 do pacote errado', async () => {
    const casos: [string, string | Promise<string>, RegExp, string?][] = [
      ['campo-desconhecido', regravar(join(base, 'r1.tar.gz'), (l) => l.map((e) => (e.caminho === 'manifesto.json' ? { ...e, bytes: Buffer.from(JSON.stringify({ ...JSON.parse(e.bytes.toString('utf8')) as object, extra: 1 })) } : e))), /manifesto_invalido: campo desconhecido/u],
      ['licenca-nc', regravar(join(base, 'r2.tar.gz'), (l) => l.map((e) => {
        if (e.caminho !== 'manifesto.json') return e;
        const m = JSON.parse(e.bytes.toString('utf8')) as ManifestoDoPacote;
        (m.obras[0]!.licenca as { tipo: string }).tipo = 'cc-by-nc-4.0';
        return { ...e, bytes: Buffer.from(JSON.stringify(m)) };
      })), /não é redistribuível/u],
      ['byte-trocado', regravar(join(base, 'r3.tar.gz'), (l) => l.map((e) => {
        if (e.caminho !== 'obras/quadro-b/imagem.jpg') return e;
        const b = Buffer.from(e.bytes); b[b.length - 10] = b[b.length - 10]! ^ 0xff;
        return { ...e, bytes: b };
      })), /hash_invalido: obras\/quadro-b\/imagem\.jpg/u],
      ['arquivo-a-mais', regravar(join(base, 'r4.tar.gz'), (l) => [...l, { caminho: 'obras/quadro-a/fontes/x.txt', bytes: Buffer.from('x'), mtime: 0 }]), /fora do manifesto/u],
      ['caminho-para-fora', regravar(join(base, 'r5.tar.gz'), (l) => [...l.slice(0, 2), { caminho: '../../fora.txt', bytes: Buffer.from('x'), mtime: 0 }, ...l.slice(2)]), /fora do manifesto/u],
      ['sem-manifesto-primeiro', regravar(join(base, 'r6.tar.gz'), (l) => [...l.slice(1), l[0]!]), /primeira entrada não é manifesto/u],
      ['faltando', regravar(join(base, 'r7.tar.gz'), (l) => l.filter((e) => e.caminho !== 'obras/quadro-a/publicado.json')), /falta obras\/quadro-a\/publicado\.json/u],
      ['sha-do-pacote', pacote, /pacote_corrompido/u, '0'.repeat(64)],
    ];
    for (const [nome, arquivo, erro, sha256] of casos) {
      const raiz = join(base, `recusa-${nome}`);
      await expect(instalarPacote({ pacote: await arquivo, raiz, ...(sha256 ? { sha256 } : {}) }), nome).rejects.toThrow(erro);
      expect(await readdir(raiz), nome).toEqual([]);
    }
  }, 120_000);

  it('baixa de uma URL (fetch trocado no teste) e confere o SHA-256 publicado', async () => {
    const bytes = await readFile(pacote);
    const buscar = ((url: string) => Promise.resolve(url.endsWith('.tar.gz') ? new Response(bytes) : new Response('não', { status: 404 }))) as unknown as typeof fetch;
    const raiz = join(base, 'por-url');
    const r = await instalarPacote({ pacote: 'https://exemplo.org/acervo.tar.gz', raiz, sha256: sha(bytes), buscar });
    expect(r.instaladas).toEqual(['quadro-a', 'quadro-b']);
    await expect(instalarPacote({ pacote: 'https://exemplo.org/sumiu', raiz: join(base, 'por-url-404'), buscar })).rejects.toThrow(/HTTP 404/u);
  });
});

describe('estado do acervo na API', () => {
  it('sem acervo: lista vazia, instalado=false, pacote e comando; com o pacote instalado: instalado=true', async () => {
    const vazio = join(base, 'acervo-vazio');
    const api = new Hono();
    registrarRotasDeArte(api, { raiz: vazio, fixtures: false });
    const antes = await (await api.request('/api/arte')).json() as { obras: unknown[]; acervo: { instalado: boolean; comando: string; pacote: { obras: number } } };
    expect(antes.obras).toEqual([]);
    expect(antes.acervo).toMatchObject({ instalado: false, comando: 'npm run arte:instalar' });
    expect(antes.acervo.pacote.obras).toBeGreaterThan(0);
    await instalarPacote({ pacote, raiz: vazio });
    const depois = await (await api.request('/api/arte')).json() as { obras: unknown[]; acervo: { instalado: boolean } };
    expect(depois.obras).toHaveLength(2);
    expect(depois.acervo.instalado).toBe(true);
  });

  it('na instalação Docker o comando é o da instalação (J111), com o nome vindo do compose', () => {
    expect(estadoDoAcervo([], { MARGEM_MODO: 'instalado', MARGEM_COMANDO: 'leitor' }).comando).toBe('leitor arte instalar');
    expect(estadoDoAcervo([], { MARGEM_MODO: 'instalado' }).comando).toBe('margem arte instalar');
    expect(estadoDoAcervo([], { MARGEM_MODO: 'instalado', MARGEM_COMANDO: 'x; rm -rf /' }).comando).toBe('margem arte instalar');
    expect(estadoDoAcervo([], {}).comando).toBe('npm run arte:instalar');
  });

  it('a arte pedida fica ligada mesmo sem a pasta do acervo; MARGEM_ARTE=0 ainda desliga', () => {
    expect([...recursosEfetivos(new Set(['arte']), {})]).toEqual(['arte']);
    expect([...recursosEfetivos(new Set(['arte']), { MARGEM_ARTE: '0' })]).toEqual([]);
  });

  it('enquanto o pacote não foi publicado (publicado: false) conta como em preparação; MARGEM_ARTE_PACOTE_URL sobrepõe', () => {
    expect(pacoteParaBaixar({}).url).toBeNull();
    expect(pacoteParaBaixar({ MARGEM_ARTE_PACOTE_URL: 'https://exemplo.org/a.tar.gz' }).url).toBe('https://exemplo.org/a.tar.gz');
  });
});
