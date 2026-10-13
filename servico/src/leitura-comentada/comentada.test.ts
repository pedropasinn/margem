/**
 * J92 no serviço: leitura comentada (montagem das pausas, prompt, job com executor falso, API) e a
 * narração (aulas da fábrica, conferência do manifesto, montagem do MP3 com ffmpeg, publicação e o MP3
 * pela API). Postgres de teste e executor falso; nenhuma chamada ao Codex nem à fábrica.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { falasDaLeitura, validarLeituraComentada, validarNarracaoDaLeitura, type LeituraComentadaV1, type NarracaoDaLeituraV1 } from '@margem/contratos';
import { alinharPalavras } from '@margem/core';
import { comBanco } from '../../testes/apoio.js';
import { configurar, livro, rodarUm } from '../../testes/compreensao.js';
import { prepararArquivoAudio } from '../audio/publicacao.js';
import { capitulosDaExecucao, iniciarCompreensao, prepararCapitulo } from '../compreensao/pipeline.js';
import { comTransacao } from '../db/transacao.js';
import { criarExecutorFalso } from '../executor/fake.js';
import type { PedidoExecucao } from '../executor/tipos.js';
import { criarApi } from '../http/app.js';
import { exigirModo } from '../modos.js';
import * as documentos from '../repos/documentos.js';
import { FilaPostgres } from '../worker/fila-postgres.js';
import { Worker } from '../worker/worker.js';
import { lerChaveDaLeitura, manipuladoresDaLeituraComentada, pausasComFala } from './manipuladores.js';
import { aulasDaLeitura, conferirAula, montarMp3, palavrasDosTrechos, roteiroDeFalaDaAula, segmentosParaAlinhar, type CenaParaMontar } from './narracao.js';
import * as repo from './repo.js';

const executar = promisify(execFile);
const temporarios: string[] = [];
beforeEach(async () => { const dados = await mkdtemp(join(tmpdir(), 'margem-j92-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };

async function compreensaoPronta(banco: Parameters<Parameters<typeof comBanco>[1]>[0]) {
  const canonico = livro();
  const versao = await comTransacao(banco, async (cliente) => {
    const documento = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: 'fixtures/teste.txt' });
    return documentos.criarVersao(cliente, documento.id, canonico);
  });
  const { config, auditoria } = await configurar(banco, temporarios);
  const execucao = await iniciarCompreensao(config, versao.id, exigirModo({ id: 'argumentativa', revisao: 1 }));
  const [cap1, cap2] = await comTransacao(banco, (cliente) => capitulosDaExecucao(cliente, execucao.id));
  if (!cap1 || !cap2) throw new Error('dois capítulos esperados');
  await prepararCapitulo(config, execucao.id, cap1, { prefetch: false });
  const slots = await mkdtemp(join(tmpdir(), 'margem-j92-slots-'));
  temporarios.push(slots);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, slots);
  return { canonico, versao, execucao, cap1, cap2, slots };
}

test('leitura comentada: todo grifo e toda relação viram pausa no ponto em que estão ancorados; o Codex (falso) só escreve as falas', async () => comBanco('j92_comentada', async (banco) => {
  const { canonico, execucao, cap1, cap2, slots } = await compreensaoPronta(banco);
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const base = `/api/compreensoes/${execucao.id}/capitulos/${cap1}/leitura-comentada`;
  expect(await (await api.request(base)).json()).toEqual({ estado: 'nao_preparada', leitura: null, narracao: null });
  expect((await api.request(`/api/compreensoes/${execucao.id}/capitulos/${cap2}/leitura-comentada`, { method: 'POST', headers: ESCRITA })).status).toBe(409);

  const pedido = await api.request(base, { method: 'POST', headers: ESCRITA });
  expect(pedido.status).toBe(202);
  expect((await pedido.json() as { estado: string }).estado).toBe('preparando');
  await api.request(base, { method: 'POST', headers: ESCRITA });
  const jobs = (await banco.query<{ dedup_key: string }>("SELECT dedup_key FROM job WHERE tipo='comentar_leitura'")).rows;
  expect(jobs).toHaveLength(1);
  expect(lerChaveDaLeitura(jobs[0]!.dedup_key)).toMatchObject({ execucao_id: execucao.id, secao_id: cap1 });

  // O executor falso lê as pausas do schema (enum) e escreve uma fala para cada uma, menos a última (repete a primeira).
  const pedidos: PedidoExecucao[] = [];
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-j92-art-'));
  temporarios.push(artefatos);
  const executor = async (p: PedidoExecucao) => {
    pedidos.push(p);
    const schema = JSON.parse(await readFile(p.schema, 'utf8')) as { properties: { falas: { items: { properties: { pausa: { enum: string[] } } } } } };
    const aliases = schema.properties.falas.items.properties.pausa.enum;
    const falas = [...aliases.slice(0, -1).map((pausa) => ({ pausa, fala: `Repare na ${pausa.toLowerCase()}: a UML aparece aqui.` })), { pausa: 'P001', fala: 'Repetida.' }];
    return criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: { falas } }] })({ ...p, diretorioArtefatos: artefatos });
  };
  await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDaLeituraComentada({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos }),
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();

  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]!.esforco).toBe('medium');
  const prompt = pedidos[0]!.prompt;
  expect(prompt).toContain('A leitura para depois de: “Admitamos inicialmente que os preços são rígidos.”');
  expect(prompt).toContain('relação · este trecho pressupõe o trecho anterior');
  expect(prompt).not.toMatch(/[0-7][0-9A-HJKMNP-TV-Z]{25}/u);

  const falha = (await banco.query<{ error_code: string | null; diagnosticos: unknown }>("SELECT error_code, diagnosticos FROM job WHERE tipo='comentar_leitura'")).rows[0];
  expect(falha?.error_code ?? null, JSON.stringify(falha?.diagnosticos)).toBeNull();
  const resposta = await (await api.request(base)).json() as { estado: string; leitura: LeituraComentadaV1 };
  expect(resposta.estado).toBe('pronta');
  const leitura = resposta.leitura;
  expect(validarLeituraComentada(leitura), JSON.stringify(validarLeituraComentada.errors)).toBe(true);
  expect(leitura.capitulo).toEqual({ titulo: 'Capítulo um', numero: 1, total: 2 });
  expect(leitura.proxima_secao_id).toBe(cap2);
  // O capítulo inteiro, frase a frase (o título, a hipótese, o exemplo em duas frases, a seção e a conclusão).
  expect(leitura.trechos.map((t) => t.texto)).toEqual([
    'Capítulo um', 'Admitamos inicialmente que os preços são rígidos.', 'Um exemplo ilustra: o cardápio impresso não muda todo dia.', 'Consequência',
    'Logo, somente com preços rígidos o choque reduz o produto.',
  ]);
  const marcas = (await banco.query<{ id: string; bloco_id: string }>("SELECT id, bloco_id FROM marca WHERE camada_id=$1 AND visivel AND validade='resolvida'", [execucao.id])).rows;
  const relacoes = (await comTransacao(banco, async (c) => (await c.query<{ n: number }>("SELECT jsonb_array_length(conteudo->'relacoes') AS n FROM modelo_capitulo WHERE execucao_id=$1 AND secao_id=$2 AND revisao=2", [execucao.id, cap1])).rows[0]!.n));
  // Todos os grifos e todas as relações, cada um uma vez.
  const fontes = leitura.pausas.flatMap((p) => p.fontes);
  expect(fontes.filter((f) => f.tipo === 'grifo')).toHaveLength(marcas.length);
  expect(fontes.filter((f) => f.tipo === 'relacao')).toHaveLength(relacoes);
  // Grifo e relação na mesma frase: uma pausa só, grifo primeiro (mesma âncora).
  const conclusao = leitura.pausas.find((p) => p.depois_de === 't0005')!;
  expect(conclusao.fontes.map((f) => f.tipo)).toEqual(['grifo', 'relacao']);
  expect(conclusao.pontas[0]?.citacao).toBe('Admitamos inicialmente que os preços são rígidos');
  expect(conclusao.foco[0]?.bloco_id).toBe(canonico.blocos[4]!.id);
  // A última pausa ficou sem fala (diagnóstico) e a fala repetida foi descartada.
  expect(leitura.diagnosticos.map((d) => d.codigo).sort()).toEqual(['fala_repetida', 'pausa_sem_fala']);
  expect(leitura.pausas.at(-1)!.texto).toBe('');
  // A pronúncia vai só para o falado.
  expect(leitura.pausas[0]!.texto).toContain('a UML aparece');
  expect(leitura.pausas[0]!.falado).toContain('a u ême éle aparece');

  // --------------------------------------------------------------- narração: aulas, conferência e montagem
  const falas = falasDaLeitura(leitura);
  expect(falas.map((f) => f.id)).toEqual(leitura.trechos.flatMap((t) => {
    const p = leitura.pausas.find((x) => x.depois_de === t.id && x.falado !== '');
    return p ? [t.id, p.id] : [t.id];
  }));
  const aulas = aulasDaLeitura(leitura, 12);
  expect(aulas.length).toBeGreaterThan(1);
  // Uma pausa nunca é separada da frase que ela comenta.
  for (const aula of aulas) expect(aula.cenas[0]!.fala_id.startsWith('t')).toBe(true);
  expect(aulas.flatMap((a) => a.cenas.map((c) => c.fala_id))).toEqual(falas.map((f) => f.id));
  const roteiro = roteiroDeFalaDaAula(aulas[0]!);
  expect(roteiro).toContain(`id: ${aulas[0]!.id}`);
  expect(roteiro.match(/<!-- cena: c\d{3} -->/gu)).toHaveLength(aulas[0]!.cenas.length);

  // Cada aula: um MP3 de verdade (ffmpeg), com um tom por cena, e o manifesto da fábrica.
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j92-aulas-'));
  temporarios.push(pasta);
  const cenas: CenaParaMontar[] = [];
  for (const aula of aulas) {
    const manifesto = { id: aula.id, total_s: 0, voz_sha256: 'c'.repeat(64), cenas: aula.cenas.map((c, i) => ({ cena: c.cena, inicio_s: i * 0.5, fim_s: i * 0.5 + 0.3, narracao: c.falado })) };
    manifesto.total_s = aula.cenas.length * 0.5;
    const mp3 = join(pasta, `${aula.id}.mp3`);
    await executar('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=440:duration=${String(manifesto.total_s)}:sample_rate=24000`, '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '96k', mp3]);
    const { stdout } = await executar('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3]);
    const conferidas = conferirAula(aula, manifesto, Number(stdout), 24_000);
    expect(() => conferirAula(aula, { ...manifesto, cenas: manifesto.cenas.map((c, i) => i === 0 ? { ...c, narracao: 'Outra.' } : c) }, Number(stdout), 24_000)).toThrow(/não diz a fala/u);
    aula.cenas.forEach((c, i) => cenas.push({ fala_id: c.fala_id, tipo: c.fala_id.startsWith('t') ? 'trecho' : 'pausa', bloco_id: leitura.trechos.find((t) => t.id === c.fala_id)?.bloco_id ?? null, mp3, inicio_s: conferidas[i]!.inicio_s, fim_s: conferidas[i]!.fim_s }));
  }
  const capitulo = join(pasta, 'capitulo.mp3');
  const montado = await montarMp3(cenas, capitulo, { entre_frases_s: 0.35, entre_blocos_s: 0.7, silencio_antes_s: 0.7, silencio_depois_s: 0.6, sinal: true, contraste: true });
  expect(montado.falas.map((f) => f.fala_id)).toEqual(falas.map((f) => f.id));
  // Cada fala dura o que durava na aula (o contraste estica o comentário em ~5 %).
  const primeira = montado.falas[0]!;
  expect(primeira.fim_s - primeira.inicio_s).toBeCloseTo(0.3, 2);
  const pausa = montado.falas.find((f) => f.fala_id.startsWith('p'))!;
  expect(pausa.fim_s - pausa.inicio_s).toBeGreaterThan(0.3);
  const anterior = montado.falas[montado.falas.indexOf(pausa) - 1]!;
  expect(pausa.inicio_s - anterior.fim_s).toBeCloseTo(0.7, 2);

  // Palavras: o alinhamento sobre o falado volta ao texto do livro.
  const segmentos = segmentosParaAlinhar(leitura, montado.falas);
  expect(segmentos[1]!.text).toBe(leitura.trechos[1]!.falado);
  const t2 = montado.falas.find((f) => f.fala_id === 't0002')!;
  const palavras = palavrasDosTrechos(leitura, montado.falas, [
    { palavra: 'Admitamos', inicio_s: t2.inicio_s + 0.01, fim_s: t2.inicio_s + 0.1 }, { palavra: 'inicialmente', inicio_s: t2.inicio_s + 0.12, fim_s: t2.inicio_s + 0.2 },
  ], alinharPalavras);
  expect(palavras.map((p) => [p.inicio_utf16, p.fim_utf16])).toEqual([[0, 9], [10, 22]]);

  const sha = await prepararArquivoAudio(capitulo);
  const narracao: NarracaoDaLeituraV1 = {
    versao: 1, id: '01K0000000000000000000N001', leitura_id: leitura.id, sha256_audio: sha, voz_sha256: 'c'.repeat(64), jobs_colab: ['job_abc123'],
    receita: 'margem-poesia-omnivoice', duracao_s: montado.duracao_s, transicao: { silencio_antes_s: 0.7, silencio_depois_s: 0.6, sinal: true, contraste: true },
    falas: montado.falas, palavras: palavras.map((p) => ({ ...p, bloco_id: leitura.trechos[1]!.bloco_id })), criado_em: new Date().toISOString(),
  };
  expect(validarNarracaoDaLeitura(narracao), JSON.stringify(validarNarracaoDaLeitura.errors)).toBe(true);
  await expect(comTransacao(banco, (cliente) => repo.gravarNarracao(cliente, { ...narracao, falas: montado.falas.slice(1) }))).rejects.toThrow(/não cobre/u);
  await comTransacao(banco, (cliente) => repo.gravarNarracao(cliente, narracao));
  await comTransacao(banco, (cliente) => repo.gravarNarracao(cliente, { ...narracao, id: '01K0000000000000000000N002' }));
  const comVoz = await (await api.request(base)).json() as { narracao: NarracaoDaLeituraV1 };
  expect(comVoz.narracao.id).toBe(narracao.id);
  const arquivo = await api.request(`/api/narracoes-leitura/${narracao.id}/arquivo`, { headers: { range: 'bytes=0-2' } });
  expect(arquivo.status).toBe(206);
  await expect(banco.query('UPDATE leitura_comentada SET fontes_hash=$1', ['a'.repeat(64)])).rejects.toThrow(/imutável/u);
  await expect(banco.query('DELETE FROM narracao_leitura')).rejects.toThrow(/imutável/u);
}));

test('falas: uma por pausa; repetida e desconhecida viram diagnóstico', () => {
  const esboco = {
    trechos: [], saltados: [], fontes_hash: 'a'.repeat(64), diagnosticos: [],
    pausas: ['P001', 'P002'].map((alias, i) => ({ alias, depois_de: `t000${String(i + 1)}`, fontes: [{ tipo: 'grifo' as const, id: `G${String(i)}` }], foco: [], pontas: [], descricao: '' })),
  };
  const { pausas, diagnosticos } = pausasComFala(esboco, { falas: [{ pausa: 'P001', fala: '  Uma   fala. ' }, { pausa: 'P001', fala: 'Outra.' }, { pausa: 'P003', fala: 'x' }] });
  expect(pausas.map((p) => [p.id, p.texto])).toEqual([['p001', 'Uma fala.'], ['p002', '']]);
  expect(diagnosticos.map((d) => d.codigo)).toEqual(['fala_repetida', 'pausa_desconhecida', 'pausa_sem_fala']);
});
