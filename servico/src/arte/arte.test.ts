import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { lerCatalogoDeArte } from './catalogo';
import { registrarRotasDeArte } from '../http/rotas-arte';
import { gerarAnaliseDaObra } from './geracao';
import type { AnaliseDaObraGeradaV1, AnaliseCurtaDaObraV1, ModeloDaObraV1 } from '@margem/contratos';
import type { Executor } from '../executor/tipos';
describe('catálogo de arte', () => {
  it('serve lista e detalhe sem banco e devolve 404 para desconhecida', async () => {
    const app = new Hono(); registrarRotasDeArte(app, { raiz: '/nao/existe' });
    const obras = await lerCatalogoDeArte();
    const lista = await (await app.request('/api/arte')).json() as { obras: { slug: string; titulo: string }[] };
    expect(lista.obras.map((o) => o.slug).sort()).toEqual(['educacao', 'tolo']);
    const detalhe = await (await app.request('/api/arte/educacao')).json() as { analise: { modelo: { id: string } } };
    expect(detalhe.analise.modelo.id).toBe(obras[0]!.modelo.id);
    expect((await app.request('/api/arte/ausente')).status).toBe(404);
  });
  it('hash e dimensões identificam os originais fornecidos', async () => {
    for (const { modelo } of await lerCatalogoDeArte()) {
      const bytes = await readFile(new URL(`../../../web/public${modelo.imagem.url}`, import.meta.url));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(modelo.imagem.sha256);
    }
  });
  it('gerador recusa imagem trocada antes de chamar executor', async () => {
    const base = (await lerCatalogoDeArte())[0]!.modelo; const executor = vi.fn<Executor>();
    await expect(gerarAnaliseDaObra(base, { executor, diretorio: '/nao-usado', imagem: new URL('../../../web/public/arte/tolo.jpg', import.meta.url).pathname })).rejects.toThrow('imagem_divergente');
    expect(executor).not.toHaveBeenCalled();
  });
  it('falha/cota do executor não publica modelo nem inicia projeção', async () => {
    const base = (await lerCatalogoDeArte())[0]!.modelo;
    const pasta = await mkdtemp(join(tmpdir(), 'arte-teste-'));
    const executor = vi.fn<Executor>().mockResolvedValue({ estado: 'adiado', codigo: 'cota', not_before: new Date(), mensagem: 'aguardar', duracao_ms: 0 });
    try {
      await expect(gerarAnaliseDaObra(base, { executor, diretorio: pasta, imagem: new URL('../../../web/public/arte/educacao.jpg', import.meta.url).pathname })).rejects.toThrow('geracao_adiado');
      expect(executor).toHaveBeenCalledTimes(1);
      await expect(readFile(join(pasta, 'modelo.json'))).rejects.toThrow();
    } finally { await rm(pasta, { recursive: true, force: true }); }
  });
});


it('pipeline com executor falso resolve índices, preserva identidade e calcula os tempos', async () => {
  const modelo = JSON.parse(await readFile(new URL('../../../docs/arte/benchmark/educacao.modelo.json', import.meta.url), 'utf8')) as ModeloDaObraV1;
  const curta = JSON.parse(await readFile(new URL('../../../docs/arte/benchmark/educacao.curta-bruta.json', import.meta.url), 'utf8')) as AnaliseCurtaDaObraV1;
  const base = (await lerCatalogoDeArte())[0]!.modelo;
  const afirmacoes = modelo.afirmacoes.slice(1);
  const gerada: AnaliseDaObraGeradaV1 = {
    regioes: modelo.regioes.map(r => ({ rotulo: r.rotulo, forma: r.forma })),
    afirmacoes: afirmacoes.map(a => ({ texto: a.texto, tipo: a.tipo, confianca: a.confianca, evidencia: a.evidencia, fontes: a.fontes, regioes: a.regioes.map(id => modelo.regioes.findIndex(r => r.id === id)), apoios: a.apoios.map(id => afirmacoes.findIndex(a => a.id === id)) })),
    estudo: modelo.estudo.map(e => ({ tema: e.tema, afirmacoes: e.afirmacoes.map(id => afirmacoes.findIndex(a => a.id === id)) })), limites: [],
  };
  const pasta = await mkdtemp(join(tmpdir(), 'arte-geracao-teste-'));
  const ids = [...modelo.regioes.map(r => r.id), ...afirmacoes.map(a => a.id), modelo.id];
  const saidas = [gerada, curta];
  const executor = vi.fn<Executor>().mockImplementation(async () => {
    const conteudo = JSON.stringify(saidas.shift()); const artefato = join(pasta, `resposta-${saidas.length}.json`);
    await writeFile(artefato, conteudo);
    return { estado: 'ok', artefato, sha256: createHash('sha256').update(conteudo).digest('hex'), duracao_ms: 0, modelo: 'fake' };
  });
  try {
    const resultado = await gerarAnaliseDaObra(base, { executor, diretorio: pasta, imagem: new URL('../../../web/public/arte/educacao.jpg', import.meta.url).pathname, novoId: () => ids.shift()! });
    expect(executor).toHaveBeenCalledTimes(2);
    expect(resultado.falhas_antes).toContain('fala_apressada'); expect(resultado.falhas).toEqual([]);
    expect(resultado.modelo.identidade).toEqual(base.identidade);
    expect(resultado.curta.batidas.at(-1)!.fim_s).toBe(41.75);
  } finally { await rm(pasta, { recursive: true, force: true }); }
});
