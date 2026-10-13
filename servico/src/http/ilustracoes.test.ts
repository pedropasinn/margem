import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lerIlustracoes, arquivoDaIlustracao } from './ilustracoes.js';
import { pastaDaVersao } from '../dados.js';
const documento = '01M3JEKK3D9Q8BE1HGYF4QWZKG';
const versao = '01M3JEKMCCHSE2TZQ8N203H20B';
let raiz: string;
let pasta: string;
beforeEach(async () => {
  raiz = await mkdtemp(join(tmpdir(), 'margem-ilustracoes-'));
  vi.stubEnv('MARGEM_DADOS', raiz);
  pasta = pastaDaVersao(documento, versao);
  await mkdir(join(pasta, 'ilustracoes'), { recursive: true });
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(raiz, { recursive: true, force: true }); });
async function manifesto(arquivo = 'diagrama.svg', versaoId = versao) {
  await writeFile(join(pasta, 'ilustracoes.json'), JSON.stringify({ versao_id: versaoId, figuras: [
    { bloco_id: '18WG3SP23QS7R3HG0WRW5J7CE0', arquivo, alt: 'Diagrama', posicao: 'antes' },
  ] }));
}
test('versão sem complemento continua legível; somente imagens declaradas são servidas', async () => {
  expect(await lerIlustracoes(documento, versao)).toEqual([]);
  await manifesto();
  await writeFile(join(pasta, 'ilustracoes/diagrama.svg'), '<svg/>');
  expect(await arquivoDaIlustracao(documento, versao, 'diagrama.svg')).toBe(join(pasta, 'ilustracoes/diagrama.svg'));
  expect(await arquivoDaIlustracao(documento, versao, 'outra.svg')).toBeNull();
  expect(await arquivoDaIlustracao(documento, versao, '../canonico.json')).toBeNull();
});
test('recusa manifesto de outra versão e caminho arbitrário', async () => {
  await manifesto('diagrama.svg', documento);
  await expect(lerIlustracoes(documento, versao)).rejects.toThrow();
  await manifesto('../segredo.svg');
  await expect(lerIlustracoes(documento, versao)).rejects.toThrow();
});
test('link simbólico não permite ler arquivos de outra versão', async () => {
  await manifesto();
  await writeFile(join(raiz, 'privado.svg'), '<svg/>');
  await symlink(join(raiz, 'privado.svg'), join(pasta, 'ilustracoes/diagrama.svg'));
  expect(await arquivoDaIlustracao(documento, versao, 'diagrama.svg')).toBeNull();
});
