/**
 * J109 · `POST /api/importacoes/youtube` e o job `importar_youtube`, com o motor Python de verdade (TXT),
 * áudio gerado pelo ffmpeg e um YouTube falso (sem rede): validação (400), vídeo já na biblioteca (409),
 * legendas → versão + mídia sincronizada (fonte.url no YouTube), vídeo sem legenda e sem yt-dlp.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type pg from 'pg';
import { beforeAll, expect, test, vi } from 'vitest';
import { validarVideoYoutube, type Id, type MidiaV1, type VideoYoutubeV1 } from '@margem/contratos';
import { comBanco, exigirMotorPython } from '../../testes/apoio';
import { raizDoRepositorio } from '../dados';
import { criarApi } from '../http/app';
import { CABECALHO_MARGEM } from '../http/ambiente';
import { FilaPostgres } from '../worker/fila-postgres';
import { Worker } from '../worker/worker';
import { FerramentaAusente, type FonteDoYoutube } from './fontes-do-youtube';
import { manipuladorImportarYoutube, TIPO_IMPORTAR_YOUTUBE } from './importacao-youtube';
import { metadadosDoYtDlp } from './youtube';
import { LEGENDA_AUTOMATICA } from './youtube.casos';

const executar = promisify(execFile);

// Canoniza com o motor Python de verdade: sem o venv, a causa aparece aqui, não num 409 adiante.
beforeAll(exigirMotorPython, 30_000);
const JSON_ESCRITA = { [CABECALHO_MARGEM]: '1', 'Content-Type': 'application/json' };
const COM_LEGENDA = 'dO8EW2LqBfU';
const SEM_LEGENDA = 'a-b_c1D2e3F';
const SEM_YT_DLP = 'Zz9_Zz9-Zz9';

function fonteFalsa(pasta: string): FonteDoYoutube & { chamadas: string[] } {
  const chamadas: string[] = [];
  return {
    chamadas,
    metadados: (id) => {
      chamadas.push(`metadados:${id}`);
      if (id === SEM_YT_DLP) return Promise.reject(new FerramentaAusente('yt-dlp não está instalado.'));
      return Promise.resolve(metadadosDoYtDlp({
        title: id === COM_LEGENDA ? 'A jogada de mestre da China' : 'Vídeo sem legendas', channel: 'Fernando Ulrich', upload_date: '20260920', duration: 6, language: 'pt',
        description: id === COM_LEGENDA ? '' : 'Uma descrição curta.', chapters: [{ start_time: 0, title: 'Abertura' }, { start_time: 3.5, title: 'A jogada' }],
        automatic_captions: id === COM_LEGENDA ? { 'pt-orig': [], en: [] } : {},
      }, id));
    },
    legenda: (id, escolha) => { chamadas.push(`legenda:${id}:${escolha.idioma}:${String(escolha.automatica)}`); return Promise.resolve(LEGENDA_AUTOMATICA); },
    audio: async (id) => {
      chamadas.push(`audio:${id}`);
      const destino = join(pasta, `audio-${id}.m4a`);
      await executar('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:a', 'aac', '-vn', destino]);
      return destino;
    },
  };
}

async function rodarWorker(banco: pg.Pool, fonte: FonteDoYoutube, vagas: string): Promise<void> {
  await new Worker({
    fila: new FilaPostgres(banco),
    manipuladores: { [TIPO_IMPORTAR_YOUTUBE]: manipuladorImportarYoutube({ banco, fonte, transcritor: null, raiz: raizDoRepositorio(), prazoMs: 120_000 }) },
    diretorioSlots: vagas, slots: 1, intervaloMs: 5, maximoCiclos: 4,
  }).rodar();
}

test('importação do YouTube: contrato, duplicados, legendas → versão + mídia, sem legenda e sem yt-dlp', async () => comBanco('youtube_j109', async (banco) => {
  const antes = process.env.MARGEM_DADOS;
  const pasta = await mkdtemp(join(tmpdir(), 'margem-j109-'));
  process.env.MARGEM_DADOS = pasta;
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  try {
    const api = criarApi({ banco, leitura: () => { throw new Error('não usada'); } });
    const importar = (corpo: unknown) => api.request('/api/importacoes/youtube', { method: 'POST', headers: JSON_ESCRITA, body: JSON.stringify(corpo) });

    expect(await (await api.request('/api/importacoes/youtube')).json()).toEqual({ servico: 'margem', importacao_youtube: 1 });
    // 400: não é YouTube, fora do contrato, campo desconhecido, título com quebra.
    for (const [corpo, erro] of [
      [{ url: 'https://vimeo.com/123456' }, 'url_nao_e_do_youtube'],
      [{ url: 'https://www.youtube.com/playlist?list=PL1' }, 'url_nao_e_do_youtube'],
      [{}, 'importacao_invalida'],
      [{ url: `https://youtu.be/${COM_LEGENDA}`, canal: 'x' }, 'importacao_invalida'],
      [{ url: `https://youtu.be/${COM_LEGENDA}`, titulo: 'a\nb' }, 'importacao_invalida'],
    ] as const) {
      const resposta = await importar(corpo);
      expect(resposta.status).toBe(400);
      expect(await resposta.json()).toMatchObject({ erro });
    }
    expect((await api.request('/api/importacoes/youtube', { method: 'POST', body: JSON.stringify({ url: `https://youtu.be/${COM_LEGENDA}` }), headers: { 'Content-Type': 'application/json' } })).status).toBe(403);

    // 202 e, para o mesmo vídeo noutra forma de link (mesmo ao mesmo tempo), 409 com o existente.
    const [primeira, simultanea] = await Promise.all([importar({ url: `https://youtu.be/${COM_LEGENDA}?si=abc` }), importar({ url: `https://www.youtube.com/watch?v=${COM_LEGENDA}&t=3s` })]);
    const respostas = [primeira, simultanea].sort((a, b) => a.status - b.status);
    expect(respostas.map((r) => r.status)).toEqual([202, 409]);
    const criada = await respostas[0]!.json() as { documento_id: Id; job_id: Id };
    expect(Object.keys(criada).sort()).toEqual(['caminho', 'documento_id', 'job_id']);
    expect(await respostas[1]!.json()).toMatchObject({ erro: 'documento_duplicado', existente: { documento_id: criada.documento_id } });
    const documentoId = criada.documento_id;

    const pendente = (await banco.query<{ conteudo: VideoYoutubeV1 }>('SELECT conteudo FROM video_youtube WHERE documento_id=$1', [documentoId])).rows[0]!.conteudo;
    expect(validarVideoYoutube(pendente)).toBe(true);
    expect(pendente.transcricao.estado).toBe('pendente');
    const naFila = (await (await api.request('/api/documentos')).json() as { documentos: { id: Id; estado: string; midia: unknown }[] }).documentos.find((d) => d.id === documentoId)!;
    expect(naFila).toMatchObject({ estado: 'canonizando', midia: { tipo: 'video', fonte_url: `https://www.youtube.com/watch?v=${COM_LEGENDA}` } });

    const fonte = fonteFalsa(pasta);
    await rodarWorker(banco, fonte, join(pasta, 'vagas'));
    // Só legenda e áudio: o vídeo nunca é baixado.
    expect(fonte.chamadas).toEqual([`metadados:${COM_LEGENDA}`, `legenda:${COM_LEGENDA}:pt-orig:true`, `audio:${COM_LEGENDA}`]);

    const detalhe = await (await api.request(`/api/documentos/${documentoId}`)).json() as { versao_id: Id; titulo: string; autor: string };
    expect(detalhe).toMatchObject({ titulo: 'A jogada de mestre da China', autor: 'Fernando Ulrich' });
    const texto = (await banco.query<{ texto: string }>("SELECT string_agg(texto, ' ' ORDER BY ordem) AS texto FROM bloco WHERE versao_id=$1", [detalhe.versao_id])).rows[0]!.texto;
    expect(texto).toContain('a China fez uma jogada de mestre');
    expect(texto).not.toContain('Música');
    const { midias, youtube } = await (await api.request(`/api/versoes/${detalhe.versao_id}/midias`)).json() as { midias: MidiaV1[]; youtube: VideoYoutubeV1 };
    expect(midias).toHaveLength(1);
    expect(midias[0]).toMatchObject({ tipo: 'audio', mime: 'audio/mp4', titulo: 'A jogada de mestre da China',
      fonte: { url: `https://www.youtube.com/watch?v=${COM_LEGENDA}`, canal: 'Fernando Ulrich', publicado_em: '2026-09-20' },
      transcricao: { motor: 'legendas do YouTube (automáticas, pt)', idioma: 'pt' }, capitulos: [{ inicio_s: 0, titulo: 'Abertura' }, { inicio_s: 3.5, titulo: 'A jogada' }] });
    expect(midias[0]!.palavras).toHaveLength(7);
    expect(validarVideoYoutube(youtube)).toBe(true);
    expect(youtube).toMatchObject({ video_id: COM_LEGENDA, titulo: 'A jogada de mestre da China', canal: 'Fernando Ulrich', duracao_s: 6,
      transcricao: { estado: 'pronta', origem: 'legendas_automaticas', idioma: 'pt', midia_id: midias[0]!.id } });
    // O áudio local (alternativa quando o dono não deixa incorporar) é servido como qualquer mídia.
    expect((await api.request(`/api/midias/${midias[0]!.id}/arquivo`, { headers: { Range: 'bytes=0-9' } })).status).toBe(206);
    const naBiblioteca = (await (await api.request('/api/documentos')).json() as { documentos: { id: Id; estado: string; midia: { tipo: string } }[] }).documentos.find((d) => d.id === documentoId)!;
    expect(naBiblioteca).toMatchObject({ estado: 'pronto', midia: { tipo: 'video', duracao_s: 6 } });
    // A tentativa não deixa sobras.
    await expect(readFile(join(pasta, documentoId, 'youtube'), 'utf8')).rejects.toThrow();

    // Sem legenda e sem transcritor local: o documento diz "Sem transcrição" e o vídeo toca assim mesmo.
    const semLegenda = await (await importar({ url: `https://www.youtube.com/shorts/${SEM_LEGENDA}`, titulo: 'Título dado', autor: 'Autor dado' })).json() as { documento_id: Id };
    const semYtDlp = await (await importar({ url: `youtu.be/${SEM_YT_DLP}` })).json() as { documento_id: Id };
    const outra = fonteFalsa(pasta);
    await rodarWorker(banco, outra, join(pasta, 'vagas'));
    expect(outra.chamadas.filter((c) => c.startsWith('audio') || c.startsWith('legenda'))).toEqual([]);
    for (const [id, titulo, motivo] of [
      [semLegenda.documento_id, 'Título dado', 'não oferece legendas para este vídeo e não há transcritor local'],
      [semYtDlp.documento_id, `Vídeo do YouTube ${SEM_YT_DLP}`, 'O yt-dlp não está instalado'],
    ] as const) {
      const d = await (await api.request(`/api/documentos/${id}`)).json() as { versao_id: Id; titulo: string };
      expect(d.titulo).toBe(titulo);
      const corpo = await (await api.request(`/api/versoes/${d.versao_id}/midias`)).json() as { midias: MidiaV1[]; youtube: VideoYoutubeV1 };
      expect(corpo.midias).toEqual([]);
      expect(corpo.youtube.transcricao.estado).toBe('sem_transcricao');
      expect(corpo.youtube.transcricao.detalhe).toContain(motivo);
      const texto = (await banco.query<{ texto: string }>('SELECT string_agg(texto, \' \' ORDER BY ordem) AS texto FROM bloco WHERE versao_id=$1', [d.versao_id])).rows[0]!.texto;
      expect(texto).toContain(`${titulo} Sem transcrição.`);
    }
    const autor = (await banco.query<{ autor: string }>('SELECT autor FROM documento WHERE id=$1', [semLegenda.documento_id])).rows[0]!.autor;
    expect(autor).toBe('Autor dado');

    // Um vídeo do J71 (mídia com fonte.url no YouTube, sem linha em video_youtube) também conta como já na biblioteca.
    const versaoSemYt = (await banco.query<{ id: Id }>('SELECT id FROM versao_texto WHERE documento_id=$1', [semYtDlp.documento_id])).rows[0]!.id;
    await banco.query('DELETE FROM video_youtube WHERE documento_id=$1', [semYtDlp.documento_id]);
    await banco.query(`INSERT INTO midia (id, documento_id, versao_id, sha256, tipo, conteudo) VALUES ('01J0000000000000000000MJ71',$1,$2,$3,'video',$4)`,
      [semYtDlp.documento_id, versaoSemYt, 'c'.repeat(64), JSON.stringify({ fonte: { url: `https://www.youtube.com/watch?v=${SEM_YT_DLP}` } })]);
    const doJ71 = await importar({ url: `https://www.youtube.com/embed/${SEM_YT_DLP}` });
    expect(doJ71.status).toBe(409);
    expect(await doJ71.json()).toMatchObject({ existente: { documento_id: semYtDlp.documento_id } });
    // Arquivado não conta: o vídeo pode entrar de novo.
    await banco.query('UPDATE documento SET arquivado_em=now() WHERE id=$1', [documentoId]);
    expect((await importar({ url: `https://youtu.be/${COM_LEGENDA}` })).status).toBe(202);
  } finally {
    process.env.MARGEM_DADOS = antes;
    await rm(pasta, { recursive: true, force: true });
  }
}), 180_000);
