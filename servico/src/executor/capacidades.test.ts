import { expect, test } from 'vitest';
import { FLAGS_NECESSARIAS, detectarCapacidades, flagPresente, lerCapacidades } from './capacidades.js';
import type { ExecutarComando } from './capacidades.js';
import { executarCodex } from './codex.js';

const AJUDA_COMPLETA = `Run Codex non-interactively

Options:
  -c, --config <key=value>
  -m, --model <MODEL>
  -s, --sandbox <SANDBOX_MODE>
      --dangerously-bypass-hook-trust
  -C, --cd <DIR>
      --skip-git-repo-check
      --ephemeral
      --ignore-user-config
      --output-schema <FILE>
      --json
  -o, --output-last-message <FILE>
`;

function comando(versao: string, ajuda: string, codigo = 0): ExecutarComando {
  return (_arquivo, argumentos) =>
    Promise.resolve(argumentos[0] === '--version' ? { codigo, saida: versao } : { codigo, saida: ajuda });
}

test('reconhece as flags da ajuda real da CLI local', () => {
  const capacidades = lerCapacidades('codex-cli 0.154.0', AJUDA_COMPLETA);
  expect(capacidades.versao).toBe('codex-cli 0.154.0');
  expect(capacidades.faltando).toEqual([]);
  for (const flag of FLAGS_NECESSARIAS) expect(capacidades.flags[flag]).toBe(true);
  expect(capacidades.flags['--ephemeral']).toBe(true);
});

test('flagPresente não confunde prefixos', () => {
  expect(flagPresente(AJUDA_COMPLETA, '--output-schema')).toBe(true);
  expect(flagPresente(AJUDA_COMPLETA, '--output')).toBe(false);
  expect(flagPresente(AJUDA_COMPLETA, '--worktree')).toBe(false);
});

test('detectarCapacidades usa o comando injetado e acusa flag ausente', async () => {
  const semSchema = AJUDA_COMPLETA.replace('      --output-schema <FILE>\n', '');
  const capacidades = await detectarCapacidades({ executarComando: comando('codex-cli 0.1.0', semSchema) });
  expect(capacidades.faltando).toEqual(['--output-schema']);
});

test('CLI incompatível falha em vez de omitir a flag', async () => {
  const capacidades = await detectarCapacidades({ executarComando: comando('codex-cli 0.1.0', 'Options:\n  -c, --config\n') });
  const resultado = await executarCodex(
    { diretorioEntrada: '/inexistente', prompt: 'nada', schema: '/inexistente/schema.json', prazoMs: 1_000 },
    { capacidades },
  );
  expect(resultado.estado).toBe('falhou');
  if (resultado.estado === 'falhou') {
    expect(resultado.codigo).toBe('cli_incompativel');
    expect(resultado.mensagem).toContain('--output-schema');
  }
});
