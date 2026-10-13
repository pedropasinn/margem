/**
 * J109 · As portas da importação do YouTube com programas falsos (scripts de shell, sem rede): o yt-dlp
 * recebe só a URL canônica, nunca pede o vídeo (só metadados, legenda json3 e o áudio), e o transcritor
 * local devolve palavras no formato combinado. Sem o programa, `FerramentaAusente`.
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { FerramentaAusente, fonteYtDlp, transcritorDoAmbiente } from './fontes-do-youtube';

let pasta: string;
beforeAll(async () => { pasta = await mkdtemp(join(tmpdir(), 'margem-j109-portas-')); });
afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

async function script(nome: string, corpo: string): Promise<string> {
  const caminho = join(pasta, nome);
  await writeFile(caminho, `#!/bin/sh\n${corpo}\n`);
  await chmod(caminho, 0o755);
  return caminho;
}

test('yt-dlp falso: metadados, legenda e só o áudio, sempre com a URL canônica', async () => {
  const registro = join(pasta, 'argumentos.txt');
  // Grava os argumentos; com -o, cria o arquivo pedido (legenda.pt-orig.json3 ou audio.m4a).
  const programa = await script('yt-dlp', `printf '%s\\n' "$@" >> "${registro}"; echo --- >> "${registro}"
saida=""; anterior=""
for a in "$@"; do if [ "$anterior" = "-o" ]; then saida="$a"; fi; anterior="$a"; done
case "$*" in
  *" -J "*) echo '{"title":"Título","channel":"Canal","duration":12,"automatic_captions":{"pt-orig":[]}}' ;;
  *--write-auto-subs*) echo '{"events":[{"tStartMs":0,"dDurationMs":1000,"segs":[{"utf8":"olá"}]}]}' > "$(echo "$saida" | sed 's/%(ext)s/pt-orig.json3/')" ;;
  *) printf 'audio' > "$(echo "$saida" | sed 's/%(ext)s/m4a/')" ;;
esac`);
  const fonte = fonteYtDlp(programa);
  const sinal = new AbortController().signal;
  const meta = await fonte.metadados('dO8EW2LqBfU', sinal);
  expect(meta).toMatchObject({ titulo: 'Título', canal: 'Canal', duracao_s: 12, automaticas: ['pt-orig'] });
  expect(await fonte.legenda('dO8EW2LqBfU', { idioma: 'pt-orig', automatica: true }, pasta, sinal)).toEqual({ events: [{ tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'olá' }] }] });
  expect(await fonte.audio('dO8EW2LqBfU', pasta, sinal)).toBe(join(pasta, 'audio.m4a'));
  const chamadas = (await readFile(registro, 'utf8')).split('---\n').filter(Boolean).map((c) => c.trim().split('\n'));
  expect(chamadas).toHaveLength(3);
  for (const argumentos of chamadas) {
    expect(argumentos.at(-1)).toBe('https://www.youtube.com/watch?v=dO8EW2LqBfU');
    expect(argumentos).toContain('--no-playlist');
    expect(argumentos).toContain('--ignore-config');
  }
  expect(chamadas[0]).toEqual(expect.arrayContaining(['--skip-download', '-J']));
  expect(chamadas[1]).toEqual(expect.arrayContaining(['--skip-download', '--write-auto-subs', '--sub-langs', 'pt-orig', '--sub-format', 'json3']));
  // Só áudio: nenhum formato de vídeo é pedido.
  const formato = chamadas[2]![chamadas[2]!.indexOf('-f') + 1]!;
  expect(formato).toBe('bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio[acodec!=none][vcodec=none]');
  expect(formato.split('/').every((f) => f.startsWith('bestaudio'))).toBe(true);
});

test('sem o programa: FerramentaAusente; erro do programa: a última linha do stderr', async () => {
  const sinal = new AbortController().signal;
  await expect(fonteYtDlp(join(pasta, 'nao-existe')).metadados('dO8EW2LqBfU', sinal)).rejects.toBeInstanceOf(FerramentaAusente);
  const falha = await script('yt-dlp-falha', 'echo "linha 1" >&2; echo "ERROR: Video unavailable" >&2; exit 1');
  await expect(fonteYtDlp(falha).metadados('dO8EW2LqBfU', sinal)).rejects.toThrow('ERROR: Video unavailable');
});

test('transcritor local: MARGEM_TRANSCRITOR recebe <áudio> <saída> e devolve palavras', async () => {
  expect(transcritorDoAmbiente({})).toBeNull();
  expect(transcritorDoAmbiente({ MARGEM_TRANSCRITOR: '  ' })).toBeNull();
  const programa = await script('transcritor', `test -f "$1" || exit 3
echo '{"motor":"faster-whisper small","idioma":"pt","palavras":[{"texto":"olá","inicio_s":0,"fim_s":0.4},{"texto":"duas palavras","inicio_s":0.5,"fim_s":1.5},{"texto":"","inicio_s":"x","fim_s":2}]}' > "$2"`);
  const audio = join(pasta, 'a.m4a');
  await writeFile(audio, 'x');
  const transcritor = transcritorDoAmbiente({ MARGEM_TRANSCRITOR: programa, PATH: process.env.PATH ?? '' })!;
  const t = await transcritor.transcrever(audio, pasta, new AbortController().signal);
  expect(t).toEqual({ motor: 'faster-whisper small', idioma: 'pt', palavras: [
    { texto: 'olá', inicio_s: 0, fim_s: 0.4 }, { texto: 'duas', inicio_s: 0.5, fim_s: 1 }, { texto: 'palavras', inicio_s: 1, fim_s: 1.5 }] });
});
