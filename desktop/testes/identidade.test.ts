/**
 * Identidade da biblioteca (W-02, D-03): o id na pasta localiza o banco local, a senha e a cópia; renomear,
 * mover ou trocar só maiúsculas continua achando o mesmo banco; duas pastas com o mesmo id não dividem banco.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { arquivoDaSenha, pastasDaBiblioteca } from '../src/nucleo/configuracao.js';
import {
  adotarDoLegado, caminhoDoMarcador, gravarMarcador, identificarBiblioteca, idLegadoDaBiblioteca, lerIdDaPasta, lerRegistro, mesmaPasta, type OpcoesDaIdentidade,
} from '../src/nucleo/identidade.js';

let raiz = '';
beforeEach(async () => { raiz = await mkdtemp(join(tmpdir(), 'margem-identidade-')); });
afterEach(async () => { await rm(raiz, { recursive: true, force: true }); });

const opcoes = (extra: Partial<OpcoesDaIdentidade> = {}): OpcoesDaIdentidade => ({
  registro: join(raiz, 'app', 'bibliotecas.json'), temBancoAntigo: () => false, ...extra,
});

async function clusterFalso(pasta: string): Promise<void> {
  await mkdir(pasta, { recursive: true });
  await writeFile(join(pasta, 'PG_VERSION'), '18\n');
}

describe('W-02: identidade guardada na pasta', () => {
  it('biblioteca existente (já com banco) ganha como id o hash do caminho: nada muda de lugar', async () => {
    const biblioteca = join(raiz, 'OneDrive', 'Documentos', 'Margem');
    const bancos = join(raiz, 'app', 'bancos');
    const legado = idLegadoDaBiblioteca(biblioteca);
    await clusterFalso(join(bancos, legado));
    const antes = pastasDaBiblioteca(biblioteca, { bancosLocais: bancos, ambiente: {} });
    expect(antes.banco).toBe(join(bancos, legado));
    const identidade = await identificarBiblioteca(biblioteca, opcoes({ temBancoAntigo: (id) => existsSync(join(bancos, id, 'PG_VERSION')) }));
    expect(identidade).toEqual({ id: legado, desfecho: 'nova' });
    expect(lerIdDaPasta(biblioteca)).toBe(legado);
    expect(pastasDaBiblioteca(biblioteca, { bancosLocais: bancos, ambiente: {} }).banco).toBe(join(bancos, legado));
    expect(arquivoDaSenha('/s', biblioteca)).toBe(`/s/banco-${legado}.senha`);
  });

  it('biblioteca nova ganha id aleatório (o hash de um caminho pode ser reaproveitado por outra pasta)', async () => {
    const biblioteca = join(raiz, 'Margem');
    const identidade = await identificarBiblioteca(biblioteca, opcoes());
    expect(identidade.desfecho).toBe('nova');
    expect(identidade.id).toMatch(/^[0-9a-f]{24}$/u);
    expect(identidade.id).not.toBe(idLegadoDaBiblioteca(biblioteca));
    expect(await identificarBiblioteca(biblioteca, opcoes())).toEqual({ id: identidade.id, desfecho: 'mesma' });
  });

  it('renomear a pasta no OneDrive continua abrindo o mesmo banco local', async () => {
    const bancos = join(raiz, 'app', 'bancos');
    const antes = join(raiz, 'OneDrive', 'Margem');
    const { id } = await identificarBiblioteca(antes, opcoes());
    await clusterFalso(join(bancos, id));
    await rename(antes, join(raiz, 'OneDrive', 'Minha biblioteca'));
    const depois = join(raiz, 'OneDrive', 'Minha biblioteca');
    const identidade = await identificarBiblioteca(depois, opcoes());
    expect(identidade).toEqual({ id, desfecho: 'movida', caminhoAnterior: antes });
    expect(pastasDaBiblioteca(depois, { bancosLocais: bancos, ambiente: {} }).banco).toBe(join(bancos, id));
    expect((await lerRegistro(join(raiz, 'app', 'bibliotecas.json')))[id]?.caminho).toBe(depois);
  });

  it('D-03: movida para fora da pasta sincronizada, o banco local vai junto (não abre vazia)', async () => {
    const bancos = join(raiz, 'app', 'bancos');
    const antes = join(raiz, 'Dropbox', 'Margem');
    const { id } = await identificarBiblioteca(antes, opcoes());
    await clusterFalso(join(bancos, id));
    await mkdir(join(raiz, 'Livros'), { recursive: true });
    await rename(antes, join(raiz, 'Livros', 'Margem'));
    const depois = join(raiz, 'Livros', 'Margem');
    expect((await identificarBiblioteca(depois, opcoes())).desfecho).toBe('movida');
    const pastas = pastasDaBiblioteca(depois, { bancosLocais: bancos, ambiente: {} });
    expect(pastas.sincronizada).toBeNull();
    expect(pastas.banco).toBe(join(bancos, id));
    // Com banco dentro da pasta, o da pasta vale (como sempre).
    await clusterFalso(pastas.bancoNaBiblioteca);
    expect(pastasDaBiblioteca(depois, { bancosLocais: bancos, ambiente: {} }).banco).toBe(pastas.bancoNaBiblioteca);
  });

  it('só maiúsculas mudaram (Windows): é a mesma biblioteca, sem pergunta', async () => {
    const biblioteca = join(raiz, 'Margem');
    const { id } = await identificarBiblioteca(biblioteca, opcoes({ plataforma: 'win32' }));
    const perguntar = () => Promise.reject(new Error('não devia perguntar'));
    // No Linux o caminho com outra caixa nem existe; o registro guarda o caminho, a comparação é sem caixa.
    const registro = join(raiz, 'app', 'bibliotecas.json');
    await writeFile(registro, JSON.stringify({ versao: 1, bibliotecas: { [id]: { caminho: biblioteca.toUpperCase(), visto_em: '' } } }));
    expect(await identificarBiblioteca(biblioteca, opcoes({ plataforma: 'win32', perguntar }))).toEqual({ id, desfecho: 'mesma' });
    expect(mesmaPasta('C:\\Users\\Ana\\Margem', 'c:\\users\\ana\\MARGEM', 'win32')).toBe(true);
    expect(mesmaPasta('/home/ana/Margem', '/home/ana/margem', 'linux')).toBe(false);
    expect((await lerRegistro(registro))[id]?.caminho).toBe(biblioteca);
  });

  it('cópia (as duas pastas existem com o mesmo id): sem resposta, a cópia ganha id novo e não divide o banco', async () => {
    const bancos = join(raiz, 'app', 'bancos');
    const original = join(raiz, 'OneDrive', 'Margem');
    const { id } = await identificarBiblioteca(original, opcoes());
    await clusterFalso(join(bancos, id));
    const copia = join(raiz, 'OneDrive', 'Margem - Cópia');
    await mkdir(join(copia, '.margem'), { recursive: true });
    await writeFile(caminhoDoMarcador(copia), await readFile(caminhoDoMarcador(original)));
    const identidade = await identificarBiblioteca(copia, opcoes());
    expect(identidade.desfecho).toBe('copia');
    expect(identidade.anterior).toBe(id);
    expect(identidade.id).not.toBe(id);
    expect(lerIdDaPasta(copia)).toBe(identidade.id);
    expect(lerIdDaPasta(original)).toBe(id);
    expect(pastasDaBiblioteca(copia, { bancosLocais: bancos, ambiente: {} }).banco).not.toBe(join(bancos, id));
    // A original continua a mesma.
    expect(await identificarBiblioteca(original, opcoes())).toEqual({ id, desfecho: 'mesma' });
  });

  it('a pessoa responde "movi": o id fica com a pasta nova; "cancelar" não muda nada', async () => {
    const original = join(raiz, 'Margem');
    const { id } = await identificarBiblioteca(original, opcoes());
    const outra = join(raiz, 'Margem nova');
    await gravarMarcador(outra, id);
    const perguntas: { biblioteca: string; outra: string }[] = [];
    await expect(identificarBiblioteca(outra, opcoes({ perguntar: (p) => { perguntas.push(p); return Promise.resolve('cancelar'); } })))
      .rejects.toThrow('cancelada');
    expect(lerIdDaPasta(outra)).toBe(id);
    expect(await identificarBiblioteca(outra, opcoes({ perguntar: () => Promise.resolve('movida') }))).toEqual({ id, desfecho: 'movida', caminhoAnterior: original });
    expect(perguntas).toEqual([{ biblioteca: outra, outra: original }]);
    // Agora a antiga é que é a outra: abri-la pergunta de novo (sem resposta, vira cópia).
    expect((await identificarBiblioteca(original, opcoes())).desfecho).toBe('copia');
  });

  it('pasta só de leitura: fica o hash do caminho, como antes', async () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    const biblioteca = join(raiz, 'Margem');
    await mkdir(biblioteca, { recursive: true });
    const { chmod } = await import('node:fs/promises');
    await chmod(biblioteca, 0o500);
    try {
      expect(await identificarBiblioteca(biblioteca, opcoes())).toEqual({ id: idLegadoDaBiblioteca(biblioteca), desfecho: 'sem_marcador' });
    } finally {
      await chmod(biblioteca, 0o700);
    }
  });

  it('a biblioteca de outro computador (sem registro aqui) é registrada', async () => {
    const biblioteca = join(raiz, 'Margem');
    await gravarMarcador(biblioteca, 'c'.repeat(24));
    expect(await identificarBiblioteca(biblioteca, opcoes())).toEqual({ id: 'c'.repeat(24), desfecho: 'registrada' });
  });

  it('R2-1: sem registro aqui, o banco local legado do caminho atual passa a atender pelo id do marcador', async () => {
    const biblioteca = join(raiz, 'OneDrive', 'Margem');
    const locais = { bancosLocais: join(raiz, 'app', 'bancos'), segredos: join(raiz, 'app', 'segredos'), copias: join(raiz, 'app', 'copias') };
    const legado = idLegadoDaBiblioteca(biblioteca);
    await clusterFalso(join(locais.bancosLocais, legado));
    await mkdir(join(locais.copias, legado), { recursive: true });
    const id = 'c'.repeat(24);
    await gravarMarcador(biblioteca, id);
    const adotar = (de: string, para: string) => adotarDoLegado(locais, de, para);
    expect(await identificarBiblioteca(biblioteca, opcoes({ adotarLegado: adotar }))).toEqual({ id, desfecho: 'registrada', legadoAdotado: legado });
    expect(existsSync(join(locais.bancosLocais, id, 'PG_VERSION'))).toBe(true);
    expect(existsSync(join(locais.copias, id))).toBe(true);
    expect(pastasDaBiblioteca(biblioteca, { bancosLocais: locais.bancosLocais, ambiente: { OneDrive: join(raiz, 'OneDrive') } }).banco).toBe(join(locais.bancosLocais, id));
    // Na próxima abertura, é a mesma (nada mais a adotar).
    expect(await identificarBiblioteca(biblioteca, opcoes({ adotarLegado: adotar }))).toEqual({ id, desfecho: 'mesma' });
  });

  it('R2-1: o banco que já é do id do marcador nunca é coberto; falha ao mover não registra (tenta de novo)', async () => {
    const biblioteca = join(raiz, 'Margem');
    const locais = { bancosLocais: join(raiz, 'app', 'bancos'), segredos: join(raiz, 'app', 'segredos'), copias: join(raiz, 'app', 'copias') };
    const legado = idLegadoDaBiblioteca(biblioteca);
    const id = 'e'.repeat(24);
    await clusterFalso(join(locais.bancosLocais, legado));
    await clusterFalso(join(locais.bancosLocais, id));
    expect(await adotarDoLegado(locais, legado, id)).toBe(false);
    expect(existsSync(join(locais.bancosLocais, legado, 'PG_VERSION'))).toBe(true);

    await rm(join(locais.bancosLocais, id), { recursive: true });
    await gravarMarcador(biblioteca, id);
    const falha = () => Promise.reject(new Error('lock incerto'));
    await expect(identificarBiblioteca(biblioteca, opcoes({ adotarLegado: (de, para) => adotarDoLegado(locais, de, para, { antesDeMoverOBanco: falha }) })))
      .rejects.toThrow('lock incerto');
    expect(await lerRegistro(join(raiz, 'app', 'bibliotecas.json'))).toEqual({});
    expect((await identificarBiblioteca(biblioteca, opcoes({ adotarLegado: (de, para) => adotarDoLegado(locais, de, para) }))).legadoAdotado).toBe(legado);
  });

  it('R2-5: a cópia só ganha o id novo depois de preparada; uma falha não muda marcador nem registro', async () => {
    const original = join(raiz, 'Margem');
    const { id } = await identificarBiblioteca(original, opcoes());
    const copia = join(raiz, 'Margem 2');
    await gravarMarcador(copia, id);
    const antes = await lerRegistro(join(raiz, 'app', 'bibliotecas.json'));
    await expect(identificarBiblioteca(copia, opcoes({ prepararCopia: () => Promise.reject(new Error('sem espaço')) }))).rejects.toThrow('sem espaço');
    expect(lerIdDaPasta(copia)).toBe(id);
    expect(await lerRegistro(join(raiz, 'app', 'bibliotecas.json'))).toEqual(antes);
    const vistas: { id: string; anterior: string }[] = [];
    const identidade = await identificarBiblioteca(copia, opcoes({ prepararCopia: (c) => { vistas.push(c); return Promise.resolve(); } }));
    expect(identidade).toMatchObject({ desfecho: 'copia', anterior: id });
    expect(vistas).toEqual([{ id: identidade.id, anterior: id }]);
    expect(lerIdDaPasta(copia)).toBe(identidade.id);
  });
});
