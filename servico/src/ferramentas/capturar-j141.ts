/**
 * Capturas do J141 (página do documento, Diagnóstico, leitor, prévia da resolução e Configurações) com o
 * serviço de verdade num Postgres descartável (`margem_test_*`, criado e apagado aqui) e dados falsos: uma
 * lista de exercícios em PDF com equações (gerada pelo PyMuPDF) e um conto em Markdown com marcas
 * importadas pelo caminho legado. A produção nunca é tocada; o Codex nunca é chamado.
 *
 * Uso (da raiz, depois de `npm run build --workspace web`):
 *   npx vite-node -c servico/vitest.config.ts servico/src/ferramentas/capturar-j141.ts -- <pasta de saída>
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { chromium, type Page } from 'playwright';
import type pg from 'pg';
import { ulid } from 'ulid';
import type { ResolucaoV2 } from '@margem/contratos';

const raiz = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const pasta = resolve(process.argv.at(-1) ?? join(raiz, 'docs/ui-revisao/j141'));
mkdirSync(pasta, { recursive: true });
const dados = mkdtempSync(join(tmpdir(), 'margem-j141-capturas-'));
process.env.MARGEM_DADOS = dados;
const PORTA = 8767;
const API = `http://127.0.0.1:${String(PORTA)}`;
process.env.MARGEM_PORTA = String(PORTA);

// A lista de exercícios: enunciados numerados e várias equações recuadas (viram blocos `equacao`).
const pdf = join(dados, 'lista1.pdf');
execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c', `
import sys, pymupdf
doc = pymupdf.open()
linhas = [
  (40, 70, 'Lista 1', 'hebo', 22),
  (40, 110, '1. Sejam A, B e C subconjuntos de um conjunto Omega. Prove as igualdades:', 'helv', 11),
]
y = 135
for eq in ['A = (A - B) + (A * B)', 'A - (A - B) = A * B', 'A * (B - C) = (A * B) - (A * C)', 'A + B = (A + C) * (B + C)']:
  linhas.append((80, y, eq, 'helv', 11)); y += 22
linhas.append((40, y + 10, '2. Sejam a, b reais com a < b. Apresente os conjuntos formados por:', 'helv', 11)); y += 35
for eq in ['U = uniao de (a, b - 1/n] para n >= 1', 'I = intersecao de (a - 1/n, b] para n >= 1', 'J = intersecao de (a - 1/n, a] para n >= 1']:
  linhas.append((80, y, eq, 'helv', 11)); y += 22
linhas.append((40, y + 10, '3. Sejam A, B e C subconjuntos de Omega. Se A e B sao conjuntos disjuntos, verifique se os', 'helv', 11)); y += 27
linhas.append((40, y, 'conjuntos a seguir sao disjuntos: (a) os complementares de A e de B; (b) A * C e B * C.', 'helv', 11)); y += 30
for n in range(4, 9):
  linhas.append((40, y, f'{n}. Mostre que o conjunto das partes de um conjunto com {n} elementos tem 2^{n} elementos.', 'helv', 11)); y += 20
  linhas.append((80, y, f'P = 2 ^ {n}', 'helv', 11)); y += 30
pagina = doc.new_page()
for x, yy, texto, fonte, tamanho in linhas:
  pagina.insert_text((x, yy), texto, fontname=fonte, fontsize=tamanho)
pagina = doc.new_page()
pagina.insert_text((40, 70), 'Referencias', fontname='hebo', fontsize=22)
pagina.insert_text((40, 110), 'JAMES, B. R. Probabilidade: um curso em nivel intermediario. Rio de Janeiro: IMPA, 2015.', fontsize=11)
doc.save(sys.argv[1])
`, pdf], { stdio: 'pipe' });

const { comBancoDeTeste } = await import('../db/conexao.js');
const { migrar } = await import('../db/migrar.js');

await comBancoDeTeste('capturas_j141', async (banco: pg.Pool) => {
  await migrar(banco);
  const { comTransacao } = await import('../db/transacao.js');
  const { criarApi } = await import('../http/app.js');
  const { servirWeb } = await import('../http/estatico.js');
  const { raizDoRepositorio } = await import('../dados.js');
  const { manipuladorCanonizar, TIPO_CANONIZAR } = await import('../worker/canonizar.js');
  const { FilaPostgres } = await import('../worker/fila-postgres.js');
  const { Worker } = await import('../worker/worker.js');
  const { importarMarcasLegado } = await import('../leitura/importar.js');
  const resolucoes = await import('../repos/resolucoes.js');
  const { configurar } = await import('../../testes/compreensao.js');
  const temporarios: string[] = [];
  const { config } = await configurar(banco, temporarios);
  const api = criarApi({ banco, leitura: () => { throw new Error('As capturas não iniciam leituras.'); }, compreensao: () => config });
  servirWeb(api, join(raiz, 'web/dist'));

  async function enviar(nome: string, formato: string, tipo: string, conteudo: Buffer | string, titulo: string): Promise<string> {
    const formulario = new FormData();
    formulario.set('titulo', titulo);
    formulario.set('formato', formato);
    formulario.set('arquivo', new File([conteudo], nome, { type: tipo }));
    const envio = await api.request('/api/documentos', { method: 'POST', headers: { 'X-Margem': '1' }, body: formulario });
    assert.equal(envio.status, 202, await envio.clone().text());
    const { documento_id } = await envio.json() as { documento_id: string };
    const vagas = mkdtempSync(join(tmpdir(), 'margem-j141-vagas-'));
    await new Worker({
      fila: new FilaPostgres(banco), manipuladores: { [TIPO_CANONIZAR]: manipuladorCanonizar({ banco, raiz: raizDoRepositorio(), prazoMs: 120_000 }) },
      diretorioSlots: vagas, slots: 1, intervaloMs: 5, maximoCiclos: 1,
    }).rodar();
    return documento_id;
  }
  const lista = await enviar('lista1.pdf', 'pdf', 'application/pdf', readFileSync(pdf), 'Lista1');
  const conto = await enviar('um-apologo.md', 'md', 'text/markdown', readFileSync(join(raiz, 'web/src/onboarding/exemplo/um-apologo.md'), 'utf8'), 'Um apólogo');
  // Um terceiro documento sem o preparo automático: a página mostra "Analisar" pronto para o clique.
  await api.request('/api/configuracoes/preparacao', { method: 'PUT', headers: { 'X-Margem': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ ao_importar: false, itens: ['grifos_relacoes'] }) });
  const ensaio = await enviar('ensaio.md', 'md', 'text/markdown', readFileSync(join(raiz, 'web/src/onboarding/exemplo/um-apologo.md'), 'utf8').replace('# Um apólogo', '# Um apólogo (sem análise)'), 'Um apólogo (sem análise)');

  // Marcas no conto (o caminho legado grava como camada de importação).
  const versaoDoConto = (await banco.query<{ id: string }>('SELECT id FROM versao_texto WHERE documento_id=$1', [conto])).rows[0]!.id;
  const marca = (id: string, funcao: 'tese' | 'conceito' | 'justificativa', citacao: string, texto: string) =>
    ({ id, pagina_pdf: 1, funcao, citacao, sublinhar: [], comentario: { tipo: 'LEITURA' as const, rotulo: '→ LEITURA', texto } });
  await importarMarcasLegado(banco, versaoDoConto, { capitulo: '1', leitura_integral: true, limites: [], recuperacao: [], marcas: [
    marca('m01', 'conceito', 'toda cheia de si, toda enrolada', 'A forma do novelo dá corpo ao orgulho que a agulha acusa.'),
    marca('m02', 'tese', 'Agulha não tem cabeça.', 'A linha devolve o golpe com um trocadilho.'),
    marca('m03', 'justificativa', 'obedecendo ao que eu faço e mando', 'A agulha inverte a hierarquia.'),
  ] });

  // Um exercício já resolvido na lista (o recorte do exercício 3), sem Codex: a sessão nasce pronta.
  const versaoDaLista = (await banco.query<{ id: string }>('SELECT id FROM versao_texto WHERE documento_id=$1', [lista])).rows[0]!.id;
  const sessao: ResolucaoV2 = {
    versao: 2, id: ulid(), documento_id: lista, versao_id: versaoDaLista,
    origem: { tipo: 'recorte', pagina: 1, retangulo: { x: .05, y: .3, largura: .85, altura: .08 }, imagem_sha256: 'a'.repeat(64) },
    texto_extraido: '3. Sejam A, B e C subconjuntos de Omega. Se A e B são conjuntos disjuntos, verifique se os conjuntos a seguir são disjuntos.',
    resolucao: {
      enunciado: '3. Sejam $A$, $B$ e $C$ subconjuntos de $\\Omega$. Se $A$ e $B$ são conjuntos disjuntos, verifique se os conjuntos a seguir são disjuntos: (a) $A^c$ e $B^c$; (b) $A \\cap C$ e $B \\cap C$.',
      legibilidade: 'boa', conceitos: ['conjuntos disjuntos'], observacao: null,
      itens: [{ rotulo: '', enunciado: 'Verifique se os conjuntos são disjuntos.', estrategia: 'Dois conjuntos são disjuntos quando sua interseção é vazia. Vamos testar cada par a partir de $A \\cap B = \\emptyset$.',
        passos: [{ texto: 'Calcule a interseção.', calculo: null }], resposta: '(a) não necessariamente; (b) sim.', verificacao: null }],
    },
    execucao: { modelo: 'teste', esforco: 'medio' }, mensagens: [], criada_em: new Date().toISOString(),
  };
  await comTransacao(banco, (cliente) => resolucoes.criar(cliente, sessao));

  assert.ok((await api.request('/api/estado-instalacao/concluir', { method: 'POST', headers: { 'X-Margem': '1' } })).ok);
  await new Promise<void>((pronto) => { serve({ fetch: api.fetch, hostname: '127.0.0.1', port: PORTA }, (info: AddressInfo) => { console.log(`no ar: ${String(info.port)}`); pronto(); }); });

  const navegador = await chromium.launch();
  const foto = (pagina: Page, nome: string) => pagina.screenshot({ path: join(pasta, `${nome}.png`) });
  try {
    for (const [tema, esquema] of [['claro', 'light'], ['escuro', 'dark']] as const) for (const largura of [1680, 390]) {
      const contexto = await navegador.newContext({ viewport: { width: largura, height: largura > 600 ? 1000 : 844 }, colorScheme: esquema, reducedMotion: 'reduce' });
      // Onboarding concluído: as capturas mostram a tela de uso, sem o tour por cima.
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
      // Com MARGEM_ESPERA_DO_TIPO_S curto, a página mostra a análise que seguiu sem o tipo (V-T4).
      await pagina.goto(`${API}/documentos/${lista}`); await pagina.waitForTimeout(Number(process.env.MARGEM_ESPERA_DO_TIPO_S ?? 0) * 1000 + 1500);
      await pagina.reload(); await pagina.waitForTimeout(1500);
      await foto(pagina, `documento-lista1-${sufixo}`);
      await pagina.getByRole('button', { name: 'Opções do documento' }).click();
      await pagina.getByRole('button', { name: 'Diagnóstico' }).click(); await pagina.waitForTimeout(400);
      await foto(pagina, `diagnostico-lista1-${sufixo}`);
      await pagina.goto(`${API}/documentos/${conto}`); await pagina.waitForTimeout(1500);
      await foto(pagina, `documento-texto-${sufixo}`);
      await pagina.goto(`${API}/documentos/${ensaio}`); await pagina.waitForTimeout(1500);
      await foto(pagina, `documento-nao-analisado-${sufixo}`);
      const analisar = pagina.getByRole('button', { name: 'Analisar', exact: true });
      if (await analisar.count()) {
        await analisar.click(); await pagina.waitForTimeout(800);
        await foto(pagina, `janela-analisar-${sufixo}`);
        await pagina.keyboard.press('Escape');
      }
      await pagina.goto(`${API}/ler/${conto}`); await pagina.waitForTimeout(2000);
      await foto(pagina, `leitor-inicio-${sufixo}`);
      const marcas = pagina.getByRole('button', { name: 'Marcas', exact: true });
      if (await marcas.count()) {
        await marcas.click(); await pagina.waitForTimeout(500);
        await foto(pagina, `leitor-marcas-ocultas-${sufixo}`);
        await marcas.click(); await pagina.waitForTimeout(300);
      }
      await pagina.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)'); await pagina.waitForTimeout(800);
      await foto(pagina, `leitor-fim-${sufixo}`);
      if (largura > 600) {
        await pagina.goto(`${API}/ler/${lista}`); await pagina.waitForTimeout(3000);
        const nota = pagina.locator('.nota-do-exercicio').first();
        if (await nota.count()) {
          await nota.scrollIntoViewIfNeeded(); await nota.hover(); await pagina.waitForTimeout(500);
          await foto(pagina, `previa-resolucao-${sufixo}`);
        } else console.log('sem nota de exercício na página');
        await pagina.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)'); await pagina.waitForTimeout(800);
        await foto(pagina, `leitor-pdf-fim-${sufixo}`);
      }
      await pagina.goto(`${API}/configuracoes`); await pagina.waitForTimeout(1200);
      await pagina.screenshot({ path: join(pasta, `configuracoes-${sufixo}.png`), fullPage: true });
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }
  process.exit(0);
});
