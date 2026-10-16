import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estadoDoLogin, iniciarLogin, mensagemDaFalhaDoCodex, type EventoDoLogin } from '../src/nucleo/codex.js';
import { erroDaFalha, executarDeVerdade, sanear, versaoDosBinarios } from '../src/nucleo/postgres.js';

let pasta = '';
beforeAll(async () => { pasta = await mkdtemp(join(tmpdir(), 'margem-diagnostico-')); });
afterAll(async () => { await rm(pasta, { recursive: true, force: true }); });

describe('W-06: o programa do banco não rodou', () => {
  it('ausente, acesso negado e prazo esgotado viram mensagens diferentes, com o diagnóstico junto', () => {
    const ausente = erroDaFalha({ codigo: 'ENOENT', executavel: '/app/postgres/bin/postgres', mensagem: 'spawn ENOENT' });
    expect(ausente).toMatchObject({ codigo: 'binarios_ausentes', falha: { codigo: 'ENOENT', executavel: '/app/postgres/bin/postgres' } });
    expect(ausente.message).toMatch(/não foi encontrado.*reinstale/su);
    for (const codigo of ['EACCES', 'EPERM']) {
      const bloqueado = erroDaFalha({ codigo, executavel: 'C:\\Margem\\postgres.exe', mensagem: 'spawn EPERM' });
      expect(bloqueado.codigo).toBe('bloqueado');
      expect(bloqueado.message).toMatch(/antivírus.*Tentar novamente/su);
      expect(bloqueado.detalhe).toContain(codigo);
    }
    const lento = erroDaFalha({ codigo: 'ETIMEDOUT', executavel: '/x/initdb', mensagem: 'prazo' });
    expect(lento.codigo).toBe('tempo_esgotado');
    expect(lento.message).toMatch(/não respondeu a tempo/u);
  });

  it('o executor de verdade preserva o código do sistema e o executável', async () => {
    const inexistente = join(pasta, 'nao-existe');
    const r1 = await executarDeVerdade(inexistente, ['--version']);
    expect(r1.falha).toMatchObject({ codigo: 'ENOENT', executavel: inexistente });
    await expect(versaoDosBinarios({ postgres: inexistente, initdb: '', pgCtl: '', origem: 'embutido' })).rejects.toMatchObject({ codigo: 'binarios_ausentes' });
    if (process.platform !== 'win32') {
      const semPermissao = join(pasta, 'sem-permissao');
      await writeFile(semPermissao, '#!/bin/sh\necho oi\n');
      await chmod(semPermissao, 0o600);
      expect((await executarDeVerdade(semPermissao, [])).falha?.codigo).toBe('EACCES');
      expect((await executarDeVerdade(semPermissao, [], 'entrada')).falha?.codigo).toBe('EACCES');
      await expect(versaoDosBinarios({ postgres: semPermissao, initdb: '', pgCtl: '', origem: 'embutido' })).rejects.toMatchObject({ codigo: 'bloqueado' });
      // Programa que roda e falha não é "não rodou".
      const falha = join(pasta, 'falha');
      await writeFile(falha, '#!/bin/sh\nexit 3\n');
      await chmod(falha, 0o700);
      expect(await executarDeVerdade(falha, [])).toEqual({ codigo: 3, saida: '' });
    }
  });

  it('mensagens saneadas: sem senha de URL e curtas', () => {
    expect(sanear('falhou postgres://margem:segredo@127.0.0.1:5433/margem')).toBe('falhou postgres://***@127.0.0.1:5433/margem');
    expect(sanear('x'.repeat(1000)).length).toBe(400);
  });
});

describe('W-06: a CLI do Codex não rodou', () => {
  it('as frases distinguem ausência, bloqueio e prazo', () => {
    expect(mensagemDaFalhaDoCodex('ENOENT')).toMatch(/não foi encontrada/u);
    expect(mensagemDaFalhaDoCodex('EACCES')).toMatch(/antivírus/u);
    expect(mensagemDaFalhaDoCodex('EPERM')).toMatch(/antivírus/u);
    expect(mensagemDaFalhaDoCodex('ETIMEDOUT')).toMatch(/não respondeu a tempo/u);
  });

  it('login: o erro de criação do processo vira a frase certa, com o código para os registros', async () => {
    const eventos: EventoDoLogin[] = [];
    const login = iniciarLogin('/x/codex', join(pasta, 'codex'), false, (evento) => { eventos.push(evento); }, () => {
      const falso = new EventEmitter() as unknown as ChildProcess;
      setImmediate(() => { falso.emit('error', Object.assign(new Error('spawn /x/codex EACCES'), { code: 'EACCES' })); });
      return falso;
    });
    expect(await login.resultado).toBe(false);
    expect(eventos).toEqual([{ tipo: 'falhou', valor: mensagemDaFalhaDoCodex('EACCES'), codigo: 'EACCES' }]);
  });

  it('estado do login: ausente e sem permissão são diferentes', async () => {
    const ausente = await estadoDoLogin(join(pasta, 'codex-nao-existe'), join(pasta, 'codex'));
    expect(ausente).toMatchObject({ encontrado: false, falha: { codigo: 'ENOENT' } });
    if (process.platform !== 'win32') {
      const semPermissao = join(pasta, 'codex-sem-permissao');
      await writeFile(semPermissao, '#!/bin/sh\necho oi\n');
      await chmod(semPermissao, 0o600);
      expect(await estadoDoLogin(semPermissao, join(pasta, 'codex'))).toMatchObject({ encontrado: true, logado: null, falha: { codigo: 'EACCES' } });
    }
  });
});

describe('W-04: o login recebe o proxy e os certificados da empresa', () => {
  it('em qualquer caixa, sem a URL do banco', async () => {
    const { ambienteDoCodex } = await import('../src/nucleo/codex.js');
    const ambiente = ambienteDoCodex('/u/codex', {
      https_proxy: 'http://proxy:3128', HTTP_PROXY: 'http://proxy:3128', NO_PROXY: 'intranet', NODE_EXTRA_CA_CERTS: '/ca.pem', SSL_CERT_FILE: '/ca.pem',
      DATABASE_URL: 'postgres://x:senha@h/b',
    });
    expect(ambiente).toMatchObject({ https_proxy: 'http://proxy:3128', HTTP_PROXY: 'http://proxy:3128', NO_PROXY: 'intranet', NODE_EXTRA_CA_CERTS: '/ca.pem', SSL_CERT_FILE: '/ca.pem', CODEX_HOME: '/u/codex' });
    expect(ambiente.DATABASE_URL).toBeUndefined();
  });
});
