/**
 * Prova do perfil de permissões do modo nativo (J114) com o sandbox REAL do Codex, sem modelo e sem
 * rede: `codex sandbox -- sh -c <comando>` com o `config.toml` que `politicaNativa` escreve. Só roda com
 * `MARGEM_PROVA_SANDBOX=<binário do codex>` (Linux ou macOS); na suíte normal fica pulado.
 *
 *   MARGEM_PROVA_SANDBOX=/caminho/do/codex npx vitest run --project servico src/executor/confinamento-nativo.real.test.ts
 */
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { pastaDoMotor, politicaNativa } from './confinamento.js';

const codex = process.env.MARGEM_PROVA_SANDBOX?.trim() ?? '';

function rodar(casa: string, diretorio: string, comando: string): Promise<{ codigo: number; saida: string }> {
  return new Promise((resolver) => {
    execFile(codex, ['sandbox', '--', 'sh', '-c', comando], {
      cwd: diretorio, env: { PATH: '/usr/bin:/bin', HOME: casa, CODEX_HOME: join(casa, '.codex') }, timeout: 30_000,
    }, (erro, saida, saidaErro) => { resolver({ codigo: erro ? 1 : 0, saida: `${saida}${saidaErro}` }); });
  });
}

test.skipIf(codex === '' || process.platform === 'win32')('o perfil nativo só deixa ler o diretório e os anexos, sem escrita nem rede', async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'margem-prova-perfil-')));
  try {
    const [casa, diretorio, fora, anexo] = ['casa', 'job', 'fora', 'anexo'].map((nome) => join(base, nome)) as [string, string, string, string];
    for (const pasta of [join(casa, '.codex'), diretorio, fora, anexo]) await mkdir(pasta, { recursive: true });
    await writeFile(join(diretorio, 'parte.txt'), 'FRASE-DA-PARTE\n');
    await writeFile(join(fora, 'livro.txt'), 'FRASE-DE-OUTRO-LIVRO\n');
    await writeFile(join(anexo, 'a.txt'), 'FRASE-DO-ANEXO\n');
    const { topo, tabelas } = politicaNativa({
      politica: 'perfil', plataforma: process.platform, sandboxDoWindows: 'unelevated', diretorio,
      leituras: [anexo, (await pastaDoMotor(codex)).pasta],
    });
    await writeFile(join(casa, '.codex', 'config.toml'), [...topo, ...tabelas, ''].join('\n'));
    expect((await rodar(casa, diretorio, `cat ${join(diretorio, 'parte.txt')}`)).saida).toContain('FRASE-DA-PARTE');
    expect((await rodar(casa, diretorio, `cat ${join(anexo, 'a.txt')}`)).saida).toContain('FRASE-DO-ANEXO');
    expect((await rodar(casa, diretorio, `cat ${join(fora, 'livro.txt')}`)).saida).not.toContain('FRASE-DE-OUTRO-LIVRO');
    expect((await rodar(casa, diretorio, `ls ${homedir()}`)).codigo).not.toBe(0);
    expect((await rodar(casa, diretorio, `touch ${join(diretorio, 'novo')} && echo GRAVOU`)).saida).not.toContain('GRAVOU');
    expect((await rodar(casa, diretorio, 'curl -sS -m 5 https://example.com -o /dev/null && echo REDE')).saida).not.toContain('REDE');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
