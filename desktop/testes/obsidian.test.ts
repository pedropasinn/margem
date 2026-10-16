/**
 * "Exportar para o Obsidian…" do app de computador: grava numa pasta do disco com a mesma mescla e a
 * mesma sincronização do plugin. O servidor é falso e devolve a árvore de exemplo do formato 2
 * (`integracoes/obsidian/exemplo/Margem`, gerada pelo serviço com `npm run exemplo-obsidian`).
 */
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { margemIdDaNota, sincronizarV2, type CofreDaSincronizacao, type IndiceDoMargemV2 } from '../../core/src/obsidian.js';
import { cofreNoDisco, exportarParaOCofre, resumoDaExportacao } from '../src/nucleo/obsidian.js';

const EXEMPLO = new URL('../../integracoes/obsidian/exemplo/Margem/', import.meta.url);
const SERVICO = 'http://127.0.0.1:8730';

async function arvore(raiz: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  const visitar = async (pasta: string) => {
    for (const entrada of await readdir(pasta, { withFileTypes: true })) {
      const caminho = join(pasta, entrada.name);
      if (entrada.isDirectory()) await visitar(caminho);
      else mapa.set(relative(raiz, caminho).split(sep).join('/'), await readFile(caminho, 'utf8'));
    }
  };
  await visitar(raiz);
  return mapa;
}

/** O servidor falso: índice e notas por documento a partir da árvore de exemplo. */
async function servidorDeExemplo() {
  const notas = [...(await arvore(EXEMPLO.pathname)).entries()].filter(([caminho]) => caminho.endsWith('.md')).map(([caminho, conteudo]) => {
    const id = margemIdDaNota(conteudo)!;
    const tipo = /^margem_tipo: "([a-z]+)"$/m.exec(conteudo)?.[1] ?? '';
    const documento = tipo === 'documento' ? id : /^documento_id: "([0-9A-Z]+)"$/m.exec(conteudo)?.[1] ?? '';
    return { id, tipo, documento_id: documento, caminho, conteudo };
  }).sort((a, b) => (a.caminho < b.caminho ? -1 : 1));
  const indice: IndiceDoMargemV2 = {
    versao: 2, url_base: SERVICO, marcas: 'minhas', incluir: ['documento', 'grifo'],
    notas: notas.map(({ id, tipo, documento_id, caminho, conteudo }) => ({
      id, tipo, documento_id, caminho, sha256: createHash('sha256').update(conteudo).digest('hex'), atualizado_em: '2026-09-30T12:00:00.000Z' })),
  };
  const pedidos: string[] = [];
  const buscar = ((url: string) => {
    pedidos.push(url);
    const corpo = url.includes('/api/obsidian/v2/indice') ? indice : { notas: notas.map(({ id, caminho, conteudo }) => ({ id, caminho, conteudo })) };
    return Promise.resolve(new Response(JSON.stringify(corpo), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  }) as typeof fetch;
  return { notas, indice, buscar, pedidos };
}

const pastas: string[] = [];
afterEach(async () => { await Promise.all(pastas.splice(0).map((pasta) => rm(pasta, { recursive: true, force: true }))); });
async function pastaTemporaria(): Promise<string> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-cofre-'));
  pastas.push(pasta);
  return pasta;
}

describe('exportar para o Obsidian (app de computador)', () => {
  it('grava a árvore no cofre com o mesmo resultado do plugin; de novo, não muda um byte', async () => {
    const { buscar, notas, pedidos } = await servidorDeExemplo();
    const cofre = await pastaTemporaria();
    await mkdir(join(cofre, '.obsidian'), { recursive: true });
    const primeira = await exportarParaOCofre({ servico: SERVICO, cofre, buscar });
    expect(primeira.relatorio.criadas).toHaveLength(notas.length);
    expect(resumoDaExportacao(primeira).titulo).toBe('Exportado para o Obsidian.');
    const disco = await arvore(cofre);
    expect(disco.get('Margem/.margem/manifesto.json')).toBeDefined();
    expect(JSON.parse(disco.get('Margem/.margem/estado.json')!)).toMatchObject({ versao: 2 });

    // O plugin, com um cofre em memória, chega às mesmas notas.
    const memoria = new Map<string, string>();
    const cofreDoPlugin: CofreDaSincronizacao = {
      ler: (caminho) => Promise.resolve(memoria.get(caminho) ?? null),
      escrever: (caminho, conteudo) => { memoria.set(caminho, conteudo); return Promise.resolve(); },
      notasDoMargem: () => Promise.resolve(new Map([...memoria].flatMap(([c, t]) => { const id = margemIdDaNota(t); return id ? [[id, c] as const] : []; }))),
    };
    const { indice } = await servidorDeExemplo();
    await sincronizarV2({ cofre: cofreDoPlugin, pasta: 'Margem', estado: {}, cliente: {
      indice: () => Promise.resolve(indice), documento: () => Promise.resolve({ notas: notas.map(({ id, caminho, conteudo }) => ({ id, caminho, conteudo })) }) } });
    const soNotas = new Map([...disco].filter(([caminho]) => !caminho.includes('/.margem/')));
    expect(soNotas).toEqual(memoria);

    const pedidosAntes = pedidos.length;
    const segunda = await exportarParaOCofre({ servico: SERVICO, cofre, buscar });
    expect(segunda.relatorio).toMatchObject({ criadas: [], atualizadas: [], iguais: notas.length });
    expect(pedidos.length - pedidosAntes).toBe(1);
    expect(await arvore(cofre)).toEqual(disco);
  });

  it('preserva o texto fora do bloco, acha a nota movida pelo margem_id e não escreve fora do cofre', async () => {
    const { buscar, notas } = await servidorDeExemplo();
    const cofre = await pastaTemporaria();
    await exportarParaOCofre({ servico: SERVICO, cofre, buscar });
    const grifo = notas.find((nota) => nota.tipo === 'grifo')!;
    // A pessoa move a nota para o Zettel e escreve depois do bloco; a exportação esquece o estado.
    await rm(join(cofre, 'Margem', ...grifo.caminho.split('/')));
    await mkdir(join(cofre, 'Zettel'), { recursive: true });
    await writeFile(join(cofre, 'Zettel', 'Minha tese.md'), `${grifo.conteudo}\nO que eu acho disso.\n`);
    await rm(join(cofre, 'Margem', '.margem'), { recursive: true });
    const resultado = await exportarParaOCofre({ servico: SERVICO, cofre, buscar });
    expect(resultado.relatorio.criadas).toEqual([]);
    expect(await readFile(join(cofre, 'Zettel', 'Minha tese.md'), 'utf8')).toBe(`${grifo.conteudo}\nO que eu acho disso.\n`);

    const malicioso = (async () => {
      const { indice } = await servidorDeExemplo();
      indice.notas[0]!.caminho = '../../fora.md';
      return exportarParaOCofre({ servico: SERVICO, cofre, buscar: (() => Promise.resolve(new Response(JSON.stringify(indice)))) });
    })();
    await expect(malicioso).rejects.toThrow(/malformada/);
  });

  it('S-07: Margem (ou uma subpasta) como link para fora do cofre é recusado sem criar nem alterar nada lá', async () => {
    const { buscar } = await servidorDeExemplo();
    const cofre = await pastaTemporaria();
    const externa = await pastaTemporaria();
    await writeFile(join(externa, 'intocado.md'), 'antes\n');
    // No Windows a junção faz o mesmo papel do link simbólico de pasta.
    await symlink(externa, join(cofre, 'Margem'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(exportarParaOCofre({ servico: SERVICO, cofre, buscar })).rejects.toThrow(/aponta para fora/);
    expect(await readdir(externa)).toEqual(['intocado.md']);
    expect(await readFile(join(externa, 'intocado.md'), 'utf8')).toBe('antes\n');
    // Um link mais fundo, criado depois da conferência da raiz: a escrita da nota também recusa.
    await rm(join(cofre, 'Margem'));
    await mkdir(join(cofre, 'Margem'));
    await symlink(externa, join(cofre, 'Margem', 'Livro'), process.platform === 'win32' ? 'junction' : 'dir');
    const disco = cofreNoDisco(cofre);
    await expect(disco.escrever('Margem/Livro/nota.md', 'x')).rejects.toThrow(/aponta para fora/);
    await expect(disco.escrever('Margem/Livro/sub/nota.md', 'x')).rejects.toThrow(/aponta para fora/);
    expect(await readdir(externa)).toEqual(['intocado.md']);
    // Dentro do cofre continua gravando, criando as pastas que faltam.
    await disco.escrever('Margem/Outro/sub/nota.md', 'ok');
    expect(await readFile(join(cofre, 'Margem', 'Outro', 'sub', 'nota.md'), 'utf8')).toBe('ok');
  });

  it('S-01: com a chave local, os pedidos ao serviço vão com Authorization: Bearer', async () => {
    const { buscar } = await servidorDeExemplo();
    const cabecalhos: (string | null)[] = [];
    const comChave = ((url: string, init?: RequestInit) => { cabecalhos.push(new Headers(init?.headers).get('authorization')); return buscar(url, init); }) as typeof fetch;
    await exportarParaOCofre({ servico: SERVICO, cofre: await pastaTemporaria(), buscar: comChave, chave: 'k'.repeat(43) });
    expect(cabecalhos.length).toBeGreaterThan(0);
    expect(new Set(cabecalhos)).toEqual(new Set([`Bearer ${'k'.repeat(43)}`]));
  });

  it('um documento só: o índice é filtrado e o resto do cofre não é tocado', async () => {
    const { buscar, notas } = await servidorDeExemplo();
    const cofre = await pastaTemporaria();
    const documento = notas.find((nota) => nota.tipo === 'documento')!.id;
    const { relatorio } = await exportarParaOCofre({ servico: SERVICO, cofre, buscar, documentoId: '01KD0000000000000000000099' });
    expect(relatorio.criadas).toEqual([]);
    const deste = await exportarParaOCofre({ servico: SERVICO, cofre, buscar, documentoId: documento });
    expect(deste.relatorio.criadas).toHaveLength(notas.length);
  });
});
