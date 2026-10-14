import { isDeepStrictEqual } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, constants } from 'node:fs';
import { copyFile, mkdir, stat, link, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { contratoAudio, contratoAudioV2, type AudioNarrado } from '@margem/contratos';
import { conferirAudioNoCanonico } from '@margem/core';
import { raizDeDados } from '../dados';
import { sincronizarArquivo, sincronizarPasta } from '../plataforma/disco.js';
import { conferirOrcamento, ORCAMENTOS } from '../entrada-json';
import { obterVersao } from '../repos/documentos';
import type { Transacao } from '../db/transacao';

export function caminhoDoAudio(hash: string): string {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Hash de áudio inválido.');
  return join(raizDeDados(), 'audio', `${hash}.mp3`);
}
export async function hashDoArquivo(caminho: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const parte of createReadStream(caminho)) hash.update(parte as Buffer);
  return hash.digest('hex');
}
/** Fora do SQL: falha posterior pode deixar arquivo órfão, nunca uma referência a arquivo parcial. */
export async function prepararArquivoAudio(origem: string): Promise<string> {
  if ((await stat(origem)).size === 0) throw new Error('Áudio vazio.');
  const hash = await hashDoArquivo(origem);
  const destino = caminhoDoAudio(hash);
  await mkdir(join(raizDeDados(), 'audio'), { recursive: true });
  const temporario = join(raizDeDados(), 'audio', `.tentativa-${randomUUID()}`);
  try {
    await copyFile(origem, temporario, constants.COPYFILE_EXCL);
    if (await hashDoArquivo(temporario) !== hash) throw new Error('Áudio alterado durante a cópia.');
    await sincronizarArquivo(temporario);
    try { await link(temporario, destino); }
    catch (erro) { if (!(erro instanceof Error && 'code' in erro && erro.code === 'EEXIST')) throw erro; }
    if (await hashDoArquivo(destino) !== hash) throw new Error('Arquivo de áudio adulterado.');
    await sincronizarPasta(join(raizDeDados(), 'audio'));
  } finally { await rm(temporario, { force: true }); }
  return hash;
}
/** Publica a narração do Colab (`AudioV1`) ou a gerada no app (`AudioV2`, J106) pelo mesmo caminho. */
export async function publicarAudio(cliente: Transacao, entrada: AudioNarrado): Promise<AudioNarrado> {
  conferirOrcamento(entrada, ORCAMENTOS.canonico);
  const audio = structuredClone(entrada);
  const local = audio.versao === 2 ? contratoAudioV2.validarLocal(audio) : contratoAudio.validarLocal(audio);
  if (!local.ok) throw new Error('Contrato de áudio inválido.');
  const versao = await obterVersao(cliente, audio.versao_id);
  if (!conferirAudioNoCanonico(audio, versao.id, versao.canonico)) throw new Error('Áudio incompatível com o capítulo.');
  if (await hashDoArquivo(caminhoDoAudio(audio.sha256_audio)) !== audio.sha256_audio) throw new Error('Arquivo do áudio divergente.');
  await cliente.query(`INSERT INTO audio (id,versao_id,secao_id,conteudo,sha256_audio) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (versao_id,secao_id,sha256_audio) DO NOTHING`,
  [audio.id, audio.versao_id, audio.secao_id, JSON.stringify(audio), audio.sha256_audio]);
  const { rows: [gravado] } = await cliente.query<{ conteudo: AudioNarrado }>('SELECT conteudo FROM audio WHERE versao_id=$1 AND secao_id=$2 AND sha256_audio=$3',
    [audio.versao_id, audio.secao_id, audio.sha256_audio]);
  if (!isDeepStrictEqual({ ...gravado!.conteudo, id: audio.id }, audio)) throw new Error('Este arquivo já foi publicado com outro roteiro.');
  return gravado!.conteudo;
}
