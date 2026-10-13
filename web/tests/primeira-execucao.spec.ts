/**
 * Capturas da primeira execução de uma instalação local (J103) sobre `dist`. Toda rota /api é
 * interceptada: não há serviço, banco nem Codex. O exemplo usa o canônico congelado e as marcas
 * semeadas do serviço (`servico/src/primeira-execucao/exemplo/`), os mesmos dados que a rota
 * `POST /api/estado-instalacao/exemplo` grava.
 * Saída: docs/ui-revisao/primeira-execucao/<tema>-<largura>-<nn>-<nome>.png
 */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';
import type { Bloco, ModoDeLeituraV1, Secao } from '@margem/contratos';
import type { SnapshotDoCapitulo } from '../src/biblioteca/tipos.ts';
import type { EstadoDaInstalacao } from '../src/primeira-execucao/estado.ts';
import { INSTALACAO_PRONTA } from './estado-instalacao.ts';

const raiz = resolve('..');
const pastaDoExemplo = join(raiz, 'servico/src/primeira-execucao/exemplo');
const canonico = JSON.parse(readFileSync(join(pastaDoExemplo, 'um-apologo.canonico.json'), 'utf8')) as { blocos: Bloco[]; secoes: Secao[] };
const semeadas = JSON.parse(readFileSync(join(pastaDoExemplo, 'um-apologo.marcas.json'), 'utf8')) as { citacao: string; funcao: string; comentario: unknown }[];
const j18 = JSON.parse(readFileSync(new URL('./fixtures/j18.json', import.meta.url), 'utf8')) as { snapshot: SnapshotDoCapitulo; modos: ModoDeLeituraV1[] };

const DOC = '0000000000000000000000EX01';
const VERSAO = '0000000000000000000000VR01';
const CAMADA = '0000000000000000000000CM01';
const secao = canonico.secoes[0]!;
const MARCAS = semeadas.map((marca, i) => {
  const bloco = canonico.blocos.find((b) => b.texto.includes(marca.citacao))!;
  const inicio = bloco.texto.indexOf(marca.citacao);
  return { ...j18.snapshot.marcas[0]!, id: `00000000000000000000000M${String(i).padStart(2, '0')}`, funcao: marca.funcao, saliencia: 1,
    camada_id: CAMADA, modo: { id: 'argumentativa', revisao: 1 }, origem: 'importacao', comentario: marca.comentario,
    ancora: { versao_id: VERSAO, bloco_id: bloco.id, inicio_utf16: inicio, fim_utf16: inicio + marca.citacao.length, citacao: marca.citacao,
      prefixo: bloco.texto.slice(Math.max(0, inicio - 32), inicio), sufixo: bloco.texto.slice(inicio + marca.citacao.length, inicio + marca.citacao.length + 32) } };
});
const SNAPSHOT = { ...j18.snapshot, documento_id: DOC, versao_id: VERSAO,
  secao: { id: secao.id, titulo: secao.titulo, ordem: 0, nivel: 1, bloco_inicio: secao.bloco_inicio, bloco_fim: secao.bloco_fim },
  blocos: canonico.blocos, marcas: MARCAS, camada: CAMADA,
  camadas: [{ id: CAMADA, tipo: 'importacao', modo: { id: 'argumentativa', revisao: 1 }, criada_em: '2026-10-12T12:00:00Z', marcas: MARCAS.length }],
  anotacoes: [], conversas: [], conexoes: [] } as unknown as SnapshotDoCapitulo;

const ITEM = { id: DOC, titulo: 'Um apólogo', autor: 'Machado de Assis', formato: 'md', criado_em: '2026-10-12T12:00:00Z', arquivado_em: null,
  versao_id: VERSAO, texto_disponivel: true, estado: 'pronto', detalhe: null, partes_prontas: 0, partes_total: 0,
  marcas: { tese: 2, conceito: 1, justificativa: 2, nenhuma: 1, total: MARCAS.length }, progresso: null, jobs_em_curso: 0, midia: null };

const pendente = (estado: EstadoDaInstalacao): EstadoDaInstalacao => ({ ...estado, primeira_execucao: { concluida: false, concluida_em: null, exemplo_documento_id: null } });
const codex = (mudanca: Partial<EstadoDaInstalacao['codex']>, pronto = false): EstadoDaInstalacao => ({ ...INSTALACAO_PRONTA, codex: { ...INSTALACAO_PRONTA.codex, ...mudanca }, pronto });
const DESLOGADO = codex({ logado: false, conta: null });
const AUSENTE = codex({ encontrado: false, versao: null, compativel: false, logado: null, conta: null });
const COTA: EstadoDaInstalacao = { ...INSTALACAO_PRONTA, cota: { esgotada: true, volta_em: new Date(Date.now() + 2 * 3_600_000).toISOString() } };

const pasta = resolve('../docs/ui-revisao/primeira-execucao');
mkdirSync(pasta, { recursive: true });
const PORTA = 5203;
const servidor = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: PORTA, strictPort: true } });
const base = `http://127.0.0.1:${String(PORTA)}`;
const erros: string[] = [];

interface Cena { estado: EstadoDaInstalacao; documentos: boolean; escritas: string[] }
async function simular(pagina: Page, cena: Cena): Promise<void> {
  pagina.on('pageerror', (e) => erros.push(e.stack ?? e.message));
  await pagina.route('**/*', async (rota) => {
    const url = new URL(rota.request().url());
    if (url.origin !== base) return rota.abort();
    if (!url.pathname.startsWith('/api/')) return rota.continue();
    const caminho = url.pathname; const metodo = rota.request().method();
    const responder = (json: unknown, status = 200) => rota.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (metodo === 'POST') cena.escritas.push(caminho);
    if (caminho === '/api/estado-instalacao') return responder(cena.estado);
    if (caminho === '/api/estado-instalacao/exemplo') { cena.documentos = true; return responder({ documento_id: DOC, versao_id: VERSAO, marcas: MARCAS.length, criado: true }, 201); }
    if (caminho === '/api/estado-instalacao/concluir') {
      cena.estado = { ...cena.estado, primeira_execucao: { ...cena.estado.primeira_execucao, concluida: true, concluida_em: '2026-10-12T12:00:00.000Z' } };
      return responder({ concluida: true, concluida_em: '2026-10-12T12:00:00.000Z' });
    }
    if (caminho === '/api/documentos') return responder({ documentos: cena.documentos && url.searchParams.get('arquivados') !== '1' ? [ITEM] : [] });
    if (caminho === `/api/documentos/${DOC}`) return responder({ ...ITEM, versoes: [], execucoes: [], jobs: [], exportacoes: [] });
    if (caminho === '/api/modos') return responder({ modos: j18.modos });
    if (caminho.endsWith('/progresso')) return metodo === 'GET' ? responder({ progresso: null }) : responder({ progresso: null }, 503);
    if (caminho.endsWith('/secoes')) return responder({ versao_id: VERSAO, documento_id: DOC, titulo: 'Um apólogo', secoes: [], capitulos: [{ id: secao.id, titulo: secao.titulo }], limites: [] });
    if (caminho.endsWith('/midias')) return responder({ midias: [] });
    if (caminho.endsWith('/audios')) return responder({ audios: [] });
    if (caminho.endsWith('/visuais')) return responder({ visuais: [] });
    if (caminho.includes('/capitulos/')) return responder(SNAPSHOT);
    if (caminho.endsWith('/camadas')) return responder({ camadas: [], preferencias: { primeiro_eu: false, camada_padrao: null } });
    if (caminho.endsWith('/compreensoes')) return responder({ versao_id: VERSAO, compreensoes: [] });
    if (caminho.endsWith('/etiquetas')) return responder({ etiquetas: [], sugestoes: [] });
    if (caminho.endsWith('/resolucoes')) return responder({ resolucoes: [] });
    if (caminho === '/api/perfil') return responder({ perfil: null, hash: '' });
    if (caminho === '/api/execucoes/ativas') return responder({ versao: 1, gerado_em: new Date().toISOString(), execucoes: [], omitidas: 0 });
    if (caminho === '/api/eventos' || caminho === '/api/execucoes/eventos') return rota.fulfill({ contentType: 'text/event-stream', body: 'retry: 600000\n\n' });
    if (caminho.startsWith('/api/noticias')) return responder({ edicoes: [] });
    if (caminho === '/api/arte') return responder({ obras: [] });
    erros.push(`Rota não simulada: ${metodo} ${caminho}`);
    return responder({});
  });
}
async function captura(pagina: Page, prefixo: string, nome: string): Promise<void> {
  await pagina.evaluate(() => document.fonts.ready);
  await pagina.waitForTimeout(200);
  assert.equal(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `sem rolagem horizontal em ${nome}`);
  // Regra do repositório: nenhum componente com faixa lateral.
  const lateral = await pagina.evaluate(() => [...document.querySelectorAll('.boas-vindas-da-instalacao *, .aviso-da-instalacao, .aviso-da-instalacao *')]
    .filter((e) => parseFloat(getComputedStyle(e).borderLeftWidth) > 0 && parseFloat(getComputedStyle(e).borderRightWidth) === 0).length);
  assert.equal(lateral, 0, `sem borda só à esquerda em ${nome}`);
  await pagina.screenshot({ path: join(pasta, `${prefixo}-${nome}.png`) });
  console.log(`captura: ${prefixo}-${nome}.png`);
}
const onboardingVisto = JSON.stringify({ versao: 1, boas_vindas: 'concluida', tela: 0,
  primeiro_documento: { estado: 'concluida', origem: 'exemplo', documento_id: DOC }, exemplo_id: DOC, tour: 'concluida', dica: 0, levar: 'pendente',
  atualizado_em: '2026-10-12T12:00:00.000Z' });

const navegador = await chromium.launch();
try {
  for (const colorScheme of ['light', 'dark'] as const) for (const [tela, width, height] of [['1680', 1680, 1050], ['390', 390, 844]] as const) {
    const prefixo = `${colorScheme === 'dark' ? 'escuro' : 'claro'}-${tela}`;
    const contexto = await navegador.newContext({ viewport: { width, height }, colorScheme, reducedMotion: 'reduce' });

    // 1. Instalação nova, Codex sem login: o diálogo diz o que falta e dá o comando.
    const pagina = await contexto.newPage();
    pagina.setDefaultTimeout(15000);
    const cena: Cena = { estado: pendente(DESLOGADO), documentos: false, escritas: [] };
    await simular(pagina, cena);
    await pagina.goto(`${base}/`);
    const dialogo = pagina.locator('.boas-vindas-da-instalacao[role=dialog]');
    await dialogo.waitFor();
    await dialogo.getByText('docker compose exec worker codex login --device-auth').waitFor();
    assert.equal(await pagina.locator('.boas-vindas:not(.boas-vindas-da-instalacao)').count(), 0, 'as boas-vindas do onboarding não se sobrepõem');
    await captura(pagina, prefixo, '01-boas-vindas-sem-login');
    // "Verificar de novo" depois do login: a lista fica pronta.
    cena.estado = pendente(INSTALACAO_PRONTA);
    await dialogo.getByRole('button', { name: 'Verificar de novo' }).click();
    await dialogo.getByRole('heading', { name: 'Tudo pronto para ler' }).waitFor();
    await captura(pagina, prefixo, '02-boas-vindas-pronto');
    // O exemplo já marcado abre no leitor e a primeira execução fica concluída.
    await dialogo.getByRole('button', { name: /Abrir o exemplo já marcado/ }).click();
    await pagina.waitForURL(/\/ler\//);
    assert.deepEqual(cena.escritas, ['/api/estado-instalacao/exemplo', '/api/estado-instalacao/concluir']);
    await pagina.locator('.camada-de-marcas path').first().waitFor();
    // O tour do leitor (onboarding) aparece na primeira abertura; Esc o pula para a captura do texto.
    if (await pagina.locator('.dica-ancorada').count()) await pagina.keyboard.press('Escape');
    assert.equal(await pagina.locator('.camada-de-marcas path').count() > 0, true);
    await captura(pagina, prefixo, '03-exemplo-marcado');
    await pagina.goto(`${base}/`);
    await pagina.getByRole('heading', { level: 1 }).first().waitFor();
    assert.equal(await pagina.locator('.boas-vindas-da-instalacao').count(), 0, 'concluída, a tela não volta');
    await pagina.close();

    // 2. Codex ausente: a tela diz como instalar (com e sem Docker).
    const ausente = await contexto.newPage();
    await simular(ausente, { estado: pendente(AUSENTE), documentos: false, escritas: [] });
    await ausente.goto(`${base}/`);
    await ausente.locator('.boas-vindas-da-instalacao').getByText('O Codex não está instalado aqui.').waitFor();
    await captura(ausente, prefixo, '04-boas-vindas-sem-codex');
    await ausente.close();

    // 3. Depois de concluída: a faixa no Início quando o login cai, e o aviso onde se pede a leitura.
    const faixa = await contexto.newPage();
    await faixa.addInitScript((valor) => { localStorage.setItem('margem:onboarding:v1:local', valor); }, onboardingVisto);
    await simular(faixa, { estado: DESLOGADO, documentos: true, escritas: [] });
    await faixa.goto(`${base}/`);
    await faixa.getByRole('status', { name: 'Aviso da instalação' }).waitFor();
    await captura(faixa, prefixo, '05-faixa-sem-login');
    await faixa.goto(`${base}/documentos/${DOC}`);
    await faixa.getByRole('button', { name: /Preparar leitura/ }).first().click();
    await faixa.locator('.aviso-do-codex-curto').waitFor();
    await captura(faixa, prefixo, '06-preparar-leitura-sem-login');
    await faixa.close();

    // 4. Cota esgotada: a leitura espera sozinha.
    const cota = await contexto.newPage();
    await cota.addInitScript((valor) => { localStorage.setItem('margem:onboarding:v1:local', valor); }, onboardingVisto);
    await simular(cota, { estado: COTA, documentos: true, escritas: [] });
    await cota.goto(`${base}/biblioteca`);
    await cota.getByRole('status', { name: 'Aviso da instalação' }).getByText(/A cota do Codex da sua conta acabou por agora/).waitFor();
    await captura(cota, prefixo, '07-faixa-cota');
    await cota.goto(`${base}/primeiros-passos`);
    await cota.getByRole('heading', { name: 'Esta instalação' }).waitFor();
    await cota.locator('#instalacao').scrollIntoViewIfNeeded();
    await captura(cota, prefixo, '08-primeiros-passos-checagem');
    await cota.close();
    await contexto.close();
  }
  assert.deepEqual(erros, []);
  console.log('primeira execução: capturas conferidas');
} finally {
  await navegador.close();
  await new Promise<void>((resolver) => { servidor.httpServer.close(() => resolver()); });
}
