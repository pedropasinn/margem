import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ulid } from 'ulid';
import { afterEach, expect, test } from 'vitest';
import { ancoraDeSelecao } from '@margem/core';
import { MODO_F1, type GeometriaV1, type MarcaV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco, idTeste } from '../../testes/apoio.js';
import { comTransacao } from '../db/transacao.js';
import { pastaDaVersao, raizDoRepositorio } from '../dados.js';
import * as anotacoes from '../repos/anotacoes.js';
import * as documentos from '../repos/documentos.js';
import * as marcas from '../repos/marcas.js';
import { criarApi } from './app.js';

const executar = promisify(execFile);
const python = join(raizDoRepositorio(), 'motor/.venv/bin/python');
const temporarios: string[] = [];
const dadosAntes = process.env.MARGEM_DADOS;
afterEach(async () => {
  if (dadosAntes === undefined) delete process.env.MARGEM_DADOS;
  else process.env.MARGEM_DADOS = dadosAntes;
  for (const pasta of temporarios.splice(0)) await rm(pasta, { recursive: true, force: true });
});

/** Um PDF de verdade, de duas páginas, gerado pelo PyMuPDF do motor. */
async function pdfDeTeste(caminho: string): Promise<void> {
  await executar(python, ['-c', `import pymupdf, sys
d = pymupdf.open()
for i in range(2):
    p = d.new_page(width=600, height=800)
    p.insert_text((50, 100), "Primeira frase grifada.", fontsize=12)
    p.insert_text((50, 130), "Segunda frase da IA.", fontsize=12)
d.save(sys.argv[1])`, caminho]);
}

interface AnotacaoLida { pagina: number; tipo: string; conteudo: string; cor: number[]; vertices: number[][] }
async function lerAnotacoes(bytes: Uint8Array): Promise<AnotacaoLida[]> {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-pdf-lido-'));
  temporarios.push(pasta);
  await writeFile(join(pasta, 'x.pdf'), bytes);
  const { stdout } = await executar(python, ['-c', `import json, pymupdf, sys
d = pymupdf.open(sys.argv[1])
saida = []
for p in d:
    for a in p.annots():
        saida.append({"pagina": p.number + 1, "tipo": a.type[1], "conteudo": a.info["content"],
                      "cor": [round(c, 2) for c in a.colors["stroke"]], "vertices": [list(v) for v in (a.vertices or [])]})
print(json.dumps(saida))`, join(pasta, 'x.pdf')]);
  return JSON.parse(stdout) as AnotacaoLida[];
}

async function preparar(nome: string, fn: (url: string, api: ReturnType<typeof criarApi>) => Promise<void>, formato: 'pdf' | 'md' = 'pdf') {
  return comBanco(nome, async (banco) => {
    const dados = await mkdtemp(join(tmpdir(), 'margem-pdf-anotado-'));
    temporarios.push(dados);
    process.env.MARGEM_DADOS = dados;
    const original = join(dados, 'original.pdf');
    await pdfDeTeste(original);
    const canonico = canonicoDeTeste({ titulo: 'Livro: teste', blocos: [{ tipo: 'capitulo', texto: 'Título' },
      { tipo: 'paragrafo', texto: 'Primeira frase grifada.' }, { tipo: 'paragrafo', texto: 'Segunda frase da IA.' },
      { tipo: 'paragrafo', texto: 'Terceira sem geometria.' }], secoes: [{ nivel: 1, inicio: 0, fim: 3 }] });
    canonico.documento.formato = formato;
    canonico.documento.sha256_original = createHash('sha256').update(await readFile(original)).digest('hex');
    const versao = await comTransacao(banco, async (cliente) => {
      const doc = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: original });
      return documentos.criarVersao(cliente, doc.id, canonico);
    });
    const [, um, dois, tres] = canonico.blocos.map((bloco) => ({ ...bloco, versao_id: versao.id }));
    // Geometria só para os blocos 1 e 2, na página 2 (o bloco 1 também na 1, para testar várias páginas).
    const geometria: GeometriaV1 = { versao: 1, versao_id: versao.id, fonte: 'pdf_texto', motor: 'teste/1',
      paginas: [1, 2].map((numero) => ({ numero, largura: 600, altura: 800, rotacao: 0 })),
      palavras: [
        { bloco_id: um!.id, inicio_utf16: 0, fim_utf16: 8, pagina: 1, quad: [50, 88, 104, 88, 104, 104, 50, 104] },
        { bloco_id: um!.id, inicio_utf16: 9, fim_utf16: 23, pagina: 2, quad: [50, 88, 180, 88, 180, 104, 50, 104] },
        { bloco_id: dois!.id, inicio_utf16: 0, fim_utf16: 20, pagina: 2, quad: [50, 118, 170, 118, 170, 134, 50, 134] },
      ] };
    const pasta = pastaDaVersao(versao.documento_id, versao.id);
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, 'geometria.json'), JSON.stringify(geometria));
    const agora = '2026-10-02T03:00:00.000Z';
    await comTransacao(banco, async (cliente) => {
      const grifo = await marcas.criarGrifo(cliente, { id: ulid(), ancora: ancoraDeSelecao(um!, 0, 23), funcao: 'tese', modo: MODO_F1, criada_em: agora });
      const daIa: MarcaV1 = { id: ulid(), ancora: ancoraDeSelecao(dois!, 0, 20), funcao: 'conceito', subfaixas: [], comentario: null,
        origem: 'parte', validade: 'resolvida', visivel: true, avaliacao: 'nao_avaliada', criada_em: agora };
      await marcas.publicarMarcas(cliente, versao.id, [daIa]);
      const nota = (ancora: ReturnType<typeof ancoraDeSelecao>, texto: string, marca_id?: string) => anotacoes.criar(cliente, {
        versao: 1, revisao_edicao: 1, id: ulid(), versao_id: versao.id, ancora, tipo: 'duvida', texto, criada_em: agora, atualizada_em: agora,
        ...(marca_id === undefined ? {} : { marca_id }) });
      await nota(ancoraDeSelecao(um!, 0, 8), 'Por que primeira?', grifo.id);
      await nota(ancoraDeSelecao(dois!, 0, 7), 'Nota avulsa.');
      await nota(ancoraDeSelecao(tres!, 0, 8), 'Sem lugar no PDF.');
    });
    await fn(`/api/versoes/${versao.id}/pdf-anotado`, criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); } }));
  });
}

test('PDF anotado: grifo do leitor vira Highlight na cor da função, com a nota; IA só com ?ia=1', async () => preparar('pdf_anotado', async (url, api) => {
  const resposta = await api.request(url);
  expect(resposta.status).toBe(200);
  expect(resposta.headers.get('content-type')).toBe('application/pdf');
  expect(resposta.headers.get('content-disposition')).toContain(`filename*=UTF-8''${encodeURIComponent('Livro  teste (anotado).pdf')}`);
  expect([resposta.headers.get('x-margem-marcas'), resposta.headers.get('x-margem-notas'), resposta.headers.get('x-margem-sem-geometria')]).toEqual(['1', '2', '1']);
  const lidas = await lerAnotacoes(new Uint8Array(await resposta.arrayBuffer()));
  const grifos = lidas.filter((a) => a.tipo === 'Highlight');
  // O grifo atravessa duas páginas: um Highlight por página, ambos amarelos (tese) e com a nota.
  expect(grifos.map((a) => a.pagina)).toEqual([1, 2]);
  for (const grifo of grifos) {
    expect(grifo.cor).toEqual([1, 0.85, 0.15]);
    expect(grifo.conteudo).toBe('Tese\n\nDúvida: Por que primeira?');
  }
  expect(grifos[0]!.vertices).toEqual([[50, 88], [104, 88], [50, 104], [104, 104]]);
  const avulsas = lidas.filter((a) => a.tipo === 'Text');
  expect(avulsas).toHaveLength(1);
  expect(avulsas[0]).toMatchObject({ pagina: 2, conteudo: 'Dúvida: Nota avulsa.\n\n“Segunda”' });

  const comIa = await api.request(`${url}?ia=1`);
  expect(comIa.headers.get('x-margem-marcas')).toBe('2');
  const todas = await lerAnotacoes(new Uint8Array(await comIa.arrayBuffer()));
  expect(todas.filter((a) => a.tipo === 'Highlight' && a.conteudo === 'Conceito')).toMatchObject([{ pagina: 2, cor: [0.35, 0.84, 0.46] }]);
}));

test('PDF anotado: documento sem PDF original, versão inexistente e id inválido', async () => preparar('pdf_anotado_md', async (url, api) => {
  expect((await api.request(url)).status).toBe(404);
  expect((await api.request(`/api/versoes/${idTeste('V', 99)}/pdf-anotado`)).status).toBe(404);
  expect((await api.request('/api/versoes/x/pdf-anotado')).status).toBe(400);
}, 'md'));
