/**
 * Capturas e verificações da margem, da folha e da retomada, em navegador real.
 *
 * Mesmo mecanismo do J08: sobe `vite preview` numa porta livre, abre `/dev/margem` no
 * Chromium local e sai com código diferente de zero se alguma regra falhar.
 *
 *   npm run build --workspace web && npm run capturas --workspace web
 */
import { mkdirSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { preview } from 'vite';

const PORTA = 5189;
const PASTA = new URL('./capturas/', import.meta.url);

interface Medida {
  nome: string;
  largura: number;
  altura: number;
}

const DESKTOP: Medida = { nome: 'desktop', largura: 1440, altura: 900 };
const CELULAR: Medida = { nome: 'celular', largura: 412, altura: 915 };

/** Largura do conteúdo contra a da janela: o corpo da página nunca rola na horizontal. */
function larguras(): { conteudo: number; janela: number } {
  const raiz = document.documentElement;
  return { conteudo: Math.max(raiz.scrollWidth, document.body.scrollWidth), janela: raiz.clientWidth };
}

/** Caixas das notas contra a coluna do texto e contra o trecho de cada uma. */
function geometriaDaMargem(): {
  direitaDoTexto: number;
  notas: { id: string; esquerda: number; topo: number; topoDoTrecho: number | null }[];
} {
  const capitulo = document.querySelector('.capitulo');
  const direitaDoTexto = capitulo === null ? 0 : capitulo.getBoundingClientRect().right;
  const notas = [...document.querySelectorAll<HTMLElement>('.nota')].map((nota) => {
    const id = nota.dataset['nota'] ?? '';
    const caixa = nota.getBoundingClientRect();
    const trechos = [...document.querySelectorAll<HTMLElement>('span[data-marcas]')]
      .filter((span) => (span.dataset['marcas'] ?? '').split(' ').includes(id));
    const primeiro = trechos[0];
    let topoDoTrecho: number | null = null;
    if (primeiro !== undefined) {
      const intervalo = document.createRange();
      intervalo.selectNodeContents(primeiro);
      topoDoTrecho = (intervalo.getClientRects()[0] ?? primeiro.getBoundingClientRect()).top;
    }
    return { id, esquerda: caixa.left, topo: caixa.top, topoDoTrecho };
  });
  return { direitaDoTexto, notas };
}

async function conferirRolagem(pagina: Page, rotulo: string, falhas: string[]): Promise<void> {
  const rolagem = await pagina.evaluate(larguras);
  if (rolagem.conteudo > rolagem.janela + 1) {
    falhas.push(`${rotulo}: rolagem horizontal (${rolagem.conteudo} > ${rolagem.janela})`);
  }
}

async function principal(): Promise<void> {
  mkdirSync(PASTA, { recursive: true });
  const servidor = await preview({ configLoader: 'runner', preview: { port: PORTA, strictPort: true, host: '127.0.0.1' } });
  const base = servidor.resolvedUrls?.local[0] ?? `http://127.0.0.1:${PORTA}/`;
  const endereco = new URL('dev/margem', base).href;
  const navegador = await chromium.launch();
  const falhas: string[] = [];

  try {
    // ---------------------------------------------------------------- computador
    for (const tema of ['light', 'dark'] as const) {
      const pagina = await navegador.newPage({
        viewport: { width: DESKTOP.largura, height: DESKTOP.altura }, colorScheme: tema, deviceScaleFactor: 2,
      });
      const erros: string[] = [];
      pagina.on('pageerror', (erro) => erros.push(erro.message));
      await pagina.goto(endereco, { waitUntil: 'networkidle' });
      await pagina.waitForSelector('.nota');

      // Ativar o primeiro trecho marcado: a nota correspondente ganha `.ativa`.
      await pagina.locator('span[data-marcas]').first().click();
      await pagina.waitForSelector('.nota.ativa');

      const rotulo = `desktop/${tema}`;
      const claro = tema === 'light';
      const arquivo = new URL(`j09-desktop-${claro ? 'nota-ativa' : 'escuro'}.png`, PASTA);
      await pagina.screenshot({ path: arquivo.pathname, fullPage: false });
      console.log(`captura: ${arquivo.pathname}`);

      await conferirRolagem(pagina, rotulo, falhas);

      const geometria = await pagina.evaluate(geometriaDaMargem);
      if (geometria.notas.length === 0) falhas.push(`${rotulo}: nenhuma nota na margem`);
      for (const nota of geometria.notas) {
        if (nota.esquerda < geometria.direitaDoTexto - 1) {
          falhas.push(`${rotulo}: nota ${nota.id} cobre o texto (${nota.esquerda} < ${geometria.direitaDoTexto})`);
        }
      }
      const primeira = geometria.notas[0];
      if (primeira?.topoDoTrecho != null && Math.abs(primeira.topo - primeira.topoDoTrecho) > 2) {
        falhas.push(`${rotulo}: a primeira nota não alinha com o trecho (${primeira.topo} × ${primeira.topoDoTrecho})`);
      } else if (primeira !== undefined) {
        console.log(`${rotulo}: primeira nota alinhada em ${String(Math.round(primeira.topo))} px`);
      }

      const ativa = await pagina.locator('.nota.ativa').count();
      if (ativa !== 1) falhas.push(`${rotulo}: ${ativa} notas ativas (esperado 1)`);
      const sublinhados = await pagina.locator('span[data-marcas].ativa').count();
      if (sublinhados === 0) falhas.push(`${rotulo}: o trecho ativo não ganhou sublinhado`);

      if (erros.length > 0) falhas.push(`${rotulo}: erro de página — ${erros.join('; ')}`);
      await pagina.close();
    }

    // ---------------------------------------------------------------- retomada
    {
      const pagina = await navegador.newPage({
        viewport: { width: DESKTOP.largura, height: DESKTOP.altura }, deviceScaleFactor: 2,
      });
      await pagina.goto(endereco, { waitUntil: 'networkidle' });
      await pagina.waitForSelector('.nota');
      await pagina.evaluate(() => { window.scrollBy({ top: 1400, left: 0, behavior: 'auto' }); });
      // O salvamento tem atraso de 2 s.
      await pagina.waitForTimeout(2600);
      const antes = await pagina.evaluate(() => window.scrollY);

      await pagina.reload({ waitUntil: 'networkidle' });
      await pagina.waitForSelector('.nota');
      await pagina.waitForTimeout(400);
      const depois = await pagina.evaluate(() => window.scrollY);
      const arquivo = new URL('j09-desktop-retomada.png', PASTA);
      await pagina.screenshot({ path: arquivo.pathname, fullPage: false });
      console.log(`captura: ${arquivo.pathname}`);

      // A âncora retomada é posta a 96 px do topo (`ALVO_DA_RETOMADA_PX`).
      const esperado = antes - 96;
      if (antes <= 0) falhas.push(`retomada: a página não rolou antes de recarregar (${antes})`);
      else if (Math.abs(depois - esperado) > 40) {
        falhas.push(`retomada: voltou para ${depois} em vez de perto de ${esperado}`);
      } else {
        console.log(`retomada: ${String(Math.round(antes))} px → ${String(Math.round(depois))} px (alvo ${String(Math.round(esperado))})`);
      }
      await pagina.close();
    }

    // ---------------------------------------------------------------- celular
    for (const tema of ['light', 'dark'] as const) {
      const pagina = await navegador.newPage({
        viewport: { width: CELULAR.largura, height: CELULAR.altura }, colorScheme: tema,
        deviceScaleFactor: 2, hasTouch: true, isMobile: true,
      });
      const erros: string[] = [];
      pagina.on('pageerror', (erro) => erros.push(erro.message));
      await pagina.goto(endereco, { waitUntil: 'networkidle' });
      await pagina.waitForSelector('span[data-marcas]');

      const rotulo = `celular/${tema}`;
      if (await pagina.locator('.margem').count() > 0) falhas.push(`${rotulo}: a margem apareceu em tela estreita`);

      await pagina.locator('span[data-marcas]').first().tap();
      await pagina.waitForSelector('.folha');
      const arquivo = new URL(`j09-celular-${tema === 'light' ? 'folha' : 'escuro'}.png`, PASTA);
      await pagina.screenshot({ path: arquivo.pathname, fullPage: false });
      console.log(`captura: ${arquivo.pathname}`);

      await conferirRolagem(pagina, rotulo, falhas);

      const antes = await pagina.evaluate(() => window.scrollY);
      await pagina.getByRole('button', { name: 'Fechar' }).click();
      await pagina.waitForSelector('.folha', { state: 'detached' });
      const depois = await pagina.evaluate(() => window.scrollY);
      if (antes !== depois) falhas.push(`${rotulo}: a folha mexeu na rolagem (${antes} → ${depois})`);

      if (erros.length > 0) falhas.push(`${rotulo}: erro de página — ${erros.join('; ')}`);
      await pagina.close();
    }
  } finally {
    await navegador.close();
    await servidor.close();
  }

  if (falhas.length > 0) {
    for (const falha of falhas) console.error(`FALHA ${falha}`);
    process.exitCode = 1;
  } else {
    console.log('Margem, folha e retomada: alinhamento, sem cobrir o texto e sem rolagem horizontal.');
  }
}

await principal();
