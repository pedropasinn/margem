/**
 * PDF escaneado: "N páginas sem texto — transcrever" enfileira o job do worker, que renderiza as páginas,
 * pede a transcrição ao executor (falso aqui), grava a camada e publica uma versão nova. Motor Python de
 * verdade; a camada usa um script pequeno sem numpy no lugar do `tools/camada-da-transcricao.py` (o
 * algoritmo de alinhamento foi provado à parte, com o Codex real, e está no relatório do PR).
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type pg from 'pg';
import { expect, test } from 'vitest';
import type { Id } from '@margem/contratos';
import { comBanco } from '../../testes/apoio';
import { pastaDoDocumento, raizDoRepositorio } from '../dados';
import { criarApi } from '../http/app';
import { CABECALHO_MARGEM } from '../http/ambiente';
import { criarExecutorFalso, type PassoRoteiro } from '../executor/fake';
import type { Executor } from '../executor/tipos';
import { manipuladorCanonizar, TIPO_CANONIZAR } from '../worker/canonizar';
import { FilaPostgres } from '../worker/fila-postgres';
import { Worker } from '../worker/worker';
import { caminhoDaCamada, manipuladorTranscreverEscaneado, paginasSemTexto, TIPO_TRANSCREVER_ESCANEADO } from './transcricao';

const executar = promisify(execFile);
const ESCRITA = { [CABECALHO_MARGEM]: '1' };
const PYTHON = join(raizDoRepositorio(), 'motor/.venv/bin/python');

/** Duas páginas de texto rasterizadas: o PDF só tem imagens, como um livro escaneado. */
const GERAR_ESCANEADO = `
import sys, pymupdf
with pymupdf.open() as texto, pymupdf.open() as escaneado:
    for linhas in (["Ler devagar nao e ler menos.", "Quem le com calma volta as frases."], ["A segunda pagina continua.", "O metodo comeca pela pergunta."]):
        p = texto.new_page(width=420, height=595)
        for i, l in enumerate(linhas):
            p.insert_text((40, 70 + 16 * i), l, fontname="tiro", fontsize=11)
        n = escaneado.new_page(width=420, height=595)
        n.insert_image(n.rect, pixmap=p.get_pixmap(dpi=150, colorspace=pymupdf.csGRAY))
    escaneado.save(sys.argv[1])
`;

/** Camada de teste: cada linha transcrita, invisível (Tr 3), uma embaixo da outra. */
const CAMADA_DE_TESTE = `
import json, sys
from pathlib import Path
import pymupdf
origem, pasta, saida = sys.argv[1:4]
with pymupdf.open(origem) as d:
    for i, p in enumerate(d):
        f = Path(pasta) / "paginas" / f"{i + 1:03d}.json"
        if not f.exists():
            continue
        y = 70
        for b in json.loads(f.read_text())["pagina"]["blocos"]:
            for l in b["texto"].split("\\n"):
                p.insert_text((40, y), l, fontsize=11, render_mode=3)
                y += 16
            y += 16
    d.save(saida)
`;

function pagina(paragrafos: string[]): unknown {
  return { pagina_impressa: '', incerto: false, observacao: '', blocos: paragrafos.map((texto) => ({ tipo: 'paragrafo', texto, continua_da_anterior: false, continua_na_proxima: false })) };
}

async function rodarWorker(banco: pg.Pool, vagas: string, executor: Executor, script: string): Promise<void> {
  await new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: {
      [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }),
      [TIPO_TRANSCREVER_ESCANEADO]: manipuladorTranscreverEscaneado({
        banco, executor, modelo: 'modelo-falso', esforco: 'low', raiz: raizDoRepositorio(), prazoMs: 120_000, python: PYTHON, scriptDaCamada: script,
      }),
    },
    diretorioSlots: vagas, slots: 1, intervaloMs: 5, maximoCiclos: 2,
  }).rodar();
}

test('limites sem_texto do motor viram os números das páginas', () => {
  expect(paginasSemTexto(['sem_texto: Página PDF 3 sem texto extraível; OCR e visão fora de F1.', 'conteudo_nao_textual: Figura na página PDF 2',
    'sem_texto: Nenhum bloco textual extraído do original.', 'sem_texto: Página PDF 12 sem texto extraível; OCR e visão fora de F1.'])).toEqual([3, 12]);
});

test('PDF escaneado: transcrever pelo app vira versão nova com camada de texto', async () => comBanco('escaneado', async (banco) => {
  const antes = process.env.MARGEM_DADOS;
  const pasta = await mkdtemp(join(tmpdir(), 'margem-escaneado-'));
  process.env.MARGEM_DADOS = pasta;
  try {
    const gerador = join(pasta, 'gerar.py'), camadaDeTeste = join(pasta, 'camada.py'), pdf = join(pasta, 'escaneado.pdf');
    await writeFile(gerador, GERAR_ESCANEADO); await writeFile(camadaDeTeste, CAMADA_DE_TESTE);
    await executar(PYTHON, [gerador, pdf]);
    const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
    const formulario = new FormData();
    formulario.set('titulo', 'Escaneado'); formulario.set('formato', 'pdf');
    formulario.set('arquivo', new File([await readFile(pdf)], 'e.pdf', { type: 'application/pdf' }));
    const { documento_id: id } = await (await api.request('/api/documentos', { method: 'POST', headers: ESCRITA, body: formulario })).json() as { documento_id: Id };
    // Página 1 ok; na 2 a cota acaba (adiado); na retomada só a página 2 vai ao executor.
    const passos: PassoRoteiro[] = [
      { quando: { ordem: 1 }, tipo: 'ok', conteudo: pagina(['Ler devagar nao e ler menos.\nQuem le com calma volta as frases.']) },
      { quando: { ordem: 2 }, tipo: 'cota', not_before: new Date(Date.now() - 1_000).toISOString() },
      { quando: { ordem: 3 }, tipo: 'ok', conteudo: pagina(['A segunda pagina continua.', 'O metodo comeca pela pergunta.']) },
    ];
    const falso = criarExecutorFalso({ versao: 1, passos });
    const vagas = join(pasta, 'vagas');
    await rodarWorker(banco, vagas, falso, camadaDeTeste);

    const detalhe = async () => await (await api.request(`/api/documentos/${id}`)).json() as {
      versao_id: Id; estado: string; paginas_sem_texto: number; versoes: { id: Id }[]; jobs: { tipo: string; estado: string }[] };
    const antesDaTranscricao = await detalhe();
    expect(antesDaTranscricao.paginas_sem_texto).toBe(2);
    expect(antesDaTranscricao.versoes).toHaveLength(1);

    const pedir = () => api.request(`/api/documentos/${id}/transcrever`, { method: 'POST', headers: ESCRITA });
    const pedido = await pedir();
    expect(pedido.status).toBe(202);
    const { job_id: jobId, paginas } = await pedido.json() as { job_id: Id; paginas: number };
    expect(paginas).toBe(2);
    expect((await (await pedir()).json() as { job_id: Id }).job_id).toBe(jobId);
    const { documentos } = await (await api.request('/api/documentos')).json() as { documentos: { id: Id; estado: string }[] };
    expect(documentos.find((d) => d.id === id)?.estado).toBe('transcrevendo');

    // Dois ciclos: o adiado pela cota volta no segundo, e a página 1 não vai de novo ao executor.
    await rodarWorker(banco, vagas, falso, camadaDeTeste);
    expect(falso.chamadas).toBe(3);
    expect((await detalhe()).jobs.find((j) => j.tipo === TIPO_TRANSCREVER_ESCANEADO)?.estado).toBe('ok');

    const depois = await detalhe();
    expect(depois.versoes).toHaveLength(2);
    expect(depois.versao_id).not.toBe(antesDaTranscricao.versao_id);
    expect(depois.paginas_sem_texto).toBe(0);
    expect(depois.estado).toBe('pronto');
    const blocos = (await banco.query<{ texto: string }>('SELECT texto FROM bloco WHERE versao_id=$1 ORDER BY ordem', [depois.versao_id])).rows.map((b) => b.texto);
    expect(blocos.join(' ')).toContain('Ler devagar nao e ler menos. Quem le com calma volta as frases.');
    expect(blocos.join(' ')).toContain('O metodo comeca pela pergunta.');
    // A versão anterior continua lá; o original servido agora é o PDF com a camada (mesmas imagens).
    expect((await banco.query('SELECT 1 FROM versao_texto WHERE id=$1', [antesDaTranscricao.versao_id])).rowCount).toBe(1);
    const fonte = (await banco.query<{ sha: string }>("SELECT canonico->'documento'->>'sha256_original' AS sha FROM versao_texto WHERE id=$1", [depois.versao_id])).rows[0]!.sha;
    const original = await api.request(`/api/documentos/${id}/original`);
    expect(original.headers.get('etag')).toBe(`"${fonte}"`);
    expect(createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex')).toBe(fonte);
    expect((await readdir(join(pastaDoDocumento(id), 'transcricao'))).includes(`${fonte}.pdf`)).toBe(true);
    expect(caminhoDaCamada(id, fonte)).toContain(id);
    expect((await (await api.request(`/api/versoes/${depois.versao_id}/geometria`)).json() as { palavras: unknown[] }).palavras.length).toBeGreaterThan(10);

    // Nada mais a transcrever; e só PDF tem páginas.
    const denovo = await pedir();
    expect(denovo.status).toBe(409);
    expect((await denovo.json() as { erro: string }).erro).toBe('nada_a_transcrever');
  } finally {
    if (antes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = antes;
    await rm(pasta, { recursive: true, force: true });
  }
}), 180_000);
