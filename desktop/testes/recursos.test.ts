import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { executavel, plataformaAtual } from '../src/nucleo/plataforma.js';
import { localDosRecursos, procurarNoPath, resolverRecursos, resumoDosRecursos, type Disco } from '../src/nucleo/recursos.js';

function discoCom(arquivos: string[], pastas: string[] = []): Disco {
  const conjunto = new Set(arquivos);
  return { executavel: (c) => conjunto.has(c), arquivo: (c) => conjunto.has(c), pasta: (c) => pastas.includes(c) };
}

describe('plataforma', () => {
  it('nomeia as quatro plataformas e recusa as outras', () => {
    expect(plataformaAtual('linux', 'x64')).toBe('linux-x64');
    expect(plataformaAtual('darwin', 'arm64')).toBe('darwin-arm64');
    expect(plataformaAtual('win32', 'x64')).toBe('win32-x64');
    expect(() => plataformaAtual('linux', 'arm64')).toThrow(/sem suporte/);
    expect(executavel('codex', 'win32')).toBe('codex.exe');
    expect(executavel('codex', 'linux')).toBe('codex');
  });
});

describe('local dos recursos', () => {
  it('empacotado: resourcesPath/margem e resourcesPath/recursos', () => {
    expect(localDosRecursos({ empacotado: true, resourcesPath: '/app/res', pastaDoDesktop: '/x', plataforma: 'linux-x64' }))
      .toEqual({ raizApp: join('/app/res', 'margem'), recursos: join('/app/res', 'recursos'), empacotado: true });
  });
  it('desenvolvimento: desktop/dist/raiz e desktop/recursos/<plataforma>', () => {
    expect(localDosRecursos({ empacotado: false, resourcesPath: '/x', pastaDoDesktop: '/repo/desktop', plataforma: 'darwin-x64' }))
      .toEqual({ raizApp: join('/repo/desktop', 'dist', 'raiz'), recursos: join('/repo/desktop', 'recursos', 'darwin-x64'), empacotado: false });
  });
});

describe('resolução', () => {
  const empacotado = { raizApp: '/r/margem', recursos: '/r/recursos', empacotado: true };
  const dev = { ...empacotado, empacotado: false };
  const completo = [
    '/r/recursos/postgres/bin/initdb', '/r/recursos/postgres/bin/pg_ctl', '/r/recursos/postgres/bin/postgres',
    '/r/recursos/bin/codex', '/r/recursos/motor/margem-motor', '/r/recursos/bin/ffmpeg', '/r/recursos/fontes/DejaVuSans.ttf',
  ];

  it('empacotado: só o que veio dentro, nunca o PATH', () => {
    const disco = discoCom([...completo, '/usr/bin/ffprobe', '/usr/bin/yt-dlp'], ['/r/recursos/bin']);
    const r = resolverRecursos({ local: empacotado, sistema: 'linux', disco, ambiente: { PATH: '/usr/bin' } });
    expect(r.postgres).toMatchObject({ origem: 'embutido', pgCtl: '/r/recursos/postgres/bin/pg_ctl' });
    expect(r.codex).toEqual({ caminho: '/r/recursos/bin/codex', origem: 'embutido' });
    expect(r.motor).toEqual({ caminho: '/r/recursos/motor/margem-motor', origem: 'embutido' });
    expect(r.fonte).toEqual({ caminho: '/r/recursos/fontes/DejaVuSans.ttf', origem: 'embutido' });
    expect(r.ffmpeg?.origem).toBe('embutido');
    expect(r.ytDlp).toBeNull();
    expect(r.ffprobe).toBeNull();
    expect(r.pastaBin).toBe('/r/recursos/bin');
    expect(resumoDosRecursos(r).ffprobe).toBe('ausente');
  });

  it('desenvolvimento: o que faltar vem do PATH', () => {
    const disco = discoCom([...completo, '/usr/bin/ffprobe', '/usr/bin/codex']);
    const r = resolverRecursos({ local: dev, sistema: 'linux', disco, ambiente: { PATH: '/usr/bin' } });
    expect(r.codex?.origem).toBe('embutido');
    expect(r.ffprobe).toEqual({ caminho: '/usr/bin/ffprobe', origem: 'sistema' });
    expect(r.pastaBin).toBeNull();
  });

  it('Windows: .exe no embutido e PATHEXT no PATH', () => {
    const w = { raizApp: 'C:\\M\\margem', recursos: 'C:\\M\\recursos', empacotado: false };
    const disco = discoCom([join(w.recursos, 'bin', 'codex.exe'), join(w.recursos, 'postgres', 'bin', 'initdb.exe'),
      join(w.recursos, 'postgres', 'bin', 'pg_ctl.exe'), join(w.recursos, 'postgres', 'bin', 'postgres.exe'),
      join(w.recursos, 'motor', 'margem-motor.exe'), join('C:\\Tools', 'ffmpeg.exe')]);
    const r = resolverRecursos({ local: w, sistema: 'win32', disco, ambiente: { Path: 'C:\\Tools', PATHEXT: '.EXE;.CMD' } });
    expect(r.codex?.caminho).toBe(join(w.recursos, 'bin', 'codex.exe'));
    expect(r.postgres?.initdb).toBe(join(w.recursos, 'postgres', 'bin', 'initdb.exe'));
    expect(r.motor?.caminho).toBe(join(w.recursos, 'motor', 'margem-motor.exe'));
    expect(r.ffmpeg).toEqual({ caminho: join('C:\\Tools', 'ffmpeg.exe'), origem: 'sistema' });
    expect(procurarNoPath('ffmpeg', { Path: 'C:\\Tools', PATHEXT: '.EXE' }, 'win32', disco)).toBe(join('C:\\Tools', 'ffmpeg.exe'));
  });

  it('sem nada: tudo ausente, sem lançar', () => {
    const r = resolverRecursos({ local: empacotado, sistema: 'darwin', disco: discoCom([]), ambiente: {} });
    expect(r.postgres).toBeNull();
    expect(r.codex).toBeNull();
    expect(r.motor).toBeNull();
    expect(r.fonte).toBeNull();
  });
});
