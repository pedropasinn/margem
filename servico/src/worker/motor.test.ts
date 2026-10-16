import { cp, mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';
import { raizDoRepositorio } from '../dados.js';
import { rodarMotor } from './canonizar.js';

test('motor executa o código da worktree sem atalho, com venv compartilhado e caminhos relativos', async () => {
  const raiz = raizDoRepositorio();
  const copia = await mkdtemp(join(tmpdir(), 'margem motor '));
  try {
    await mkdir(join(copia, 'motor'));
    await cp(join(raiz, 'motor/margem_motor'), join(copia, 'motor/margem_motor'), { recursive: true });
    await symlink(join(raiz, 'motor/.venv'), join(copia, 'motor/.venv'));
    await cp(join(raiz, 'fixtures/colado.txt'), join(copia, 'entrada.txt'));
    const resultado = await rodarMotor(relative(process.cwd(), copia), 'entrada.txt', 'txt', 'saida', {});
    expect(resultado.estado, resultado.mensagem).toBe('ok');
    expect(resultado.caminho).toBe(join(copia, 'saida/canonico.json'));
    const canonico = JSON.parse(await readFile(join(copia, 'saida/canonico.json'), 'utf8')) as { blocos: unknown[] };
    expect(canonico.blocos.length).toBeGreaterThan(0);
  } finally {
    await rm(copia, { recursive: true, force: true });
  }
});

test('I-07: título, reserva e autor começando com hífen chegam literais ao motor', async () => {
  const raiz = raizDoRepositorio();
  const pasta = await mkdtemp(join(tmpdir(), 'margem-i07-'));
  try {
    await cp(join(raiz, 'fixtures/colado.txt'), join(pasta, 'entrada.txt'));
    const comTitulo = await rodarMotor(raiz, join(pasta, 'entrada.txt'), 'txt', join(pasta, 'a'), { titulo: '-rascunho "um" ação 🙂', autor: '--fulano de tal' });
    expect(comTitulo.estado, comTitulo.mensagem).toBe('ok');
    const a = JSON.parse(await readFile(join(pasta, 'a/canonico.json'), 'utf8')) as { documento: { titulo: string; autor?: string } };
    expect(a.documento).toMatchObject({ titulo: '-rascunho "um" ação 🙂', autor: '--fulano de tal' });
    const comReserva = await rodarMotor(raiz, join(pasta, 'entrada.txt'), 'txt', join(pasta, 'b'), { tituloReserva: '--livro' });
    expect(comReserva.estado, comReserva.mensagem).toBe('ok');
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});
