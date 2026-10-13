/**
 * Registro de um original novo: grava o arquivo, cria o documento e enfileira a canonização.
 *
 * Um caminho só para toda entrada de texto — upload (`POST /api/documentos`) e página web
 * capturada pela extensão (`POST /api/importacoes/web`). O motor lê o original do disco no
 * worker; a API nunca espera por ele.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type pg from 'pg';
import type { Id } from '@margem/contratos';
import { comTransacao } from '../db/transacao.js';
import * as documentosRepo from '../repos/documentos.js';
import * as jobsRepo from '../repos/jobs.js';
import { TIPO_CANONIZAR } from '../worker/canonizar.js';
import { caminhoDoOriginal, pastaDoDocumento } from '../dados.js';

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface OriginalNovo {
  titulo: string;
  autor?: string;
  formato: documentosRepo.Documento['formato'];
  bytes: Uint8Array;
  paginas: { inicio: number; fim: number } | null;
  poesia: boolean;
  /** PDF e EPUB sem título: o nome do arquivo fica como reserva até o canônico trazer o dos metadados. */
  nomeDoArquivo?: string;
}

export interface OriginalRegistrado {
  documento_id: Id;
  job_id: Id;
  paginas?: string;
  poesia?: true;
}

/** O mesmo original com as mesmas opções já está na biblioteca (409 na API). */
export interface OriginalDuplicado {
  documento_id: Id;
  erro: 'documento_duplicado';
}

export async function registrarOriginal(banco: pg.Pool, entrada: OriginalNovo): Promise<OriginalRegistrado | OriginalDuplicado> {
  const { titulo, autor, formato, bytes, paginas, poesia, nomeDoArquivo } = entrada;
  const sha = sha256Hex(bytes);
  return comTransacao(banco, async (cliente) => {
    // Duplicado é o mesmo original com as mesmas opções: outra faixa de páginas ou poesia é outro instantâneo.
    const existente = (await cliente.query<{ id: string }>(
      `SELECT id FROM documento WHERE sha256_original=$1 AND arquivado_em IS NULL
         AND paginas_inicio IS NOT DISTINCT FROM $2 AND paginas_fim IS NOT DISTINCT FROM $3 AND poesia=$4
       ORDER BY criado_em,id LIMIT 1`, [sha, paginas?.inicio ?? null, paginas?.fim ?? null, poesia])).rows[0];
    if (existente) return { documento_id: existente.id, erro: 'documento_duplicado' as const };
    const documento = await documentosRepo.criar(cliente, {
      titulo: titulo || (nomeDoArquivo ?? '').replace(/\.[^.]+$/, '').replaceAll('_', ' ').trim() || 'Documento', formato,
      // O idioma real vem do canônico; o registro do documento não o guarda.
      idioma: 'pt-BR', sha256_original: sha,
      ...(autor === undefined || autor === '' ? {} : { autor }),
      origem_caminho: caminhoDoOriginal('0'.repeat(26), formato),
    });
    const caminho = caminhoDoOriginal(documento.id, formato);
    await mkdir(pastaDoDocumento(documento.id), { recursive: true, mode: 0o700 });
    await writeFile(caminho, bytes, { mode: 0o600 });
    if (titulo === '' && (formato === 'pdf' || formato === 'epub')) {
      await writeFile(join(pastaDoDocumento(documento.id), 'importacao.json'),
        JSON.stringify({ titulo_reserva: documento.titulo }), { mode: 0o600 });
    }
    await cliente.query('UPDATE documento SET origem_caminho=$2, paginas_inicio=$3, paginas_fim=$4, poesia=$5 WHERE id=$1',
      [documento.id, caminho, paginas?.inicio ?? null, paginas?.fim ?? null, poesia]);
    // A faixa e a poesia fazem parte da entrada: o mesmo original com outra opção é outro instantâneo.
    const opcoesDoMotor = [
      ...(paginas === null ? [] : [`paginas=${String(paginas.inicio)}-${String(paginas.fim)}`]),
      ...(poesia ? ['poesia'] : []),
    ];
    const job = await jobsRepo.enfileirar(cliente, {
      tipo: TIPO_CANONIZAR, dedup_key: `canonizar:${documento.id}`,
      input_snapshot_hash: opcoesDoMotor.length === 0 ? sha
        : sha256Hex(new TextEncoder().encode(`${sha}:${opcoesDoMotor.join(':')}`)),
      documento_id: documento.id,
    });
    return {
      documento_id: documento.id, job_id: job.id,
      ...(paginas === null ? {} : { paginas: `${String(paginas.inicio)}-${String(paginas.fim)}` }),
      ...(poesia ? { poesia: true as const } : {}),
    };
  });
}
