/**
 * Capturas da sala de teste com o serviço de verdade, num Postgres descartável (`margem_test_*`,
 * criado e destruído aqui; a produção nunca é tocada) e dados falsos: textos de domínio público
 * canonizados pelo motor, marcas "da IA" importadas pelo caminho legado, testadores inventados.
 *
 * Sobe a API principal em 127.0.0.1:8761 (a tela do dono) e o portão em 127.0.0.1:5206 (o
 * testador), no mesmo processo. Também confere, no navegador, que o leitor no modo sala não pede
 * nada fora da lista do portão (todo 404 vira falha).
 *
 * Uso (da raiz, depois de `npm run build --workspace web`):
 *   npx vite-node -c servico/vitest.config.ts servico/src/ferramentas/capturar-sala-de-teste.ts
 * Saída: docs/ui-revisao/sala-de-teste/<tema>-<largura>-<nn>-<tela>.png
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import { chromium, type BrowserContext, type Page } from 'playwright';
import type pg from 'pg';
import { FORMULARIO_PADRAO_DA_SALA, type CanonicoV1, type SalaDeTesteV1 } from '@margem/contratos';

const raiz = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const pasta = join(raiz, 'docs/ui-revisao/sala-de-teste');
mkdirSync(pasta, { recursive: true });
const dados = mkdtempSync(join(tmpdir(), 'margem-sala-capturas-'));
process.env.MARGEM_DADOS = dados;
process.env.MARGEM_PORTA = '8761';
process.env.MARGEM_PORTAO_URL = 'http://127.0.0.1:5206';
const API = 'http://127.0.0.1:8761';
const PORTAO = 'http://127.0.0.1:5206';
const SENHA = 'chave-de-teste-2026';

function canonizar(arquivo: string, titulo: string, autor: string, poesia: boolean): CanonicoV1 {
  const saida = mkdtempSync(join(tmpdir(), 'margem-sala-canonico-'));
  execFileSync(join(raiz, 'motor/.venv/bin/python'), ['-c', `
import sys
from pathlib import Path
from margem_motor.ingest import canonizar
canonizar(Path(sys.argv[1]), 'md', Path(sys.argv[2]), titulo=sys.argv[3], autor=sys.argv[4], idioma='pt', poesia=sys.argv[5] == '1')
`, join(raiz, arquivo), join(saida, 'versao'), titulo, autor, poesia ? '1' : '0'], { cwd: raiz, env: { ...process.env, PYTHONPATH: join(raiz, 'motor') }, stdio: 'pipe' });
  const canonico = JSON.parse(readFileSync(join(saida, 'versao/canonico.json'), 'utf8')) as CanonicoV1;
  rmSync(saida, { recursive: true, force: true });
  return canonico;
}

const { comBancoDeTeste } = await import('../db/conexao.js');
const { migrar } = await import('../db/migrar.js');

await comBancoDeTeste('capturas_sala', async (banco: pg.Pool) => {
  await migrar(banco);
  const { comTransacao } = await import('../db/transacao.js');
  const documentosRepo = await import('../repos/documentos.js');
  const { importarMarcasLegado } = await import('../leitura/importar.js');
  const { criarApi } = await import('../http/app.js');
  const { servirWeb } = await import('../http/estatico.js');
  const { criarPortao } = await import('../sala/portao.js');

  async function documento(arquivo: string, titulo: string, autor: string, poesia = false): Promise<{ id: string; versao: string; canonico: CanonicoV1 }> {
    const canonico = canonizar(arquivo, titulo, autor, poesia);
    return comTransacao(banco, async (cliente) => {
      const doc = await documentosRepo.criar(cliente, { ...canonico.documento, origem_caminho: join(dados, `${titulo}.md`) });
      const versao = await documentosRepo.criarVersao(cliente, doc.id, canonico);
      return { id: doc.id, versao: versao.id, canonico };
    });
  }
  const apologo = await documento('web/src/onboarding/exemplo/um-apologo.md', 'Um apólogo', 'Machado de Assis');
  const circulo = await documento('fixtures/poesia/circulo-vicioso.md', 'Círculo vicioso', 'Machado de Assis', true);
  await documento('fixtures/poesia/a-carolina.md', 'A Carolina', 'Machado de Assis', true);
  await documento('fixtures/poesia/soneto-de-natal.md', 'Soneto de Natal', 'Machado de Assis', true);

  type Comentario = { tipo: 'AUTOR' | 'LEITURA' | 'INVESTIGAR' | 'OBJECAO' | 'CONEXAO'; rotulo: string; texto: string };
  const marca = (id: string, funcao: 'tese' | 'conceito' | 'justificativa' | 'nenhuma', citacao: string, comentario: Comentario | null) =>
    ({ id, pagina_pdf: 1, funcao, citacao, sublinhar: [], comentario });
  const relatorio = await importarMarcasLegado(banco, apologo.versao, { capitulo: '1', leitura_integral: true, limites: [], recuperacao: [], marcas: [
    marca('m01', 'conceito', 'toda cheia de si, toda enrolada', { tipo: 'LEITURA', rotulo: '→ LEITURA', texto: 'A forma do novelo dá corpo ao orgulho que a agulha acusa.' }),
    marca('m02', 'tese', 'Agulha não tem cabeça.', { tipo: 'AUTOR', rotulo: 'AUTOR · TESE', texto: 'A linha devolve o golpe com um trocadilho e passa a dominar a conversa.' }),
    marca('m03', 'justificativa', 'obedecendo ao que eu faço e mando', { tipo: 'AUTOR', rotulo: 'AUTOR · MECANISMO', texto: 'A agulha inverte a hierarquia: abrir caminho seria mandar.' }),
    marca('m04', 'conceito', 'Também os batedores vão adiante do imperador.', { tipo: 'CONEXAO', rotulo: '↔ CONEXÃO', texto: 'Quem vai à frente nem sempre é quem manda: o cortejo serve a quem vem atrás.' }),
  ] });
  assert.ok(relatorio.contagem.gravadas >= 3, 'as marcas do apólogo foram gravadas');
  await importarMarcasLegado(banco, circulo.versao, { capitulo: '1', leitura_integral: true, limites: [], recuperacao: [], marcas: [
    marca('m01', 'tese', 'Quem me dera que fosse aquela loura estrela', { tipo: 'LEITURA', rotulo: '→ LEITURA', texto: 'Cada ser deseja ser o seguinte: o círculo do título.' }),
  ] }).catch(() => undefined);

  const api = criarApi({ banco, leitura: () => { throw new Error('As capturas não iniciam leituras.'); } });
  servirWeb(api, join(raiz, 'web/dist'));
  const portao = criarPortao({ banco, chave: randomBytes(32), raizWeb: join(raiz, 'web/dist') });
  const servidores: ServerType[] = [];
  const subir = (app: { fetch: (r: Request, ...resto: never[]) => Response | Promise<Response> }, porta: number) => new Promise<void>((pronto) => {
    servidores.push(serve({ fetch: app.fetch as never, hostname: '127.0.0.1', port: porta }, (info: AddressInfo) => { console.log(`no ar: ${String(info.port)}`); pronto(); }));
  });
  await subir(api, 8761);
  await subir(portao, 5206);

  const json = async <T>(url: string, init: RequestInit = {}): Promise<{ status: number; corpo: T; cookie: string }> => {
    const resposta = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', 'X-Margem': '1', ...(init.headers as Record<string, string> | undefined) } });
    return { status: resposta.status, corpo: await resposta.json() as T, cookie: (resposta.headers.get('set-cookie') ?? '').split(';')[0] ?? '' };
  };
  const porDocumento = [
    { id: 'clareza', tipo: 'escala', enunciado: 'As notas deste texto foram claras?', obrigatoria: false, rotulos: { minimo: 'Confusas', maximo: 'Claras' } },
    { id: 'nota_mais_util', tipo: 'texto_curto', enunciado: 'Qual nota ou marca foi a mais útil?', obrigatoria: false },
  ];
  const criar = async (titulo: string, documentos: string[]) => {
    const { status, corpo } = await json<{ sala: SalaDeTesteV1 }>(`${API}/api/salas`, { method: 'POST', body: JSON.stringify({
      titulo, documentos, senha: SENHA, expira_em: '2026-10-31T23:59:00-03:00',
      boas_vindas: 'Obrigado por topar! São dois textos curtos do Machado de Assis. Leia com calma, comente o que quiser nos trechos e, no fim, responda o formulário. Leva uns 15 minutos.',
      formulario: { versao: 1, geral: FORMULARIO_PADRAO_DA_SALA.geral, por_documento: porDocumento },
    }) });
    assert.equal(status, 201);
    return corpo.sala;
  };
  const principal = await criar('Beta · primeira rodada', [apologo.id, circulo.id]);
  const capturas = await criar('Beta · segunda rodada', [apologo.id, circulo.id]);

  // Três testadores falsos na sala principal: duas respostas enviadas, um rascunho, comentários nos trechos.
  const bloco = (canonico: CanonicoV1, trecho: string) => {
    const achado = canonico.blocos.find((b) => b.texto.includes(trecho));
    assert.ok(achado, trecho);
    const inicio = achado.texto.indexOf(trecho);
    return { bloco_id: achado.id, inicio_utf16: inicio, fim_utf16: inicio + trecho.length, citacao: trecho };
  };
  const testadores = [
    { nome: 'Ana Lima', email: 'ana@exemplo.com', enviar: true, geral: { primeira_impressao: 5, marcas_ajudaram: 4, usaria_de_novo: 'Sim', o_que_confundiu: 'No começo não entendi que o número na margem abria a nota.', o_que_faltou: 'Poder marcar eu mesma.' },
      por_documento: { [apologo.id]: { clareza: 5, nota_mais_util: 'A do trocadilho da cabeça.' } },
      comentarios: [[apologo, 'Agulha não tem cabeça.', 'Essa nota mudou como li o resto do conto.'], [apologo, 'Estavam nisto, quando a costureira chegou', 'Aqui eu queria uma nota sobre a virada da cena.']] },
    { nome: 'Bruno Reis', email: '', enviar: true, geral: { primeira_impressao: 4, marcas_ajudaram: 3, usaria_de_novo: 'Talvez', o_que_confundiu: 'As cores das marcas: não sabia o que cada uma queria dizer.' },
      por_documento: { [circulo.id]: { clareza: 3 } }, comentarios: [[circulo, 'Quem me dera que fosse aquela loura estrela', 'Bonito, mas a nota explica demais.']] },
    { nome: 'Carla Dias', email: 'carla@exemplo.com', enviar: false, geral: { primeira_impressao: 4 }, por_documento: {}, comentarios: [] },
  ] as const;
  for (const testador of testadores) {
    const entrada = await json(`${PORTAO}/api/salas/publico/${principal.slug}/entrar`, { method: 'POST', body: JSON.stringify({ nome: testador.nome, senha: SENHA, ...(testador.email ? { email: testador.email } : {}) }) });
    assert.equal(entrada.status, 200, `entrada de ${testador.nome}`);
    for (const [doc, trecho, texto] of testador.comentarios) {
      const criado = await json(`${PORTAO}/api/salas/publico/${principal.slug}/comentarios`, { method: 'POST', headers: { Cookie: entrada.cookie },
        body: JSON.stringify({ versao_id: doc.versao, ...bloco(doc.canonico, trecho), texto }) });
      assert.equal(criado.status, 201, `comentário de ${testador.nome}`);
    }
    const gravado = await json(`${PORTAO}/api/salas/publico/${principal.slug}/respostas`, { method: 'PUT', headers: { Cookie: entrada.cookie },
      body: JSON.stringify({ geral: testador.geral, por_documento: testador.por_documento, enviar: testador.enviar }) });
    assert.equal(gravado.status, 200, `respostas de ${testador.nome}`);
  }

  const navegador = await chromium.launch();
  const problemas: string[] = [];
  async function captura(pagina: Page, prefixo: string, nome: string, inteira = false): Promise<void> {
    // Sem DOM no tsconfig do serviço: o que roda na página vai como texto.
    await pagina.evaluate('document.fonts.ready');
    await pagina.waitForTimeout(250);
    const largura = await pagina.evaluate<number[]>('[document.documentElement.scrollWidth, innerWidth]');
    if ((largura[0] ?? 0) > (largura[1] ?? 0) + 1) problemas.push(`rolagem horizontal em ${prefixo}-${nome} (${String(largura[0])} > ${String(largura[1])})`);
    await pagina.screenshot({ path: join(pasta, `${prefixo}-${nome}.png`), fullPage: inteira });
    console.log(`captura: ${prefixo}-${nome}.png`);
  }
  const vigiar = (pagina: Page, onde: string) => {
    pagina.on('response', (resposta) => { if (resposta.status() >= 400) problemas.push(`${onde}: ${String(resposta.status())} ${resposta.request().method()} ${new URL(resposta.url()).pathname}`); });
    pagina.on('pageerror', (erro) => problemas.push(`${onde}: erro de página ${erro.message}`));
  };
  const onboardingVisto = JSON.stringify({ versao: 1, boas_vindas: 'concluida', tela: 0, primeiro_documento: { estado: 'concluido', origem: 'importado', documento_id: apologo.id },
    exemplo_id: null, tour: 'concluido', dica: 0, levar: 'concluido', atualizado_em: '2026-10-01T12:00:00.000Z' });

  try {
    for (const colorScheme of ['light', 'dark'] as const) for (const [tela, width, height] of [['1680', 1680, 1050], ['390', 390, 844]] as const) {
      const prefixo = `${colorScheme === 'dark' ? 'escuro' : 'claro'}-${tela}`;
      const estreita = width < 600;
      // ------------------------------------------------ testador (portão)
      const testador: BrowserContext = await navegador.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce', locale: 'pt-BR' });
      const t = await testador.newPage();
      vigiar(t, `testador ${prefixo}`);
      await t.goto(`${PORTAO}/t/${capturas.slug}`);
      await t.getByRole('button', { name: 'Entrar' }).waitFor();
      await t.getByLabel('Seu nome').fill('Ana Souza');
      await t.getByLabel('Senha').fill(SENHA);
      await captura(t, prefixo, '01-entrada');
      await t.getByRole('button', { name: 'Entrar' }).click();
      await t.getByRole('heading', { name: 'Beta · segunda rodada' }).waitFor();
      await captura(t, prefixo, '02-capa', true);
      await t.getByRole('link', { name: 'Um apólogo' }).click();
      await t.locator('.capitulo [data-bloco]').first().waitFor();
      await t.waitForTimeout(600);
      await captura(t, prefixo, '03-leitor');
      // Seleciona um trecho no texto: a barra mostra só "Comentar".
      await t.evaluate(`(() => {
        const alvo = 'quando a costureira chegou à casa da baronesa';
        const caminhante = document.createTreeWalker(document.querySelector('.capitulo'), NodeFilter.SHOW_TEXT);
        for (let no = caminhante.nextNode(); no; no = caminhante.nextNode()) {
          const indice = (no.textContent || '').indexOf(alvo);
          if (indice < 0) continue;
          no.parentElement.scrollIntoView({ block: 'center' });
          const faixa = document.createRange(); faixa.setStart(no, indice); faixa.setEnd(no, indice + alvo.length);
          const selecao = getSelection(); selecao.removeAllRanges(); selecao.addRange(faixa);
          return;
        }
        throw new Error('trecho não encontrado');
      })()`);
      await t.locator('.capitulo').dispatchEvent('pointerup');
      await t.locator('.barra-selecao').waitFor();
      assert.equal(await t.locator('.barra-selecao .ui-button').count(), 2, 'a barra da seleção só tem Comentar e Fechar');
      await captura(t, prefixo, '04-selecao');
      await t.getByRole('button', { name: 'Comentar' }).click();
      await t.getByRole('dialog', { name: 'Comentar o trecho' }).waitFor();
      await t.getByRole('dialog').locator('textarea').fill('A mudança de cena aqui é brusca: senti falta de uma nota explicando quem é a baronesa.');
      await captura(t, prefixo, '05-comentario');
      await t.getByRole('button', { name: 'Guardar comentário' }).click();
      await t.getByText('Comentário guardado.').waitFor();
      await t.waitForTimeout(400);
      await captura(t, prefixo, '06-comentario-guardado');
      // O comentário fica na margem (ou na lista móvel) com "Apagar": apaga para a próxima variante começar igual.
      await t.goto(`${PORTAO}/t/${capturas.slug}/formulario`);
      await t.getByRole('heading', { name: 'Formulário' }).waitFor();
      await t.getByRole('radio', { name: '4' }).first().click();
      await t.getByRole('radio', { name: '5' }).nth(1).click();
      await t.getByRole('radio', { name: 'Sim' }).click();
      await t.locator('textarea').first().fill('Não achei de primeira onde ficavam as notas no celular.');
      await t.waitForTimeout(1300);
      await captura(t, prefixo, '07-formulario', true);
      const meus = await t.evaluate(async (slug) => (await (await fetch(`/api/salas/publico/${slug}/comentarios`)).json()) as { comentarios: { id: string }[] }, capturas.slug);
      for (const comentario of meus.comentarios) await t.evaluate(async ([slug, id]) => { await fetch(`/api/salas/publico/${slug}/comentarios/${id}`, { method: 'DELETE', headers: { 'X-Margem': '1' } }); }, [capturas.slug, comentario.id] as const);
      await testador.close();

      // ------------------------------------------------ dono (API principal)
      const dono = await navegador.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce', locale: 'pt-BR' });
      await dono.addInitScript((valor) => { try { localStorage.setItem('margem:onboarding:v1:local', valor); localStorage.setItem('margem:barra-lateral', 'true'); } catch { /* sem storage */ } }, onboardingVisto);
      const p = await dono.newPage();
      vigiar(p, `dono ${prefixo}`);
      await p.goto(`${API}/salas`);
      await p.getByRole('heading', { name: 'Salas de teste' }).waitFor();
      await captura(p, prefixo, '08-dono-salas');
      await p.goto(`${API}/salas/${principal.id}`);
      await p.getByRole('heading', { name: 'Beta · primeira rodada' }).waitFor();
      await p.locator('details.testador').first().locator('summary').click();
      await captura(p, prefixo, '09-dono-respostas', true);
      await p.goto(`${API}/salas/nova`);
      await p.getByRole('heading', { name: 'Nova sala de teste' }).waitFor();
      await p.getByLabel('Título').first().fill('Beta · amigos da faculdade');
      await p.getByRole('checkbox', { name: /Um apólogo/ }).click();
      await p.getByRole('checkbox', { name: /Círculo vicioso/ }).click();
      await captura(p, prefixo, '10-dono-nova-sala', true);
      await p.getByRole('button', { name: 'Criar sala' }).click();
      await p.getByText('Sala criada').waitFor();
      await captura(p, prefixo, '11-dono-convite', !estreita);
      const criada = await p.locator('.valor-copiavel').first().innerText();
      const slug = criada.split('/t/')[1] ?? '';
      const id = (await json<{ salas: SalaDeTesteV1[] }>(`${API}/api/salas`)).corpo.salas.find((s) => s.slug === slug)?.id;
      if (id) await json(`${API}/api/salas/${id}`, { method: 'DELETE' });
      await dono.close();
    }
  } finally {
    await navegador.close();
    for (const servidor of servidores) servidor.close();
  }
  // O leitor no modo sala não pode pedir nada fora da lista do portão; a tela do dono, nada que falhe.
  const ignorados = problemas.filter((p) => !/\/favicon\.ico$/.test(p));
  if (ignorados.length > 0) { console.error(ignorados.join('\n')); }
  assert.deepEqual(ignorados, [], 'pedidos que falharam nas capturas');
});
rmSync(dados, { recursive: true, force: true });
console.log('pronto: docs/ui-revisao/sala-de-teste');
