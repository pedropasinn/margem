// Capturas e vídeo da leitura comentada (J92) contra uma API viva (o banco de teste, nunca a produção).
// Uso: node tools/capturar-leitura-comentada.mjs <base> <pasta> [--video] [--comentario N] [--antes K] [--documento ID] [--secao ID]
//
// Sem --video: capturas PNG (leitor com o botão, leitura com karaokê, comentário com foco e ponta,
// retomada), em Firefox 1440×900.
// Com --video: grava (Playwright, Firefox) a leitura tocando K frases antes do comentário N, a pausa com
// o comentário e a retomada. O gravador do navegador não grava som: a ferramenta anota o instante do
// vídeo e o do MP3 a cada ação, e o ffmpeg monta a trilha com a voz real nos mesmos cortes (como no J91).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { firefox } from 'playwright';

const args = process.argv.slice(2);
const opcao = (nome) => { const i = args.indexOf(nome); return i === -1 ? undefined : args[i + 1]; };
const soltos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--video'));
const [base = 'http://127.0.0.1:8814', pasta = 'docs/jobs/J92-evidencias'] = soltos;
const documento = opcao('--documento') ?? '01M3JEKK3D9Q8BE1HGYF4QWZKG';
const secao = opcao('--secao') ?? '18WG3SP23QS7R3HG0WRW5J7CE0';
const comentario = Number(opcao('--comentario') ?? '2');
const antes = Number(opcao('--antes') ?? '3');
const segundos = Number(opcao('--segundos') ?? '75');
const video = args.includes('--video');
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
const esperar = (ms) => pagina.waitForTimeout(ms);
const foto = async (nome) => { await esperar(700); await pagina.screenshot({ path: join(pasta, `${nome}.png`) }); };
const cortes = [{ v: 0, a: null }];
const marcar = async () => {
  const a = await pagina.evaluate(() => { const audio = document.querySelector('audio'); return audio && !audio.paused ? audio.currentTime : null; });
  cortes.push({ v: (Date.now() - inicioDoVideo) / 1000, a });
};
const estado = () => pagina.evaluate(() => document.querySelector('.painel-comentada')?.getAttribute('data-em'));

await pagina.goto(`${base}/ler/${documento}/${secao}`, { waitUntil: 'networkidle' });
await esperar(2500);
if (!video) await foto('01-leitor-com-botao');
const botao = pagina.locator('.botao-comentada');
await botao.waitFor({ timeout: 15000 });
await botao.click();
await esperar(1500);
// Vai ao comentário N e volta K frases: a leitura começa um pouco antes da pausa.
await pagina.locator('.comentarios-da-leitura li').nth(comentario - 1).locator('button').click();
await esperar(300);
for (let i = 0; i < antes; i += 1) { await pagina.keyboard.press('ArrowLeft'); await esperar(120); }
await esperar(1200);
if (video) {
  await pagina.locator('.tocar-visita').click();
  await esperar(400); await marcar();
  // Toca até a pausa, o comentário inteiro e alguns segundos da retomada.
  let visto = false;
  const fim = Date.now() + segundos * 1000;
  while (Date.now() < fim) {
    await esperar(500);
    const agora = await estado();
    if (agora === 'comentario') visto = true;
    if (visto && agora === 'leitura') { await esperar(9000); break; }
  }
  cortes.push({ v: (Date.now() - inicioDoVideo) / 1000, a: null });
} else {
  await foto('02-leitura-parada');
  await pagina.locator('.tocar-visita').click();
  await esperar(3500);
  await foto('03-leitura-com-karaoke');
  await pagina.locator('.comentarios-da-leitura li').nth(comentario - 1).locator('button').click();
  await esperar(2500);
  await foto('04-comentario-com-foco');
  await pagina.getByRole('button', { name: 'Pular comentário' }).click();
  await esperar(2500);
  await foto('05-retomada');
  await pagina.locator('.tocar-visita').click();
}
const narracao = await pagina.evaluate(() => document.querySelector('audio')?.getAttribute('src') ?? null);
await contexto.close();
await navegador.close();

if (video) {
  const [arquivo] = readdirSync(bruto);
  const webm = join(bruto, arquivo);
  const saida = join(pasta, 'leitura-comentada.mp4');
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
