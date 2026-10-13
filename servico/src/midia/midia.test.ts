import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import type { MidiaV1 } from '@margem/contratos';
import { canonicoDeTeste, comBanco } from '../../testes/apoio';
import { comTransacao } from '../db/transacao';
import { criarApi } from '../http/app';
import { CABECALHO_MARGEM } from '../http/ambiente';
import * as documentos from '../repos/documentos';
import { interpretarSonda } from './arquivos';

const executar = promisify(execFile);

async function videoDeTeste(pasta: string): Promise<Buffer> {
  const saida = join(pasta, 'teste.mp4');
  await executar('ffmpeg', ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=160x90:d=3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-movflags', '+faststart', saida]);
  return readFile(saida);
}

test('sonda: tipo e MIME vêm do contêiner e das faixas', () => {
  expect(interpretarSonda({ format: { duration: '2.5', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' }, streams: [{ codec_type: 'video', width: 1280, height: 720 }, { codec_type: 'audio' }] }, 10))
    .toEqual({ tipo: 'video', mime: 'video/mp4', duracao_s: 2.5, bytes: 10, largura: 1280, altura: 720 });
  expect(interpretarSonda({ format: { duration: '9', format_name: 'mp3' }, streams: [{ codec_type: 'audio' }, { codec_type: 'video', disposition: { attached_pic: 1 } }] }, 5))
    .toEqual({ tipo: 'audio', mime: 'audio/mpeg', duracao_s: 9, bytes: 5 });
  expect(() => interpretarSonda({ format: { duration: '1', format_name: 'avi' }, streams: [{ codec_type: 'video' }] }, 1)).toThrow('não aceito');
  expect(() => interpretarSonda({ format: { format_name: 'mp4' }, streams: [] }, 1)).toThrow('reconhecível');
});

test('mídia: envio por fluxo, alinhamento pelo serviço, idempotência e Range', async () => comBanco('midia_j71', async (banco) => {
  const antes = process.env.MARGEM_DADOS;
  const pasta = await mkdtemp(join(tmpdir(), 'margem-midia-'));
  process.env.MARGEM_DADOS = pasta;
  try {
    const c = canonicoDeTeste({ blocos: [
      { tipo: 'capitulo', texto: 'Vídeo de teste' },
      { tipo: 'paragrafo', texto: 'Olá 🧭, isto é um teste. Segunda frase!' },
      { tipo: 'paragrafo', texto: 'Fim do vídeo.' },
    ], secoes: [{ nivel: 1, inicio: 0, fim: 2 }] });
    const versao = await comTransacao(banco, async (tx) => {
      const d = await documentos.criar(tx, { ...c.documento, origem_caminho: 'teste.md' });
      return documentos.criarVersao(tx, d.id, c);
    });
    const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
    const escrita = { [CABECALHO_MARGEM]: '1' };

    const bytes = await videoDeTeste(pasta);
    const envio = await api.request('/api/midia/arquivos', { method: 'PUT', headers: { ...escrita, 'Content-Type': 'video/mp4' }, body: bytes });
    expect(envio.status).toBe(201);
    const arquivo = await envio.json() as { sha256: string; tipo: string; mime: string; duracao_s: number; largura: number };
    expect(arquivo).toMatchObject({ tipo: 'video', mime: 'video/mp4', largura: 160 });
    expect(arquivo.duracao_s).toBeGreaterThan(2.5);
    // O temporário não sobra; o arquivo mora pelo hash.
    expect(await readdir(join(pasta, 'midia'))).toEqual([arquivo.sha256]);
    // O mesmo arquivo de novo é o mesmo hash.
    expect((await (await api.request('/api/midia/arquivos', { method: 'PUT', headers: escrita, body: bytes })).json() as { sha256: string }).sha256).toBe(arquivo.sha256);
    const recusado = await api.request('/api/midia/arquivos', { method: 'PUT', headers: escrita, body: 'não é mídia' });
    expect(recusado.status).toBe(415);

    const falas = 'olá isto é um teste segunda frase fim do vídeo'.split(' ');
    const palavras = falas.map((texto, i) => ({ texto, inicio_s: i * 0.3, fim_s: i * 0.3 + 0.25 }));
    const pedido = { sha256: arquivo.sha256, titulo: 'Teste', fonte: { url: 'https://www.youtube.com/watch?v=x', canal: 'Canal', publicado_em: '2026-09-27' },
      capitulos: [{ inicio_s: 0, titulo: 'Abertura' }, { inicio_s: 99, titulo: 'Depois do fim' }],
      transcricao: { motor: 'teste', idioma: 'pt', palavras } };
    const url = `/api/documentos/${versao.documento_id}/midias`;
    const publicada = await api.request(url, { method: 'POST', headers: { ...escrita, 'Content-Type': 'application/json' }, body: JSON.stringify(pedido) });
    expect(publicada.status).toBe(201);
    const corpo = await publicada.json() as { midia: { id: string; palavras: number; capitulos: unknown[] }; diagnostico: { alinhadas: number; sem_par: number } };
    expect(corpo.diagnostico).toMatchObject({ alinhadas: falas.length, sem_par: 0 });
    // O capítulo depois do fim do arquivo cai fora.
    expect(corpo.midia.capitulos).toHaveLength(1);

    const repetida = await api.request(url, { method: 'POST', headers: { ...escrita, 'Content-Type': 'application/json' }, body: JSON.stringify(pedido) });
    expect(repetida.status).toBe(200);
    expect((await repetida.json() as { midia: { id: string } }).midia.id).toBe(corpo.midia.id);
    const outra = { ...pedido, transcricao: { ...pedido.transcricao, palavras: palavras.map((p) => ({ ...p, fim_s: p.fim_s + 0.01 })) } };
    expect((await api.request(url, { method: 'POST', headers: { ...escrita, 'Content-Type': 'application/json' }, body: JSON.stringify(outra) })).status).toBe(409);
    const alheia = { ...pedido, transcricao: { ...pedido.transcricao, palavras: 'nada disso foi dito aqui mesmo não'.split(' ').map((texto, i) => ({ texto, inicio_s: i, fim_s: i + 0.5 })) } };
    const insuficiente = await api.request(url, { method: 'POST', headers: { ...escrita, 'Content-Type': 'application/json' }, body: JSON.stringify(alheia) });
    expect(insuficiente.status).toBe(422);
    expect((await api.request(url, { method: 'POST', headers: { ...escrita, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...pedido, extra: 1 }) })).status).toBe(400);

    const lista = await (await api.request(`/api/versoes/${versao.id}/midias`)).json() as { midias: MidiaV1[] };
    expect(lista.midias).toHaveLength(1);
    const [midia] = lista.midias;
    const bloco = c.blocos[1]!;
    // Offsets UTF-16 resolvidos pelo serviço: "isto" começa depois de "Olá 🧭, ".
    expect(bloco.texto.slice(midia!.palavras[1]!.inicio_utf16, midia!.palavras[1]!.fim_utf16)).toBe('isto');
    expect(midia!.frases.map((f) => c.blocos.find((b) => b.id === f.bloco_id)!.texto.slice(f.inicio_utf16, f.fim_utf16)))
      .toEqual(['Olá 🧭, isto é um teste.', 'Segunda frase!', 'Fim do vídeo.']);

    const biblioteca = await (await api.request('/api/documentos')).json() as { documentos: { id: string; midia: { tipo: string } | null }[] };
    expect(biblioteca.documentos.find((d) => d.id === versao.documento_id)?.midia?.tipo).toBe('video');

    const arquivoUrl = `/api/midias/${midia!.id}/arquivo`;
    const faixa = await api.request(arquivoUrl, { headers: { Range: 'bytes=0-9' } });
    expect(faixa.status).toBe(206);
    expect(faixa.headers.get('content-type')).toBe('video/mp4');
    expect(Buffer.from(await faixa.arrayBuffer())).toEqual(bytes.subarray(0, 10));
    expect((await api.request(arquivoUrl, { headers: { Range: `bytes=${String(bytes.length + 5)}-` } })).status).toBe(416);
    await expect(banco.query('UPDATE midia SET tipo=$1', ['audio'])).rejects.toThrow();
  } finally {
    if (antes === undefined) delete process.env.MARGEM_DADOS; else process.env.MARGEM_DADOS = antes;
    await rm(pasta, { recursive: true, force: true });
  }
}));
