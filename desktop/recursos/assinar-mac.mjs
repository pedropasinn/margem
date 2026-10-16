/**
 * Assinatura ad hoc e conferência dos binários do macOS (J154), sem certificado da Apple.
 *
 * No Apple Silicon o kernel mata qualquer Mach-O sem assinatura válida (basta a ad hoc, `codesign --sign -`),
 * inclusive as bibliotecas carregadas por `dlopen`. Os binários que o app leva (Postgres do zonky, Codex,
 * yt-dlp, FFmpeg, motor do PyInstaller) já chegam assinados, mas cada um por um processo diferente; aqui
 * todos são assinados de novo, de dentro para fora (o mais fundo primeiro), para o app não depender disso.
 * O electron-builder depois assina o .app inteiro por cima (scripts/empacotar.mjs).
 *
 * Funções puras (achar Mach-O pelo número mágico, ler `otool -L` e `lipo -archs`) testadas em
 * tools/tests/assinar-mac.test.mjs; `codesign`, `otool` e `lipo` só existem no macOS.
 */
import { spawnSync } from 'node:child_process';
import { open, readdir, lstat } from 'node:fs/promises';
import { join, sep } from 'node:path';

const MAGICOS = new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]);
const MAGICOS_FAT = new Set([0xcafebabe, 0xcafebabf]);

/**
 * O começo do arquivo é de um Mach-O (fino ou universal)? `0xcafebabe` também abre classes Java: no
 * universal os 4 bytes seguintes são o número de arquiteturas (poucas); numa classe, a versão (≥ 45).
 */
export function ehMachO(cabecalho) {
  if (cabecalho.length < 8) return false;
  const magico = cabecalho.readUInt32BE(0);
  if (MAGICOS.has(magico)) return true;
  if (!MAGICOS_FAT.has(magico)) return false;
  const arquiteturas = cabecalho.readUInt32BE(4);
  return arquiteturas > 0 && arquiteturas < 20;
}

async function cabecalhoDe(caminho) {
  const arquivo = await open(caminho, 'r');
  try {
    const { buffer, bytesRead } = await arquivo.read(Buffer.alloc(8), 0, 8, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await arquivo.close();
  }
}

/** Todos os Mach-O da pasta (sem seguir links simbólicos: o alvo já está na lista ou é de fora). */
export async function listarMachO(pasta) {
  const achados = [];
  const visitar = async (atual) => {
    for (const nome of await readdir(atual)) {
      const caminho = join(atual, nome);
      const info = await lstat(caminho);
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) await visitar(caminho);
      else if (info.isFile() && info.size >= 8 && ehMachO(await cabecalhoDe(caminho))) achados.push(caminho);
    }
  };
  await visitar(pasta);
  return achados;
}

/** De dentro para fora: o mais fundo primeiro (o `codesign` sela o que já está assinado lá dentro). */
export function ordemDeAssinatura(caminhos) {
  const profundidade = (c) => c.split(sep).length;
  return [...caminhos].sort((a, b) => profundidade(b) - profundidade(a) || a.localeCompare(b));
}

function rodarPadrao(programa, argumentos) {
  const r = spawnSync(programa, argumentos, { encoding: 'utf8' });
  return { status: r.error ? -1 : r.status, saida: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? r.error.message : ''}` };
}

/**
 * Assina ad hoc cada Mach-O da pasta (`--timestamp=none`: assinatura ad hoc não leva carimbo de tempo).
 * Lança com a lista do que falhou.
 */
export async function assinarAdHoc(pasta, { rodar = rodarPadrao, log = console.log } = {}) {
  const binarios = ordemDeAssinatura(await listarMachO(pasta));
  const falhas = [];
  for (const binario of binarios) {
    const r = rodar('codesign', ['--force', '--sign', '-', '--timestamp=none', binario]);
    if (r.status !== 0) falhas.push(`${binario}: ${r.saida.trim().split('\n').at(-1) ?? ''}`);
  }
  if (falhas.length > 0) throw new Error(`codesign falhou em ${falhas.length} de ${binarios.length}:\n${falhas.slice(0, 40).join('\n')}`);
  log(`  assinatura ad hoc: ${binarios.length} Mach-O em ${pasta}`);
  return binarios.length;
}

/** As dependências de uma saída de `otool -L <arquivo>` (a 1ª linha é o próprio arquivo). */
export function dependenciasDoOtool(saida) {
  return saida.split('\n').slice(1)
    .map((linha) => linha.trim().replace(/\s+\(compatibility version.*$/u, ''))
    .filter((linha) => linha !== '' && !linha.endsWith(':'));
}

/**
 * Dependências que não vão existir no Mac de quem instala: tudo que não é do sistema (`/usr/lib`,
 * `/System`) nem relativo ao próprio binário (`@rpath`, `@loader_path`, `@executable_path`). Ex.:
 * `/opt/homebrew/…`, `/usr/local/…`, `/Users/runner/…`.
 */
export function dependenciasDeFora(dependencias, nomesProprios = []) {
  // O `otool -L` de uma dylib começa pelo nome dela mesma (LC_ID_DYLIB, de `otool -D`): não é dependência.
  return dependencias.filter((d) => !nomesProprios.includes(d) && !/^(?:\/usr\/lib\/|\/System\/|@rpath\/|@loader_path\/|@executable_path\/)/u.test(d));
}

/** `lipo -archs` → ['x86_64', 'arm64']. */
export function arquiteturasDoLipo(saida) {
  return saida.trim().split(/\s+/u).filter((a) => a !== '');
}

/** O nome da arquitetura do macOS para a do Node/electron-builder. */
export function arquiteturaDoMac(arch) {
  if (arch === 'arm64') return 'arm64';
  if (arch === 'x64') return 'x86_64';
  throw new Error(`arquitetura sem macOS: ${arch}`);
}
