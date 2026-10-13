// Capturas e vídeo da visita guiada (J91) contra uma API viva (o banco de teste, nunca a produção).
// Uso: node tools/capturar-visita.mjs <base> <pasta> [--video] [--documento ID] [--secao ID] [--prefixo texto-]
//
// Sem --video: capturas PNG (abertura, paradas, relação, trecho inteiro), em Firefox 1440×900.
// Com --video: grava a tela (Playwright, Firefox) com a visita tocando e o foco mudando, e depois
// junta ao vídeo a voz real: o gravador do navegador não grava som, então a ferramenta anota, a cada
// ação, o instante do vídeo e o do MP3 da narração, e o ffmpeg monta a trilha com os mesmos cortes.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firefox } from 'playwright';

const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i === -1 ? undefined : args[i + 1]; };
const soltos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--video'));
const [base = 'http://127.0.0.1:8813', pasta = 'docs/jobs/J91-evidencias'] = soltos;
const documento = opcao('--documento') ?? '01M3JEKK3D9Q8BE1HGYF4QWZKG';
const secao = opcao('--secao') ?? '18WG3SP23QS7R3HG0WRW5J7CE0';
const video = args.includes('--video');
const prefixo = opcao('--prefixo') ?? '';
mkdirSync(pasta, { recursive: true });

const navegador = await firefox.launch({ firefoxUserPrefs: { 'media.autoplay.default': 0 } });
const bruto = join(pasta, 'bruto');
const contexto = await navegador.newContext({
  viewport: { width: 1440, height: 900 }, colorScheme: process.env.ESQUEMA === 'escuro' ? 'dark' : 'light',
  ...(video ? { recordVideo: { dir: bruto, size: { width: 1440, height: 900 } } } : {}),
});
const inicioDoVideo = Date.now();
const pagina = await contexto.newPage();
const problemas = [];
pagina.on('pageerror', (erro) => problemas.push(String(erro)));
pagina.on('console', (m) => { if (m.type() === 'error') problemas.push(m.text().slice(0, 200)); });
const foto = async (nome) => { await pagina.waitForTimeout(700); await pagina.screenshot({ path: join(pasta, `${prefixo}${nome}.png`) }); };

// Cortes da trilha: a partir de `v` (segundos do vídeo), toca o MP3 a partir de `a` (ou silêncio).
const cortes = [{ v: 0, a: null }];
const marcar = async () => {
  const a = await pagina.evaluate(() => { const audio = document.querySelector('.estudo-capitulo audio, audio'); return audio && !audio.paused ? audio.currentTime : null; });
  cortes.push({ v: (Date.now() - inicioDoVideo) / 1000, a });
};
const esperar = (ms) => pagina.waitForTimeout(ms);
const proxima = async () => { await pagina.locator('button[aria-label="Próxima parada"]').click(); await esperar(250); await marcar(); };

await pagina.goto(`${base}/ler/${documento}/${secao}`, { waitUntil: 'networkidle' });
await esperar(2500);
if (!video) await foto('01-leitor-com-botao');
const botao = pagina.locator('.botao-visita');
await botao.waitFor({ timeout: 15000 });
await botao.click();
await esperar(1500);
if (!video) await foto('02-visita-abertura');
await pagina.locator('.tocar-visita').click();
await esperar(400);
if (video) {
  await marcar();
  await esperar(14000);               // abertura
  await proxima(); await esperar(16000);  // parada 1
  await proxima(); await esperar(13000);  // parada 2
  await pagina.locator('.paradas-da-visita li').nth(6).locator('button').click(); await esperar(250); await marcar();
  await esperar(15000);               // parada 7: relação que volta, com a ponta aberta no véu
  await pagina.getByRole('button', { name: 'Ler o trecho inteiro' }).click(); await esperar(250); await marcar();
  await esperar(4000);
  await pagina.getByRole('button', { name: 'Voltar à visita' }).click(); await esperar(200);
  await pagina.locator('.tocar-visita').click(); await esperar(300); await marcar();
  await esperar(8000);
  await proxima(); await esperar(9000);
  cortes.push({ v: (Date.now() - inicioDoVideo) / 1000, a: null });
} else {
  await esperar(4000);
  await foto('03-visita-tocando');
  for (const n of [1, 2]) { await proxima(); await esperar(2500); await foto(`04-parada-${String(n)}`); }
  await pagina.locator('.paradas-da-visita li').nth(6).locator('button').click();
  await esperar(2500); await foto('05-parada-com-relacao');
  await pagina.getByRole('button', { name: 'Ler o trecho inteiro' }).click();
  await esperar(2000); await foto('06-trecho-inteiro');
}
const narracao = await pagina.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null);
await contexto.close();
await navegador.close();

if (video) {
  const [arquivo] = readdirSync(bruto);
  const webm = join(bruto, arquivo);
  const saida = join(pasta, 'visita-guiada.mp4');
  if (narracao) {
    const mp3 = join(bruto, 'narracao.mp3');
    writeFileSync(mp3, Buffer.from(await (await fetch(base + narracao)).arrayBuffer()));
    const partes = [];
    const rotulos = [];
    cortes.forEach((corte, i) => {
      const seguinte = cortes[i + 1];
      if (!seguinte) return;
      const duracao = Math.max(0.05, seguinte.v - corte.v).toFixed(3);
      rotulos.push(`[s${String(i)}]`);
      partes.push(corte.a === null
        ? `aevalsrc=0:d=${duracao}:s=24000:c=mono,aformat=sample_rates=24000:channel_layouts=mono[s${String(i)}]`
        : `[1:a]atrim=start=${corte.a.toFixed(3)}:duration=${duracao},asetpts=PTS-STARTPTS,aformat=sample_rates=24000:channel_layouts=mono[s${String(i)}]`);
    });
    const filtro = `${partes.join(';')};${rotulos.join('')}concat=n=${String(rotulos.length)}:v=0:a=1[a]`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-i', mp3, '-filter_complex', filtro, '-map', '0:v', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '30', '-pix_fmt', 'yuv420p', '-r', '15', '-c:a', 'aac', '-b:a', '96k', '-shortest', saida]);
  } else {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-c:v', 'libx264', '-preset', 'medium', '-crf', '30', '-pix_fmt', 'yuv420p', '-r', '15', saida]);
  }
  writeFileSync(join(pasta, 'cortes-do-video.json'), `${JSON.stringify(cortes, null, 2)}\n`);
  rmSync(bruto, { recursive: true, force: true });
}
console.log(JSON.stringify({ problemas, cortes: video ? cortes.length : 0 }));
