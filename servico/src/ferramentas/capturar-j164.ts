/**
 * Capturas do J164 (conferência do sumário): a página do documento com o aviso, a sugestão aberta, o
 * sumário sugerido em uso no leitor e o interruptor das Configurações. Postgres descartável
 * (`margem_test_*`), sem Codex: o canônico vem de um arquivo (o motor antigo no EPUB do Zero to One, que
 * não fica no repositório) e a sugestão é montada aqui como o Codex a montaria, e conferida pelas mesmas
 * regras do serviço.
 *
 * Uso (da raiz, depois de `npm run build --workspace web`):
 *   node --import tsx servico/src/ferramentas/capturar-j164.ts -- <canonico.json> <pasta de saída>
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, type Page } from 'playwright';
import type pg from 'pg';
import type { CanonicoV1, EntradaDoSumarioSugerido } from '@margem/contratos';

const raiz = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const [arquivo, saida] = process.argv.slice(-2);
assert.ok(arquivo && saida, 'Uso: capturar-j164.ts <canonico.json> <pasta>');
const pasta = resolve(saida);
mkdirSync(pasta, { recursive: true });
process.env.MARGEM_DADOS = mkdtempSync(join(tmpdir(), 'margem-j164-capturas-'));
const PORTA = 8768;
const API = `http://127.0.0.1:${String(PORTA)}`;
process.env.MARGEM_PORTA = String(PORTA);
const canonico = JSON.parse(readFileSync(resolve(arquivo), 'utf8')) as CanonicoV1;

/** Grafia de título: "THE CHALLENGE OF THE FUTURE" → "The Challenge of the Future". */
const PEQUENAS = new Set(['a', 'an', 'the', 'of', 'and', 'or', 'in', 'on', 'to', 'for', 'is', 'it’s']);
const grafia = (texto: string) => texto.toLowerCase().split(' ').map((palavra, i) => (i > 0 && PEQUENAS.has(palavra) ? palavra : palavra.charAt(0).toUpperCase() + palavra.slice(1))).join(' ');

const { comBancoDeTeste } = await import('../db/conexao.js');
const { migrar } = await import('../db/migrar.js');

await comBancoDeTeste('capturas_j164', async (banco: pg.Pool) => {
  await migrar(banco);
  const { comTransacao } = await import('../db/transacao.js');
  const { criarApi } = await import('../http/app.js');
  const { servirWeb } = await import('../http/estatico.js');
  const documentos = await import('../repos/documentos.js');
  const { conferirProposta, secoesDoPrompt } = await import('../sumario/conferencia.js');
  const { resumirSecoes, suspeitasDoSumario } = await import('../sumario/heuristica.js');
  const api = criarApi({ banco, leitura: () => { throw new Error('As capturas não iniciam leituras.'); } });
  servirWeb(api, join(raiz, 'web/dist'));

  const { documento, versao } = await comTransacao(banco, async (cliente) => {
    const criado = await documentos.criar(cliente, { ...canonico.documento, origem_caminho: '/tmp/zero-to-one.epub' });
    return { documento: criado, versao: await documentos.criarVersao(cliente, criado.id, canonico) };
  });
  // A sugestão: cada capítulo vazio só com número (ou "Preface") sai, e o nome do seguinte ganha o número.
  const secoes = secoesDoPrompt(versao.canonico);
  const proposta: EntradaDoSumarioSugerido[] = [];
  for (let i = 0; i < secoes.length; i += 1) {
    const secao = secoes[i]!;
    const seguinte = secoes[i + 1];
    const vazioAntes = secao.nivel === 1 && secao.palavras === 0 && seguinte?.nivel === 1;
    if (vazioAntes) continue;
    const anterior = secoes[i - 1];
    const titulo = anterior && anterior.nivel === 1 && anterior.palavras === 0 && secao.nivel === 1
      ? (/^\d+$/u.test(anterior.titulo) ? `${anterior.titulo}. ${grafia(secao.titulo)}` : `${anterior.titulo}: ${grafia(secao.titulo)}`)
      : secao.titulo === secao.titulo.toUpperCase() ? grafia(secao.titulo) : secao.titulo;
    proposta.push({ titulo, nivel: secao.nivel, bloco_inicio: secao.bloco_inicio });
  }
  conferirProposta(secoes, proposta, null);
  const suspeitas = suspeitasDoSumario(resumirSecoes(versao.canonico), 42_000);
  await banco.query(`INSERT INTO conferencia_sumario (versao_id, documento_id, estado, suspeitas, resposta) VALUES ($1,$2,'suspeito',$3,$4)`, [
    versao.id, documento.id, JSON.stringify(suspeitas), JSON.stringify({ ok: false, proposta, problemas: [
      'O número de cada capítulo virou um capítulo vazio, separado do nome.', 'O prefácio aparece duas vezes: vazio e com o texto.'] }),
  ]);
  console.log(`${String(secoes.length)} seções, sugestão com ${String(proposta.length)}`);

  assert.ok((await api.request('/api/estado-instalacao/concluir', { method: 'POST', headers: { 'X-Margem': '1' } })).ok);
  await new Promise<void>((pronto) => { serve({ fetch: api.fetch, hostname: '127.0.0.1', port: PORTA }, (info: AddressInfo) => { console.log(`no ar: ${String(info.port)}`); pronto(); }); });
  const decidir = (decisao: string) => api.request(`/api/documentos/${documento.id}/sumario`, {
    method: 'POST', headers: { 'X-Margem': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ decisao }) });

  const navegador = await chromium.launch();
  const foto = (pagina: Page, nome: string, inteira = false) => pagina.screenshot({ path: join(pasta, `${nome}.png`), fullPage: inteira });
  try {
    for (const [tema, esquema] of [['claro', 'light'], ['escuro', 'dark']] as const) for (const largura of [1680, 390]) {
      assert.ok((await decidir('manter')).ok);
      await banco.query(`UPDATE conferencia_sumario SET estado='suspeito'`);
      const contexto = await navegador.newContext({ viewport: { width: largura, height: largura > 600 ? 1000 : 844 }, colorScheme: esquema, reducedMotion: 'reduce' });
      await contexto.addInitScript(() => {
        try {
          localStorage.setItem('margem:onboarding:v2:local', JSON.stringify({ versao: 2, boas_vindas: 'concluida', tela: 0,
            primeiro_documento: { estado: 'concluida', origem: 'importado', documento_id: null }, exemplo_id: null,
            tours: { texto: 'concluida', video: 'concluida', quadro: 'concluida' }, dicas: { texto: 0, video: 0, quadro: 0 }, levar: 'concluida',
            atualizado_em: '2026-10-01T12:00:00.000Z' }));
        } catch { /* sem storage */ }
      });
      const pagina = await contexto.newPage();
      pagina.on('pageerror', (erro) => console.log('erro no navegador', erro.message));
      const sufixo = `${tema}-${String(largura)}`;
      await pagina.goto(`${API}/documentos/${documento.id}`); await pagina.waitForTimeout(1500);
      await foto(pagina, `documento-aviso-${sufixo}`);
      await pagina.getByRole('button', { name: 'Ver sugestão' }).click(); await pagina.waitForTimeout(400);
      await pagina.locator('.sumario-conferido').scrollIntoViewIfNeeded();
      await foto(pagina, `documento-sugestao-${sufixo}`);
      await pagina.getByRole('button', { name: 'Usar o sumário sugerido' }).click(); await pagina.waitForTimeout(1200);
      await foto(pagina, `documento-em-uso-${sufixo}`);
      await pagina.goto(`${API}/ler/${documento.id}`); await pagina.waitForTimeout(2500);
      await foto(pagina, `leitor-sumario-sugerido-${sufixo}`);
      await pagina.goto(`${API}/configuracoes`); await pagina.waitForTimeout(1200);
      const cartao = pagina.getByRole('region', { name: 'Sumário dos livros' });
      await cartao.scrollIntoViewIfNeeded();
      await cartao.screenshot({ path: join(pasta, `configuracoes-sumario-${sufixo}.png`) });
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }
  process.exit(0);
});
