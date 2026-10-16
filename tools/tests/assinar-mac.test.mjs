// macOS sem certificado (J154): achar os Mach-O pelo número mágico, a ordem de assinatura (de dentro
// para fora), a leitura do otool/lipo e a configuração do electron-builder. Sem macOS e sem rede.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  arquiteturaDoMac, arquiteturasDoLipo, assinarAdHoc, dependenciasDeFora, dependenciasDoOtool, ehMachO, listarMachO, ordemDeAssinatura,
} from '../../desktop/recursos/assinar-mac.mjs';

const cabecalho = (...palavras) => { const b = Buffer.alloc(8); palavras.forEach((p, i) => b.writeUInt32BE(p, i * 4)); return b; };

test('Mach-O pelo número mágico: fino (32/64, as duas ordens de bytes) e universal; classe Java e texto não', () => {
  assert.equal(ehMachO(cabecalho(0xcffaedfe, 0)), true); // arm64/x86_64 (little-endian no disco)
  assert.equal(ehMachO(cabecalho(0xfeedfacf, 0)), true);
  assert.equal(ehMachO(cabecalho(0xcefaedfe, 0)), true);
  assert.equal(ehMachO(cabecalho(0xcafebabe, 2)), true); // universal com 2 arquiteturas
  assert.equal(ehMachO(cabecalho(0xcafebabe, 0x00000034)), false); // classe Java (versão 52)
  assert.equal(ehMachO(Buffer.from('#!/bin/sh\n')), false);
  assert.equal(ehMachO(Buffer.from([0xcf, 0xfa])), false);
});

test('lista os Mach-O sem seguir link simbólico e assina do mais fundo para fora', async () => {
  const pasta = await mkdtemp(join(tmpdir(), 'margem-assinar-'));
  try {
    await mkdir(join(pasta, 'postgres', 'lib', 'postgresql'), { recursive: true });
    await mkdir(join(pasta, 'bin'), { recursive: true });
    const macho = Buffer.concat([cabecalho(0xcffaedfe, 0x0100000c), Buffer.alloc(64)]);
    await writeFile(join(pasta, 'bin', 'codex'), macho);
    await writeFile(join(pasta, 'postgres', 'lib', 'libpq.5.dylib'), macho);
    await writeFile(join(pasta, 'postgres', 'lib', 'postgresql', 'plpgsql.dylib'), macho);
    await writeFile(join(pasta, 'postgres', 'leia.txt'), 'texto');
    await symlink('libpq.5.dylib', join(pasta, 'postgres', 'lib', 'libpq.dylib'));
    const achados = (await listarMachO(pasta)).map((c) => c.slice(pasta.length + 1)).sort();
    assert.deepEqual(achados, ['bin/codex', 'postgres/lib/libpq.5.dylib', 'postgres/lib/postgresql/plpgsql.dylib']);
    assert.deepEqual(ordemDeAssinatura(achados), ['postgres/lib/postgresql/plpgsql.dylib', 'postgres/lib/libpq.5.dylib', 'bin/codex']);

    const chamadas = [];
    const n = await assinarAdHoc(pasta, { rodar: (programa, args) => { chamadas.push([programa, ...args]); return { status: 0, saida: '' }; }, log: () => undefined });
    assert.equal(n, 3);
    assert.ok(chamadas.every((c) => c.slice(0, 5).join(' ') === 'codesign --force --sign - --timestamp=none'));
    assert.match(chamadas[0].at(-1), /plpgsql\.dylib$/u);
    await assert.rejects(
      assinarAdHoc(pasta, { rodar: () => ({ status: 1, saida: 'erro de verdade' }), log: () => undefined }),
      /codesign falhou em 3 de 3[\s\S]*erro de verdade/u,
    );
  } finally {
    await rm(pasta, { recursive: true, force: true });
  }
});

test('otool -L: dependências do sistema e relativas passam; Homebrew e pasta do runner, não', () => {
  const saida = [
    '/Applications/Margem.app/Contents/Resources/recursos/postgres/bin/postgres:',
    '\t@rpath/libzstd.1.dylib (compatibility version 1.0.0, current version 1.5.7)',
    '\t/usr/lib/libpam.2.dylib (compatibility version 3.0.0, current version 3.0.0)',
    '\t/System/Library/Frameworks/LDAP.framework/Versions/A/LDAP (compatibility version 1.0.0, current version 2.4.0)',
    '\t@loader_path/../lib/libssl.3.dylib (compatibility version 3.0.0, current version 3.0.0)',
    '\t/opt/homebrew/opt/icu4c/lib/libicuuc.77.dylib (compatibility version 77.0.0, current version 77.1.0)',
    '\t/Users/runner/work/x/libfoo.dylib (compatibility version 1.0.0, current version 1.0.0)',
    '',
  ].join('\n');
  const deps = dependenciasDoOtool(saida);
  assert.equal(deps.length, 6);
  assert.deepEqual(dependenciasDeFora(deps), ['/opt/homebrew/opt/icu4c/lib/libicuuc.77.dylib', '/Users/runner/work/x/libfoo.dylib']);
  assert.deepEqual(dependenciasDeFora(['/Library/Frameworks/Python.framework/Versions/3.12/Python', '/usr/local/lib/libx.dylib'], ['/Library/Frameworks/Python.framework/Versions/3.12/Python']), ['/usr/local/lib/libx.dylib']);
  // Universal: o otool repete o nome por arquitetura ("(architecture arm64):").
  assert.deepEqual(dependenciasDoOtool('a (architecture x86_64):\n\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\na (architecture arm64):\n'), ['/usr/lib/libSystem.B.dylib']);
});

test('lipo -archs e o nome da arquitetura', () => {
  assert.deepEqual(arquiteturasDoLipo('x86_64 arm64\n'), ['x86_64', 'arm64']);
  assert.equal(arquiteturaDoMac('x64'), 'x86_64');
  assert.equal(arquiteturaDoMac('arm64'), 'arm64');
  assert.throws(() => arquiteturaDoMac('ia32'));
});

test('electron-builder no macOS: Margem.app (não margem.app), mínimo 14, ad hoc sem carimbo e recursos já assinados', async () => {
  const empacotar = await readFile(new URL('../../desktop/scripts/empacotar.mjs', import.meta.url), 'utf8');
  const mac = empacotar.slice(empacotar.indexOf('  mac: {'), empacotar.indexOf('  dmg: {'));
  assert.match(mac, /executableName: 'Margem'/u);
  assert.match(mac, /minimumSystemVersion: '14\.0'/u);
  assert.match(mac, /identity: '-'/u);
  assert.match(mac, /timestamp: 'none'/u);
  assert.match(mac, /signIgnore: \['\/Contents\/Resources\/\(recursos\|margem\)\/'\]/u);
  assert.match(empacotar, /dmg: \{ artifactName: 'Margem-mac-\$\{arch\}\.dmg'/u);
  assert.ok(new RegExp("/Contents/Resources/(recursos|margem)/").test('/x/Margem.app/Contents/Resources/recursos/postgres/bin/postgres'));
  const preparar = await readFile(new URL('../../desktop/recursos/preparar.mjs', import.meta.url), 'utf8');
  assert.match(preparar, /await assinarNoMac\(alvo, plataforma, log\)/u);
});

test('workflow: ci/macos roda só o macOS; o app do .dmg é conferido antes da fumaça, que usa o executável do Info.plist', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/app.yml', import.meta.url), 'utf8');
  assert.match(workflow, /branches: \['ci\/windows', 'ci\/macos', 'ci\/linux'\]/u);
  assert.match(workflow, /replace\(\/\^ci\[\/\]\/, ''\)/u);
  const conferir = workflow.indexOf('node desktop/scripts/conferir-mac.mjs');
  const fumaca = workflow.indexOf('fumaca.mjs --app "$MARGEM_APP_INSTALADO" --manter-se-falhar', conferir);
  assert.ok(conferir > 0 && fumaca > conferir);
  // Nada de `codesign … && echo`: a falha num `&&` não para o passo (auditoria M-02).
  assert.doesNotMatch(workflow, /codesign[^\n]*&&/u);
  assert.doesNotMatch(workflow, /Contents\/MacOS\/Margem"/u);
});
