/**
 * Capturas e verificações de layout do leitor em navegador real.
 *
 * Não é um teste do Vitest: sobe `vite preview` numa porta livre, abre `/dev` no Chromium
 * local (`~/.cache/ms-playwright`) e falha com código de saída diferente de zero.
 *
 *   npm run build --workspace web && npm run capturas --workspace web
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { preview } from 'vite';

const PORTA = 5188;
const PASTA = new URL('./capturas/', import.meta.url);

interface Medida {
  nome: string;
  largura: number;
  altura: number;
}

const MEDIDAS: Medida[] = [
  { nome: 'desktop', largura: 1440, altura: 900 },
  { nome: 'celular', largura: 412, altura: 915 },
];

/** Conta os caracteres da primeira linha do primeiro parágrafo, medindo pelo `Range`. */
function caracteresDaPrimeiraLinha(): number {
  const bloco = document.querySelector('p.bloco-paragrafo');
  if (bloco === null) return 0;
  const percurso = document.createTreeWalker(bloco, NodeFilter.SHOW_TEXT);
  const nos: Text[] = [];
  for (let no = percurso.nextNode(); no !== null; no = percurso.nextNode()) nos.push(no as Text);
  let contagem = 0;
  let topo: number | null = null;
  for (const no of nos) {
    for (let i = 0; i < no.data.length; i++) {
      const intervalo = document.createRange();
      intervalo.setStart(no, i);
      intervalo.setEnd(no, i + 1);
      const caixa = intervalo.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) continue;
      if (topo === null) topo = caixa.top;
      if (Math.abs(caixa.top - topo) > 2) return contagem;
      contagem += 1;
    }
  }
  return contagem;
}

/** Largura do conteúdo contra a da janela: o corpo da página nunca rola na horizontal. */
function larguras(): { conteudo: number; janela: number } {
  const raiz = document.documentElement;
  return { conteudo: Math.max(raiz.scrollWidth, document.body.scrollWidth), janela: raiz.clientWidth };
}

async function principal(): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  const servidor = await preview({ configLoader: 'runner', preview: { port: PORTA, strictPort: true, host: '127.0.0.1' } });
  const base = servidor.resolvedUrls?.local[0] ?? `http://127.0.0.1:${PORTA}/`;
  const navegador = await chromium.launch();
  const falhas: string[] = [];

  try {
    for (const medida of MEDIDAS) {
      for (const tema of ['light', 'dark'] as const) {
        const pagina = await navegador.newPage({
          viewport: { width: medida.largura, height: medida.altura },
          colorScheme: tema,
          deviceScaleFactor: 2,
        });
        const erros: string[] = [];
        pagina.on('pageerror', (erro) => erros.push(erro.message));
        await pagina.goto(new URL('dev', base).href, { waitUntil: 'networkidle' });
        await pagina.waitForSelector('.titulo-da-secao');

        const arquivo = new URL(`leitor-${medida.nome}-${tema === 'light' ? 'claro' : 'escuro'}.png`, PASTA);
        await pagina.screenshot({ path: arquivo.pathname, fullPage: true });

        const rolagem = await pagina.evaluate(larguras);
        if (rolagem.conteudo > rolagem.janela + 1) {
          falhas.push(`${medida.nome}/${tema}: rolagem horizontal (${rolagem.conteudo} > ${rolagem.janela})`);
        }

        if (medida.nome === 'desktop') {
          const caracteres = await pagina.evaluate(caracteresDaPrimeiraLinha);
          if (caracteres < 62 || caracteres > 72) {
            falhas.push(`${medida.nome}/${tema}: ${caracteres} caracteres na primeira linha (esperado 62 a 72)`);
          } else {
            console.log(`${medida.nome}/${tema}: ${caracteres} caracteres na primeira linha`);
          }
        }

        if (erros.length > 0) falhas.push(`${medida.nome}/${tema}: erro de página — ${erros.join('; ')}`);
        console.log(`captura: ${arquivo.pathname}`);
        await pagina.close();
      }
    }
  } finally {
    await navegador.close();
    await servidor.close();
  }

  if (falhas.length > 0) {
    for (const falha of falhas) console.error(`FALHA ${falha}`);
    process.exitCode = 1;
  } else {
    console.log('Layout do leitor: sem rolagem horizontal e medida dentro da faixa.');
  }
}

await principal();
