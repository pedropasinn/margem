/**
 * Prova do S-05 com o sandbox REAL do Codex por dentro do `bwrap` externo, sem modelo e sem rede:
 * `bwrap <montarConfinamento> codex sandbox -- sh -c <comando>`, com a casa temporária montada como no
 * executor e a política que `prepararPoliticaNoBwrap` escreve. A credencial é fictícia. Só roda com
 * `MARGEM_PROVA_SANDBOX=<binário do codex>` no Linux com bwrap; na suíte normal fica pulado.
 *
 *   MARGEM_PROVA_SANDBOX=/caminho/do/codex npx vitest run --project servico src/executor/confinamento-bwrap.real.test.ts
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { ambienteConfinado, montarConfinamento, pastaDoMotor, prepararPoliticaNoBwrap, type PoliticaNativa } from './confinamento.js';

const codex = process.env.MARGEM_PROVA_SANDBOX?.trim() ?? '';
const bwrap = process.env.MARGEM_BWRAP?.trim() || '/usr/bin/bwrap';

async function rodar(base: string, politica: PoliticaNativa, comando: string): Promise<string> {
  const casa = join(base, `casa-${politica}`);
  const diretorio = join(base, 'job');
  await mkdir(join(casa, '.codex'), { recursive: true });
  await writeFile(join(casa, '.codex', 'auth.json'), '{"token":"CREDENCIAL-FICTICIA-5521"}\n');
  const motor = await pastaDoMotor(codex);
  // O `codex exec` real recebe estes argumentos; aqui só importa o config.toml que a função escreve.
  await prepararPoliticaNoBwrap({ casa, diretorio, pastaDoMotor: motor.pasta, politica, argumentos: ['exec', '--sandbox', 'read-only', '--', 'x'] });
  const linha = [...montarConfinamento({ motor: motor.real, pastaDoMotor: motor.pasta, diretorio, casa }), 'sandbox', '--', 'sh', '-c', comando];
  return new Promise((resolver) => {
    execFile(bwrap, linha, { cwd: diretorio, env: ambienteConfinado(casa, {}), timeout: 30_000 }, (_erro, saida, saidaErro) => {
      resolver(`${saida}${saidaErro}`);
    });
  });
}

test.skipIf(codex === '' || process.platform !== 'linux' || !existsSync(bwrap))('S-05: no bwrap, a ferramenta confinada não lê o auth.json da casa; o diretório continua legível', async () => {
  const base = await mkdtemp(join(tmpdir(), 'margem-prova-s05-'));
  try {
    const diretorio = join(base, 'job');
    await mkdir(diretorio);
    await writeFile(join(diretorio, 'parte.txt'), 'FRASE-DA-PARTE-8812\n');
    const credencial = (politica: PoliticaNativa) => `cat ${join(base, `casa-${politica}`, '.codex', 'auth.json')}`;
    // Antes (read-only dentro do bwrap): a credencial aparece. É o que o S-05 descreve.
    expect(await rodar(base, 'somente-leitura', credencial('somente-leitura'))).toContain('CREDENCIAL-FICTICIA-5521');
    // Com o perfil: a parte sim, a casa não.
    expect(await rodar(base, 'perfil', `cat ${join(diretorio, 'parte.txt')}`)).toContain('FRASE-DA-PARTE-8812');
    expect(await rodar(base, 'perfil', credencial('perfil'))).not.toContain('CREDENCIAL-FICTICIA-5521');
    expect(await rodar(base, 'perfil', `ls ${join(base, 'casa-perfil')} && echo LISTOU`)).not.toContain('LISTOU');
    expect(await rodar(base, 'perfil', `touch ${join(diretorio, 'novo')} && echo GRAVOU`)).not.toContain('GRAVOU');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}, 120_000);
