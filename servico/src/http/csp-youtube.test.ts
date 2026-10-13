/** J109 · A CSP da página abre só o necessário para o player oficial do YouTube. */
import { expect, test } from 'vitest';
import { CSP_DA_PAGINA } from './seguranca';

test('CSP: script da IFrame API e moldura /embed/ do YouTube, e nada mais de fora', () => {
  const diretivas = Object.fromEntries(CSP_DA_PAGINA.split('; ').map((d) => { const [nome, ...valores] = d.split(' '); return [nome!, valores]; }));
  expect(diretivas['script-src']).toEqual(["'self'", "'wasm-unsafe-eval'", 'https://www.youtube.com/iframe_api', 'https://www.youtube.com/s/player/']);
  expect(diretivas['frame-src']).toEqual(["'self'", 'https://www.youtube.com/embed/']);
  // Nenhum curinga, nenhuma outra diretiva com origem de fora, e a página continua sem moldura de terceiros.
  expect(CSP_DA_PAGINA).not.toMatch(/https:(?!\/\/www\.youtube\.com\/(?:iframe_api|s\/player\/|embed\/))/);
  expect(CSP_DA_PAGINA).not.toMatch(/\*|'unsafe-eval'|youtube-nocookie/);
  for (const nome of ['connect-src', 'img-src', 'media-src', 'default-src', 'worker-src']) expect(diretivas[nome]!.join(' ')).not.toContain('youtube');
  expect(diretivas['frame-ancestors']).toEqual(["'none'"]);
});
