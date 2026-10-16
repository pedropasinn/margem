#!/usr/bin/env node
/**
 * Conferência do Margem.app tirado do .dmg (J154), no CI do macOS, antes da fumaça. Falha (código 1)
 * com a lista do que está errado; não muda nada no app.
 *
 *   node desktop/scripts/conferir-mac.mjs --app "<…>/Margem.app" --arch arm64|x64
 *
 * 1. Info.plist: o executável principal (CFBundleExecutable, o nome real dentro de Contents/MacOS),
 *    a versão mínima do macOS e o identificador. Com GITHUB_ENV, grava MARGEM_APP_INSTALADO (o
 *    executável) para o passo da fumaça.
 * 2. `codesign --verify --deep --strict` no .app inteiro (assinatura ad hoc ou Developer ID).
 * 3. Cada Mach-O de Contents/Resources/recursos (Postgres, Codex, yt-dlp, FFmpeg, motor): assinatura
 *    válida, a arquitetura do runner presente (`lipo -archs`) e nenhuma dependência de fora do sistema
 *    (`otool -L`: /opt/homebrew, /usr/local, pasta do runner…).
 * 4. Informativo: quantos arquivos têm com.apple.quarantine (no CI, nenhum: o .dmg não veio de navegador).
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  arquiteturaDoMac, arquiteturasDoLipo, dependenciasDeFora, dependenciasDoOtool, listarMachO,
} from '../recursos/assinar-mac.mjs';

const argv = process.argv.slice(2);
const opcao = (nome) => { const i = argv.indexOf(nome); return i >= 0 ? argv[i + 1] : undefined; };
const app = resolve(opcao('--app') ?? '');
const arch = opcao('--arch') ?? (process.arch === 'arm64' ? 'arm64' : 'x64');
if (!app.endsWith('.app') || !existsSync(app)) {
  console.error(`--app: passe o caminho do Margem.app (veio ${app})`);
  process.exit(2);
}

function rodar(programa, argumentos) {
  const r = spawnSync(programa, argumentos, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  return { status: r.error ? -1 : r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}`.trim() };
}

const problemas = [];
const plist = join(app, 'Contents', 'Info.plist');
const chave = (nome) => { const r = rodar('plutil', ['-extract', nome, 'raw', '-o', '-', plist]); return r.status === 0 ? r.saida : null; };

// 1. Info.plist
const nomeDoExecutavel = chave('CFBundleExecutable');
const executavel = nomeDoExecutavel === null ? null : join(app, 'Contents', 'MacOS', nomeDoExecutavel);
console.log(`CFBundleExecutable: ${String(nomeDoExecutavel)}`);
console.log(`CFBundleIdentifier: ${String(chave('CFBundleIdentifier'))}`);
console.log(`CFBundleShortVersionString: ${String(chave('CFBundleShortVersionString'))}`);
console.log(`LSMinimumSystemVersion: ${String(chave('LSMinimumSystemVersion'))}`);
if (executavel === null || !existsSync(executavel)) problemas.push(`executável principal ausente (${String(executavel)})`);
else if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `MARGEM_APP_INSTALADO=${executavel}\n`);

// 2. O .app inteiro
const doApp = rodar('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
console.log(`codesign --verify --deep --strict: ${doApp.status === 0 ? 'ok' : 'FALHOU'}\n${doApp.saida.split('\n').slice(-6).join('\n')}`);
if (doApp.status !== 0) problemas.push(`assinatura do .app inválida: ${doApp.saida.split('\n').at(-1) ?? ''}`);
console.log(rodar('codesign', ['-dv', app]).saida.split('\n').filter((l) => /^(Identifier|Format|Signature|TeamIdentifier|Runtime|CodeDirectory)/u.test(l)).join('\n'));

// 3. Os binários embutidos
const recursos = join(app, 'Contents', 'Resources', 'recursos');
const esperada = arquiteturaDoMac(arch);
const binarios = existsSync(recursos) ? await listarMachO(recursos) : [];
if (binarios.length === 0) problemas.push(`nenhum Mach-O em ${recursos}`);
const porTipo = { assinatura: 0, arquitetura: 0, dependencia: 0 };
for (const binario of binarios) {
  const nome = relative(recursos, binario);
  const assinatura = rodar('codesign', ['--verify', '--strict', binario]);
  if (assinatura.status !== 0) { porTipo.assinatura += 1; problemas.push(`${nome}: assinatura inválida (${assinatura.saida.split('\n').at(-1) ?? ''})`); }
  const archs = arquiteturasDoLipo(rodar('lipo', ['-archs', binario]).saida);
  if (!archs.includes(esperada) && !(esperada === 'arm64' && archs.includes('arm64e'))) { porTipo.arquitetura += 1; problemas.push(`${nome}: sem ${esperada} (tem ${archs.join(', ') || 'nada'})`); }
  const nomesProprios = rodar('otool', ['-D', binario]).saida.split('\n').slice(1).map((l) => l.trim());
  const fora = dependenciasDeFora(dependenciasDoOtool(rodar('otool', ['-L', binario]).saida), nomesProprios);
  if (fora.length > 0) { porTipo.dependencia += 1; problemas.push(`${nome}: depende de fora do app e do sistema: ${fora.join(', ')}`); }
}
console.log(`Mach-O em recursos/: ${binarios.length} (assinatura inválida ${porTipo.assinatura}, sem ${esperada} ${porTipo.arquitetura}, dependência de fora ${porTipo.dependencia})`);
for (const essencial of ['postgres/bin/postgres', 'postgres/bin/initdb', 'postgres/bin/pg_ctl', 'bin/codex', 'bin/yt-dlp', 'bin/ffmpeg', 'bin/ffprobe', 'motor/margem-motor']) {
  if (!existsSync(join(recursos, essencial))) problemas.push(`falta recursos/${essencial}`);
}

// 4. Quarentena (informativo)
const quarentena = rodar('find', [app, '-xattrname', 'com.apple.quarantine']);
const emQuarentena = quarentena.status === 0 ? quarentena.saida.split('\n').filter((l) => l !== '').length : null;
console.log(`arquivos com com.apple.quarantine: ${emQuarentena ?? '(não deu para contar)'}`);

if (problemas.length > 0) {
  console.error(`\nconferência do macOS: ${problemas.length} problema(s)\n${problemas.slice(0, 80).map((p) => `  - ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('\nconferência do macOS: tudo certo');
