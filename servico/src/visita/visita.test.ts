/**
 * J91 no serviço: roteiro da visita guiada (prompt, resolução, job com executor falso, API) e a
 * narração (roteiro de fala da fábrica, conferência do manifesto, publicação e o MP3 pela API).
 * Postgres de teste e executor falso; nenhuma chamada ao Codex nem à fábrica.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { validarRoteiroGuiado, type NarracaoDaVisitaV1, type RoteiroGuiadoV1 } from '@margem/contratos';
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
import { lerChaveDaVisita, manipuladoresDaVisita } from './manipuladores.js';
import { aulaDoRoteiro, roteiroDeFala, temposDasFalas } from './narracao.js';
import * as repo from './repo.js';

const temporarios: string[] = [];
beforeEach(async () => { const dados = await mkdtemp(join(tmpdir(), 'margem-j91-dados-')); temporarios.push(dados); process.env.MARGEM_DADOS = dados; });
afterEach(async () => { delete process.env.MARGEM_DADOS; for (const caminho of temporarios.splice(0)) await rm(caminho, { recursive: true, force: true }); });
const ESCRITA = { 'X-Margem': '1', 'Content-Type': 'application/json' };

/** A saída do Codex para o capítulo um do livro de teste: três paradas, uma fora de ordem e um alias inventado. */
const SAIDA = {
  abertura: 'Começamos pelo capítulo um. Ele fixa uma hipótese e tira dela uma conclusão.',
  paradas: [
    { tipo: 'retorno', titulo: 'A conclusão depende da hipótese', inicio: 'B005', fim: 'B005', elementos: ['L03'], relacoes: ['R02'], dificuldades: [], notas: [], visuais: [],
      narracao: 'Aqui a conclusão aparece. Repare no somente: ela só vale com preços rígidos.', pergunta: 'O que muda com preços flexíveis?', transicao: '' },
    { tipo: 'conceito', titulo: 'A hipótese provisória', inicio: 'B002', fim: 'B003', elementos: ['L01', 'L99'], relacoes: [], dificuldades: [], notas: [], visuais: [],
      narracao: 'O autor começa admitindo que os preços são rígidos. Guarde isto.', pergunta: null, transicao: 'Agora, o exemplo.' },
    { tipo: 'dificuldade', titulo: 'Um salto', inicio: 'B005', fim: 'B002', elementos: [], relacoes: [], dificuldades: ['D01'], notas: [], visuais: [],
      narracao: 'O texto pula do choque ao produto sem mostrar o mecanismo.', pergunta: null, transicao: 'Por fim, a conclusão.' },
  ],
  fechamento: 'Ficou a ideia: a conclusão depende de uma hipótese apresentada como provisória.',
  perguntas: ['Por que o autor chama a hipótese de inicial?'],
  ponte: 'No capítulo dois, outro assunto.',
};

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
  const slots = await mkdtemp(join(tmpdir(), 'margem-j91-slots-'));
  temporarios.push(slots);
  for (let i = 0; i < 4; i += 1) await rodarUm(banco, config, auditoria, slots);
  return { canonico, versao, execucao, cap1, cap2, slots };
}

test('visita: pedido pela API → roteiro do Codex (falso) → paradas na ordem do texto, foco, ponta e falas', async () => comBanco('j91_visita', async (banco) => {
  const { canonico, versao, execucao, cap1, cap2, slots } = await compreensaoPronta(banco);
  const api = criarApi({ banco, leitura: () => { throw new Error('Leitura não usada.'); }, intervaloEventosMs: 20 });
  const base = `/api/compreensoes/${execucao.id}/capitulos/${cap1}/visita`;
  expect(await (await api.request(base)).json()).toEqual({ estado: 'nao_preparada', roteiro: null, narracao: null });
  // O capítulo dois não tem compreensão: não há sobre o que roteirizar.
  expect((await api.request(`/api/compreensoes/${execucao.id}/capitulos/${cap2}/visita`, { method: 'POST', headers: ESCRITA })).status).toBe(409);

  const pedido = await api.request(base, { method: 'POST', headers: ESCRITA });
  expect(pedido.status).toBe(202);
  expect((await pedido.json() as { estado: string }).estado).toBe('preparando');
  // Idempotente: o mesmo modelo e o mesmo perfil não geram outro job.
  await api.request(base, { method: 'POST', headers: ESCRITA });
  const jobs = (await banco.query<{ dedup_key: string }>("SELECT dedup_key FROM job WHERE tipo='roteirizar_visita'")).rows;
  expect(jobs).toHaveLength(1);
  expect(lerChaveDaVisita(jobs[0]!.dedup_key)).toMatchObject({ execucao_id: execucao.id, secao_id: cap1 });

  const pedidos: PedidoExecucao[] = [];
  const artefatos = await mkdtemp(join(tmpdir(), 'margem-j91-art-'));
  temporarios.push(artefatos);
  const falso = criarExecutorFalso({ versao: 1, passos: [{ quando: { ordem: 1 }, tipo: 'ok', conteudo: SAIDA }] });
  const executor = (p: PedidoExecucao) => { pedidos.push(p); return falso({ ...p, diretorioArtefatos: artefatos }); };
  await new Worker({ fila: new FilaPostgres(banco), manipuladores: manipuladoresDaVisita({ banco, executor, modelo: 'modelo-de-teste', esforco: 'medium', prazoMs: 10_000, diretorioArtefatos: artefatos }),
    slots: 1, diretorioSlots: slots, intervaloMs: 5, maximoCiclos: 1, heartbeatMs: 60_000 }).rodar();

  expect(pedidos).toHaveLength(1);
  expect(pedidos[0]!.esforco).toBe('medium');
  const prompt = pedidos[0]!.prompt;
  expect(prompt).toContain('capítulo 1 de 2');
  expect(prompt).toContain('Próximo capítulo: Capítulo dois');
  expect(prompt).not.toMatch(/[0-7][0-9A-HJKMNP-TV-Z]{25}/u);

  const resposta = await (await api.request(base)).json() as { estado: string; roteiro: RoteiroGuiadoV1; narracao: null };
  expect(resposta.estado).toBe('pronta');
  const roteiro = resposta.roteiro;
  expect(validarRoteiroGuiado(roteiro), JSON.stringify(validarRoteiroGuiado.errors)).toBe(true);
  expect(roteiro.capitulo).toEqual({ titulo: 'Capítulo um', numero: 1, total: 2 });
  expect(roteiro.proxima_secao_id).toBe(cap2);
  // Na ordem do texto: a hipótese (B002) antes das duas paradas em B005.
  expect(roteiro.paradas.map((p) => [p.tipo, p.bloco_inicio])).toEqual([
    ['conceito', canonico.blocos[1]!.id], ['retorno', canonico.blocos[4]!.id], ['dificuldade', canonico.blocos[4]!.id],
  ]);
  const [hipotese, conclusao, salto] = roteiro.paradas;
  expect(hipotese!.foco.citacao).toBe('Admitamos inicialmente que os preços são rígidos');
  expect(hipotese!.elementos).toHaveLength(1);
  // A relação retrospectiva: o foco é a conclusão; a ponta, a hipótese lá atrás.
  expect(conclusao!.foco.citacao).toBe('somente com preços rígidos o choque reduz o produto');
  expect(conclusao!.ponta?.citacao).toBe('Admitamos inicialmente que os preços são rígidos');
  expect(conclusao!.pergunta).toBe('O que muda com preços flexíveis?');
  // O fim antes do início é corrigido; a dificuldade vira o foco.
  expect(salto!.bloco_fim).toBe(salto!.bloco_inicio);
  expect(salto!.foco.citacao).toBe('o choque reduz o produto');
  expect(roteiro.diagnosticos.map((d) => d.codigo).sort()).toEqual(['alias_desconhecido', 'fim_corrigido', 'paradas_reordenadas']);
  expect(roteiro.falas.map((f) => [f.papel, f.parada])).toEqual([
    ['abertura', null], ['parada', 1], ['transicao', 1], ['parada', 2], ['pergunta', 2], ['parada', 3], ['fechamento', null], ['ponte', null],
  ]);
  expect(roteiro.falas[0]!.id).toBe('f001');
  expect(roteiro.perguntas_finais).toEqual(['Por que o autor chama a hipótese de inicial?']);

  // --------------------------------------------------------------- narração
  const fala = roteiroDeFala(roteiro);
  expect(fala).toContain(`id: ${aulaDoRoteiro(roteiro)}`);
  expect(fala.match(/<!-- cena: c\d{3} -->/gu)).toHaveLength(roteiro.falas.length);
  const manifesto = {
    id: aulaDoRoteiro(roteiro), total_s: 40, voz_sha256: 'c'.repeat(64),
    cenas: roteiro.falas.map((f, i) => ({ cena: `c${String(i + 1).padStart(3, '0')}`, inicio_s: i * 5, fim_s: i * 5 + 4.6, narracao: f.texto })),
  };
  const tempos = temposDasFalas(roteiro, manifesto, 40.01, 24_000);
  expect(tempos[3]).toEqual({ fala_id: 'f004', inicio_s: 15, fim_s: 19.6 });
  expect(() => temposDasFalas(roteiro, { ...manifesto, cenas: manifesto.cenas.map((c, i) => i === 2 ? { ...c, narracao: 'Outra coisa.' } : c) }, 40, 24_000)).toThrow(/não diz a fala f003/u);
  expect(() => temposDasFalas(roteiro, manifesto, 50, 24_000)).toThrow(/duração/u);

  const mp3 = join(process.env.MARGEM_DADOS!, 'aula.mp3');
  await writeFile(mp3, Buffer.from('ID3 mp3 de teste da visita'));
  const sha = await prepararArquivoAudio(mp3);
  const narracao: NarracaoDaVisitaV1 = {
    versao: 1, id: '01K0000000000000000000N001', roteiro_id: roteiro.id, sha256_audio: sha, voz_sha256: 'c'.repeat(64), job_colab: 'job_abc123',
    receita: 'margem-poesia-omnivoice', duracao_s: 40, falas: tempos, criado_em: new Date().toISOString(),
  };
  await expect(comTransacao(banco, (cliente) => repo.gravarNarracao(cliente, { ...narracao, falas: tempos.slice(1) }))).rejects.toThrow(/não cobre/u);
  await comTransacao(banco, (cliente) => repo.gravarNarracao(cliente, narracao));
  await comTransacao(banco, (cliente) => repo.gravarNarracao(cliente, { ...narracao, id: '01K0000000000000000000N002' }));
  const comVoz = await (await api.request(base)).json() as { narracao: NarracaoDaVisitaV1 };
  expect(comVoz.narracao.id).toBe(narracao.id);
  const arquivo = await api.request(`/api/narracoes-visita/${narracao.id}/arquivo`, { headers: { range: 'bytes=0-2' } });
  expect(arquivo.status).toBe(206);
  expect(await arquivo.text()).toBe('ID3');
  // Imutável: nem o roteiro nem a narração mudam depois de gravados.
  await expect(banco.query('UPDATE roteiro_visita SET perfil_hash=$1', ['x'])).rejects.toThrow(/imutável/u);
  await expect(banco.query('DELETE FROM narracao_visita')).rejects.toThrow(/imutável/u);
  expect((await banco.query('SELECT count(*)::int AS n FROM roteiro_visita WHERE versao_id=$1', [versao.id])).rows[0]).toEqual({ n: 1 });
}));
