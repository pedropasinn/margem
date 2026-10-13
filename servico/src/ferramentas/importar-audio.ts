/** Uso: importar-audio.ts job_id secao_id mapa-de-cenas.json título */
import { validarAncora, type AncoraV1 } from '@margem/contratos';
import { lerJsonLimitado, ORCAMENTOS } from '../entrada-json';
import { pool } from '../db/conexao';
import { migrar } from '../db/migrar';
import { comTransacao } from '../db/transacao';
import { importarAudioColab } from '../audio/importar-colab';
import { publicarAudio } from '../audio/publicacao';
import { exigirRecurso } from '../recursos';
const [job, secao, caminho, ...palavras] = process.argv.slice(2);
try {
  // Geração pela fábrica auto-colab (OmniVoice): recurso pessoal, desligado numa instalação nova (J102).
  exigirRecurso('audio-colab');
  if (!job || !secao || !caminho || !palavras.length) throw new Error('Use: job_id secao_id mapa.json título');
  const bruto = await lerJsonLimitado(caminho, ORCAMENTOS.canonico);
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) throw new Error('Mapa de cenas inválido.');
  const mapa: Record<string, AncoraV1> = {};
  for (const [cena, ancora] of Object.entries(bruto)) {
    if (!/^c\d+$/.test(cena) || !validarAncora(ancora)) throw new Error('Âncora de cena inválida.');
    mapa[cena] = ancora;
  }
  const audio = await importarAudioColab(job, secao, palavras.join(' '), mapa);
  await migrar(pool);
  const publicado = await comTransacao(pool, cliente => publicarAudio(cliente, audio));
  console.log(JSON.stringify({ id: publicado.id, versao_id: publicado.versao_id, secao_id: publicado.secao_id,
    duracao_s: publicado.duracao_s, trechos: publicado.trechos.length }));
} catch (erro) { console.error(erro instanceof Error ? erro.message : 'Falha na importação.'); process.exitCode = 1; }
finally { await pool.end(); }
