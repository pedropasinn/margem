/**
 * Capturas dos avisos das execuções do Codex com DADOS FALSOS, num banco descartável.
 *
 * Cria um banco `margem_test_captura_toasts_*` no Postgres do container, aplica as migrações,
 * semeia um documento inventado e jobs em todos os estados (sem Codex: os estados mudam pelo
 * repositório da fila), sobe a API em 127.0.0.1:8754 e o Vite em 127.0.0.1:5204, fotografa com o
 * Playwright e apaga o banco no fim. Nunca toca o banco de produção.
 *
 * Uso: npx vite-node -c servico/vitest.config.ts servico/src/ferramentas/capturar-toasts-codex.ts [pasta]
 */
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORTA_API = '8754';
const PORTA_WEB = '5204';
process.env.MARGEM_PORTA = PORTA_API;
process.env.MARGEM_ORIGENS = [PORTA_API, PORTA_WEB].flatMap((p) => [`http://127.0.0.1:${p}`, `http://localhost:${p}`]).join(',');

const raiz = fileURLToPath(new URL('../../..', import.meta.url));
const pasta = process.argv[2] ?? join(raiz, 'docs/ui-revisao/toasts-codex');
mkdirSync(pasta, { recursive: true });

const { serve } = await import('@hono/node-server');
const { chromium } = await import('playwright');
const { comBancoDeTeste } = await import('../db/conexao.js');
const { migrar } = await import('../db/migrar.js');
const { comTransacao } = await import('../db/transacao.js');
const documentos = await import('../repos/documentos.js');
const anotacoes = await import('../repos/anotacoes.js');
const jobsRepo = await import('../repos/jobs.js');
const { criarApi } = await import('../http/app.js');
const { canonicoDeTeste, idTeste } = await import('../../testes/apoio.js');
const { ancoraDeSelecao } = await import('@margem/core');

const PROSA = [
  'Toda leitura demorada começa com uma pergunta pequena, quase distraída, que o leitor faz ao texto sem perceber.',
  'O caderno inventado para estas capturas não existe fora daqui: cada frase serve apenas para encher a página com uma prosa plausível, de largura e ritmo parecidos com os de um livro.',
  'Quando a margem se enche de notas, o texto central continua no mesmo lugar, e é isso que se quer conferir: os avisos do canto não devem empurrar nem esconder o que se lê.',
  'Uma segunda passagem confirma o que a primeira apenas sugeria, e o leitor volta ao começo do parágrafo com outra pergunta.',
  'Há capítulos que se leem de uma vez e outros que pedem pausas, idas ao sumário, um lápis na mão e alguma paciência.',
];

function blocosDoCapitulo(titulo: string) {
  return [{ tipo: 'capitulo' as const, texto: titulo }, ...Array.from({ length: 10 }, (_, i) => ({ tipo: 'paragrafo' as const, texto: `${PROSA[i % PROSA.length]!} ${PROSA[(i + 2) % PROSA.length]!}` }))];
}

function subir(comando: string, argumentos: string[], cwd: string) {
  const filho = spawn(comando, argumentos, { cwd, stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env } });
  return filho;
}

await comBancoDeTeste('captura_toasts', async (banco) => {
  await migrar(banco);
  const capitulos = ['Uma pergunta pequena', 'O meio do caminho', 'Notas na margem'];
  const blocos = capitulos.flatMap(blocosDoCapitulo);
  const c = canonicoDeTeste({
    titulo: 'Caderno de exemplo', blocos,
    secoes: capitulos.map((_, i) => ({ nivel: 1, inicio: i * 11, fim: i * 11 + 10 })),
  });
  const { doc, versao, ids } = await comTransacao(banco, async (tx) => {
    const doc = await documentos.criar(tx, { ...c.documento, titulo: 'Caderno de exemplo', origem_caminho: 'caderno.txt' });
    const versao = await documentos.criarVersao(tx, doc.id, c);
    const bloco = c.blocos[13]!;
    await anotacoes.criar(tx, { versao: 1, revisao_edicao: 1, id: idTeste('A', 1), tipo: 'nota', texto: 'Voltar a isto.', versao_id: versao.id,
      ancora: ancoraDeSelecao({ ...bloco, versao_id: versao.id }, 0, 12),
      criada_em: new Date().toISOString(), atualizada_em: new Date().toISOString() });
    const exec = idTeste('E', 1);
    const secao = (i: number) => c.secoes[i]!.id;
    const novo = (tipo: string, chave: string, prioridade = 50) =>
      jobsRepo.enfileirar(tx, { tipo, dedup_key: chave, input_snapshot_hash: 'a'.repeat(64), versao_id: versao.id, prioridade });
    const ids = {
      mapa: (await novo('gerar_esquema', `esquema:${exec}:${secao(0)}:${idTeste('Q', 1)}`, 99)).id,
      nota: (await novo('revisar_anotacao', `revisar_anotacao:${idTeste('A', 1)}:${idTeste('P', 1)}`, 98)).id,
      resumo: (await novo('sintetizar_capitulo', `sintetizar:${exec}:${secao(1)}`, 97)).id,
      resposta: (await novo('responder', `responder:${idTeste('C', 1)}:${idTeste('M', 1)}`, 96)).id,
    };
    for (const [i, tipo] of [[1, 'planejar_leitura'], [2, 'sintetizar_capitulo'], [2, 'roteirizar_visita'], [2, 'comentar_leitura']] as const) {
      const chave = tipo === 'planejar_leitura' ? `planejar:${exec}:${secao(i)}:${idTeste('Q', 2)}:x`
        : tipo === 'sintetizar_capitulo' ? `sintetizar:${exec}:${secao(i)}`
          : `${tipo === 'roteirizar_visita' ? 'visita' : 'comentada'}:${exec}:${secao(i)}:${idTeste('Q', 3)}:x`;
      await novo(tipo, chave, 10);
    }
    return { doc, versao, ids };
  });
  // Estados: mapa concluído, nota falhou, resumo e resposta rodando, o resto na fila.
  const pegar = async (tipo: string) => (await jobsRepo.reservar(banco, 'captura', [tipo], new Date(), 3_600_000))!;
  const mapa = await pegar('gerar_esquema');
  await jobsRepo.publicar(banco, mapa.id, mapa.lease_token!, () => Promise.resolve(undefined));
  const nota = await pegar('revisar_anotacao');
  await jobsRepo.falhar(banco, nota.id, nota.lease_token!, 'timeout', []);
  await pegar('sintetizar_capitulo');
  await banco.query(`UPDATE evento_job SET quando = clock_timestamp() - interval '74 seconds' WHERE job_id=$1 AND tipo='reservado'`, [ids.resumo]);
  await pegar('responder');
  await banco.query(`UPDATE evento_job SET quando = clock_timestamp() - interval '9 seconds' WHERE job_id=$1 AND tipo='reservado'`, [ids.resposta]);
  await banco.query(`UPDATE evento_job SET quando = clock_timestamp() - interval '48 seconds' WHERE job_id=$1 AND tipo='reservado'`, [ids.mapa]);

  const api = criarApi({ banco, leitura: () => { throw new Error('sem leitura nas capturas'); }, intervaloEventosMs: 1000 });
  const servidor = serve({ fetch: api.fetch, hostname: '127.0.0.1', port: Number(PORTA_API) });
  const vite = join(dirname(createRequire(join(raiz, 'web/package.json')).resolve('vite/package.json')), 'bin/vite.js');
  const web = subir(process.execPath, [vite, '--host', '127.0.0.1', '--port', PORTA_WEB, '--strictPort'], join(raiz, 'web'));
  const navegador = await chromium.launch();
  const problemas: string[] = [];
  try {
    for (let i = 0; i < 60; i += 1) {
      try { if ((await fetch(`http://127.0.0.1:${PORTA_WEB}/`)).ok) break; } catch { /* ainda subindo */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    const leitura = `/ler/${doc.id}/${c.secoes[1]!.id}`;
    const cenas: { nome: string; caminho: string; largura: number; altura: number; esquema: 'light' | 'dark'; expandir?: boolean }[] = [];
    for (const esquema of ['light', 'dark'] as const) {
      for (const [largura, altura] of [[1680, 1000], [390, 844]] as const) {
        const tema = esquema === 'dark' ? 'escuro' : 'claro';
        cenas.push({ nome: `leitor-${tema}-${String(largura)}`, caminho: leitura, largura, altura, esquema });
        cenas.push({ nome: `inicio-${tema}-${String(largura)}`, caminho: '/', largura, altura, esquema });
      }
      cenas.push({ nome: `agrupador-aberto-${esquema === 'dark' ? 'escuro' : 'claro'}-1680`, caminho: leitura, largura: 1680, altura: 1000, esquema, expandir: true });
    }
    for (const cena of cenas) {
      // A conclusão só aparece se for recente (30 s): cada cena a renova antes de abrir a página.
      await banco.query('UPDATE job SET atualizado_em = clock_timestamp() - interval \'2 seconds\' WHERE id = ANY($1)', [[ids.mapa, ids.nota]]);
      const pagina = await navegador.newPage({ viewport: { width: cena.largura, height: cena.altura }, colorScheme: cena.esquema, reducedMotion: 'reduce' });
      pagina.on('pageerror', (erro) => problemas.push(`${cena.nome}: ${String(erro)}`));
      await pagina.goto(`http://127.0.0.1:${PORTA_WEB}${cena.caminho}`, { waitUntil: 'domcontentloaded' });
      await pagina.waitForSelector('.aviso-do-codex', { timeout: 20_000 });
      await pagina.waitForTimeout(1200);
      if (cena.expandir) { await pagina.click('.avisos-mais'); await pagina.waitForTimeout(300); }
      await pagina.screenshot({ path: join(pasta, `${cena.nome}.png`) });
      await pagina.close();
    }
  } finally {
    await navegador.close();
    web.kill('SIGTERM');
    await new Promise<void>((r) => { servidor.close(() => r()); });
  }
  if (problemas.length) console.error(problemas.join('\n'));
  console.log(JSON.stringify({ capturas: pasta, versao: versao.id }));
});
