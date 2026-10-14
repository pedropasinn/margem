// Gera os PNGs, o favicon.ico, o icone.ico (Windows) e o icone.icns (macOS) do Margem a partir dos SVGs
// canônicos de docs/identidade/, e copia os ícones para o site, o app web e a extensão.
// Uso: node tools/identidade/rasterizar.mjs     (Chromium do Playwright, sem rede, sem dependência nova)
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const IDENT = join(RAIZ, 'docs/identidade');
const PNG = join(IDENT, 'png');
const TAMANHOS = [16, 32, 48, 64, 128, 256, 512, 1024];
const FUNDO = { claro: '#FFFFFF', escuro: '#16161C' };
const COR_M = { claro: '#2B2B2B', escuro: '#FFFFFF' };

/** Os seis paths canônicos (cinco segmentos do arco + M), no espaço de coordenadas do Figma. */
async function pathsDoSimbolo() {
  const svg = await readFile(join(IDENT, 'simbolo.svg'), 'utf8');
  return [...svg.matchAll(/<path d="([^"]+)" fill="([^"]+)"\/>/g)].map((m) => ({ d: m[1], cor: m[2] }));
}
const CAIXA = { x: 37.586, y: 28.957, w: 170.143 - 37.586, h: 178.043 - 28.957 }; // tinta do símbolo

function desenho(paths, corM) {
  return paths.map((p) => `<path d="${p.d}" fill="${p.cor === 'currentColor' ? corM : p.cor}"/>`).join('');
}

/** Símbolo com a tinta centrada em (cx, cy) e `altura` de altura. */
function centrado(paths, corM, cx, cy, altura) {
  const k = altura / CAIXA.h;
  const tx = cx - (CAIXA.x + CAIXA.w / 2) * k;
  const ty = cy - (CAIXA.y + CAIXA.h / 2) * k;
  return `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${k.toFixed(5)})">${desenho(paths, corM)}</g>`;
}

async function main() {
  await mkdir(PNG, { recursive: true });
  await mkdir(join(IDENT, 'bandeja'), { recursive: true });
  const paths = await pathsDoSimbolo();
  const icone = {
    claro: await readFile(join(IDENT, 'icone-app-claro.svg'), 'utf8'),
    escuro: await readFile(join(IDENT, 'icone-app-escuro.svg'), 'utf8'),
  };
  // A tinta do ícone de app ocupa 147/200 da altura (o desenho do Figma); os derivados repetem a proporção.
  const PROPORCAO = 147 / 200;

  // Tamanhos de aba e de bandeja (≤ 32 px): o mesmo desenho, com a tinta em 84% da altura para o M e
  // os segmentos não virarem borrão. Acima disso vale o SVG do Figma como está.
  const pequeno = (tema) => `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">`
    + `<rect width="200" height="200" rx="44" fill="${FUNDO[tema]}"/>` + centrado(paths, COR_M[tema], 100, 100, 168) + '</svg>';
  // macOS: grade da Apple (tela 1024, quadrado arredondado de 824 com raio 185,4 e 100 de folga).
  const mac = (tema) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">`
    + `<rect x="100" y="100" width="824" height="824" rx="185.4" fill="${FUNDO[tema]}"/>`
    + (tema === 'claro' ? '<rect x="100.5" y="100.5" width="823" height="823" rx="185" fill="none" stroke="#000" stroke-opacity=".08"/>' : '')
    + centrado(paths, COR_M[tema], 512, 512, 824 * PROPORCAO) + '</svg>';
  // PWA "maskable": fundo cheio, tinta dentro do círculo seguro (80% do lado).
  const mascaravel = (tema) => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">`
    + `<rect width="512" height="512" fill="${FUNDO[tema]}"/>` + centrado(paths, COR_M[tema], 256, 256, 290) + '</svg>';
  // Bandeja do macOS ("Template"): preto com alfa, o sistema pinta conforme a barra.
  const modelo = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">`
    + centrado(paths.map((p) => ({ ...p, cor: '#000000' })), '#000000', 32, 32, 60) + '</svg>';
  // Favicon vetorial: o símbolo sem fundo, com o M trocando de cor pelo tema do sistema.
  const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="29.06 28.50 150 150">`
    + '<style>.m{fill:#2B2B2B}@media (prefers-color-scheme:dark){.m{fill:#FFFFFF}}</style>'
    + paths.map((p) => (p.cor === 'currentColor' ? `<path class="m" d="${p.d}"/>` : `<path d="${p.d}" fill="${p.cor}"/>`)).join('') + '</svg>\n';
  await writeFile(join(IDENT, 'favicon.svg'), favicon);
  await writeFile(join(IDENT, 'icone-mac-claro.svg'), mac('claro') + '\n');
  await writeFile(join(IDENT, 'icone-mac-escuro.svg'), mac('escuro') + '\n');

  const navegador = await chromium.launch();
  const pagina = await navegador.newPage({ deviceScaleFactor: 1 });
  const rasterizar = async (svg, lado) => {
    await pagina.setViewportSize({ width: lado, height: lado });
    const dados = Buffer.from(svg).toString('base64');
    await pagina.setContent(`<html><body style="margin:0;background:transparent"><img id="i" src="data:image/svg+xml;base64,${dados}" style="display:block;width:${lado}px;height:${lado}px"></body></html>`);
    await pagina.locator('#i').evaluate((img) => img.decode());
    return pagina.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: lado, height: lado } });
  };

  const gerados = {};
  for (const tema of ['claro', 'escuro']) {
    for (const lado of TAMANHOS) {
      const png = await rasterizar(lado <= 32 ? pequeno(tema) : icone[tema], lado);
      gerados[`${tema}-${lado}`] = png;
      await writeFile(join(PNG, `icone-${tema}-${lado}.png`), png);
    }
    for (const lado of [16, 32, 64, 128, 256, 512, 1024]) gerados[`mac-${tema}-${lado}`] = await rasterizar(mac(tema), lado);
    await writeFile(join(PNG, `icone-mac-${tema}-1024.png`), gerados[`mac-${tema}-1024`]);
    await writeFile(join(PNG, `icone-mascaravel-${tema}-512.png`), await rasterizar(mascaravel(tema), 512));
    await writeFile(join(PNG, `icone-${tema}-180.png`), await rasterizar(icone[tema], 180));
    await writeFile(join(PNG, `icone-${tema}-192.png`), await rasterizar(icone[tema], 192));
  }
  await writeFile(join(IDENT, 'bandeja/bandejaTemplate.png'), await rasterizar(modelo, 16));
  await writeFile(join(IDENT, 'bandeja/bandejaTemplate@2x.png'), await rasterizar(modelo, 32));
  for (const lado of [16, 32]) await writeFile(join(IDENT, `bandeja/bandeja-${lado}.png`), gerados[`escuro-${lado}`]);
  await navegador.close();

  // O ícone dos lugares que não seguem o tema (app de desktop, PWA, extensão, favicon.ico) é o escuro:
  // o quadrado #16161C aparece em barras claras e escuras; o branco some nas claras.
  const TEMA_FIXO = 'escuro';
  await writeFile(join(IDENT, 'favicon.ico'), ico([16, 32, 48].map((l) => gerados[`${TEMA_FIXO}-${l}`])));
  await writeFile(join(IDENT, 'icone.ico'), ico([16, 32, 48, 64, 128, 256].map((l) => gerados[`${TEMA_FIXO}-${l}`])));
  await writeFile(join(IDENT, 'icone.icns'), icns([
    ['icp4', `mac-${TEMA_FIXO}-16`], ['icp5', `mac-${TEMA_FIXO}-32`], ['icp6', `mac-${TEMA_FIXO}-64`],
    ['ic07', `mac-${TEMA_FIXO}-128`], ['ic08', `mac-${TEMA_FIXO}-256`], ['ic09', `mac-${TEMA_FIXO}-512`], ['ic10', `mac-${TEMA_FIXO}-1024`],
    ['ic11', `mac-${TEMA_FIXO}-32`], ['ic12', `mac-${TEMA_FIXO}-64`], ['ic13', `mac-${TEMA_FIXO}-256`], ['ic14', `mac-${TEMA_FIXO}-512`],
  ].map(([tipo, chave]) => [tipo, gerados[chave]])));

  // Cópias para quem usa os ícones (os destinos são gerados; a fonte é docs/identidade/).
  const p = (nome) => join(PNG, nome);
  const copias = [
    [p(`icone-${TEMA_FIXO}-512.png`), 'site/public/icone-512.png'],
    [p(`icone-${TEMA_FIXO}-180.png`), 'site/public/apple-touch-icon.png'],
    [join(IDENT, 'favicon.svg'), 'site/public/favicon.svg'],
    [join(IDENT, 'favicon.ico'), 'site/public/favicon.ico'],
    [p(`icone-${TEMA_FIXO}-512.png`), 'web/public/icone-512.png'],
    [p(`icone-${TEMA_FIXO}-192.png`), 'web/public/icone-192.png'],
    [p(`icone-mascaravel-${TEMA_FIXO}-512.png`), 'web/public/icone-mascaravel-512.png'],
    [p(`icone-${TEMA_FIXO}-180.png`), 'web/public/apple-touch-icon.png'],
    [join(IDENT, 'favicon.svg'), 'web/public/favicon.svg'],
    [join(IDENT, 'favicon.ico'), 'web/public/favicon.ico'],
    ...[16, 32, 48, 128].map((l) => [p(`icone-${TEMA_FIXO}-${l}.png`), `extensao/icones/icone-${l}.png`]),
  ];
  for (const [de, para] of copias) await copyFile(de, join(RAIZ, para));

  // Os paths da assinatura para os componentes do site e do app (inline, sem pedir arquivo à rede).
  const a = JSON.parse(await readFile(join(IDENT, 'assinatura.json'), 'utf8'));
  const modulo = '// Gerado por tools/identidade/rasterizar.mjs a partir de docs/identidade/assinatura.json. Não editar à mão.\n'
    + `export const ARCO: readonly { cor: string; d: string }[] = ${JSON.stringify(a.arco.segmentos)};\n`
    + `export const ASSINATURA_CURTA = ${JSON.stringify({ viewBox: a.curta.viewBox, palavra: a.curta.palavra })} as const;\n`
    + `export const ASSINATURA = ${JSON.stringify({ viewBox: a.completa.viewBox, palavra: a.completa.palavra, lema: a.completa.lema })} as const;\n`;
  for (const destino of ['site/src/componentes/marca-dados.ts', 'web/src/ui/marca-dados.ts']) await writeFile(join(RAIZ, destino), modulo);
  console.log(`ok: ${Object.keys(gerados).length} rasterizações, ${copias.length} cópias`);
}

/** ICO com as imagens em PNG (aceito pelo Windows desde o Vista e por todos os navegadores). */
function ico(pngs) {
  const cabecalho = Buffer.alloc(6);
  cabecalho.writeUInt16LE(0, 0); cabecalho.writeUInt16LE(1, 2); cabecalho.writeUInt16LE(pngs.length, 4);
  const entradas = []; let deslocamento = 6 + 16 * pngs.length;
  for (const png of pngs) {
    const lado = png.readUInt32BE(16);
    const e = Buffer.alloc(16);
    e.writeUInt8(lado >= 256 ? 0 : lado, 0); e.writeUInt8(lado >= 256 ? 0 : lado, 1);
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(png.length, 8); e.writeUInt32LE(deslocamento, 12);
    entradas.push(e); deslocamento += png.length;
  }
  return Buffer.concat([cabecalho, ...entradas, ...pngs]);
}

/** ICNS: 'icns' + tamanho total, depois blocos (tipo de 4 letras + tamanho do bloco + PNG). */
function icns(blocos) {
  const partes = blocos.map(([tipo, png]) => {
    const c = Buffer.alloc(8); c.write(tipo, 0, 'ascii'); c.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([c, png]);
  });
  const total = 8 + partes.reduce((s, b) => s + b.length, 0);
  const c = Buffer.alloc(8); c.write('icns', 0, 'ascii'); c.writeUInt32BE(total, 4);
  return Buffer.concat([c, ...partes]);
}

await main();
