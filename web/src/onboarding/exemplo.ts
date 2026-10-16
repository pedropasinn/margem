/**
 * O documento de exemplo dos primeiros passos.
 *
 * "Um apólogo", de Machado de Assis (1839–1908), em domínio público: publicado na *Gazeta de
 * Notícias* em 1885 e recolhido em *Várias histórias* (Rio de Janeiro: Laemmert & C., 1896,
 * p. 253–257). Transcrição da Wikisource em português (ortografia atualizada da edição de 1896),
 * baixada em 01/10/2026; só duas quebras de linha da transcrição foram juntadas e "linhaordinária"
 * foi separado. O texto vai no próprio app (`exemplo/um-apologo.md`, carregado sob demanda).
 *
 * Abrir o exemplo usa o mesmo caminho da adição (`POST /api/documentos`, formato Markdown): o
 * serviço enfileira a preparação do texto (motor Python, sem IA) e nada mais. As marcas só chegam
 * quando a pessoa pedir "Analisar" — o onboarding nunca dispara uma leitura do Codex.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { mensagemDeErro } from '../biblioteca/erros';
import { adicionarDocumento, ErroDaApi, obterDocumento } from '../biblioteca/api';
import type { ItemDaBiblioteca } from '../biblioteca/tipos';

export const TITULO_DO_EXEMPLO = 'Um apólogo';
export const AUTOR_DO_EXEMPLO = 'Machado de Assis';

export async function textoDoExemplo(): Promise<string> {
  const modulo = await import('./exemplo/um-apologo.md?raw');
  return modulo.default;
}

export interface FontesDoExemplo {
  texto: () => Promise<string>;
  enviar: (formulario: FormData) => Promise<{ documento_id: string }>;
  documento: (id: string) => Promise<Pick<ItemDaBiblioteca, 'id' | 'texto_disponivel' | 'estado'>>;
}

export const FONTES_DO_EXEMPLO: FontesDoExemplo = { texto: textoDoExemplo, enviar: adicionarDocumento, documento: obterDocumento };

/** O formulário que a tela "Adicionar" mandaria para um Markdown colado. */
export function formularioDoExemplo(texto: string): FormData {
  const dados = new FormData();
  dados.set('formato', 'md');
  dados.set('titulo', TITULO_DO_EXEMPLO);
  dados.set('autor', AUTOR_DO_EXEMPLO);
  dados.set('texto', texto);
  return dados;
}

/**
 * Garante o exemplo na biblioteca: reaproveita o já adicionado (se ainda existir) ou o adiciona.
 * Devolve o id e se foi criado agora.
 */
export async function garantirExemplo(existente: string | null, fontes: FontesDoExemplo = FONTES_DO_EXEMPLO): Promise<{ documento_id: string; criado: boolean }> {
  if (existente !== null) {
    try {
      await fontes.documento(existente);
      return { documento_id: existente, criado: false };
    } catch (falha) {
      // Só um 404 quer dizer que foi apagado; outra falha não deve gerar uma cópia nova.
      if (!(falha instanceof ErroDaApi && falha.status === 404)) throw falha;
    }
  }
  const resposta = await fontes.enviar(formularioDoExemplo(await fontes.texto()));
  return { documento_id: resposta.documento_id, criado: true };
}

export type FaseDoExemplo = 'parado' | 'enviando' | 'preparando' | 'demorando' | 'erro';

/**
 * Abre o exemplo e espera o texto ficar disponível (a preparação leva segundos), consultando o
 * documento a cada `intervaloMs`. Passado `limiteMs`, avisa com honestidade e oferece a página do
 * documento, sem fingir que está pronto.
 */
export function usarExemplo({ existente, aoRegistrar, aoPronto, fontes = FONTES_DO_EXEMPLO, intervaloMs = 1500, limiteMs = 45_000 }: {
  existente: string | null;
  aoRegistrar: (documento_id: string) => void;
  aoPronto: (documento_id: string) => void;
  fontes?: FontesDoExemplo;
  intervaloMs?: number;
  limiteMs?: number;
}) {
  const [fase, definirFase] = useState<FaseDoExemplo>('parado');
  const [erro, definirErro] = useState<string | null>(null);
  const [documento, definirDocumento] = useState<string | null>(null);
  const vivo = useRef(true);
  useEffect(() => { vivo.current = true; return () => { vivo.current = false; }; }, []);
  const abrir = useCallback(async () => {
    definirErro(null); definirFase('enviando');
    try {
      const { documento_id } = await garantirExemplo(existente, fontes);
      if (!vivo.current) return;
      aoRegistrar(documento_id); definirDocumento(documento_id); definirFase('preparando');
      const inicio = Date.now();
      for (;;) {
        const atual = await fontes.documento(documento_id);
        if (!vivo.current) return;
        if (atual.texto_disponivel) { definirFase('parado'); aoPronto(documento_id); return; }
        if (atual.estado === 'falhou') throw new Error('A preparação do texto falhou. Veja a página do documento.');
        if (Date.now() - inicio > limiteMs) { definirFase('demorando'); return; }
        await new Promise((resolver) => setTimeout(resolver, intervaloMs));
        if (!vivo.current) return;
      }
    } catch (falha) {
      if (!vivo.current) return;
      definirErro(mensagemDeErro(falha, 'Não foi possível abrir o exemplo.'));
      definirFase('erro');
    }
  }, [existente, fontes, aoRegistrar, aoPronto, intervaloMs, limiteMs]);
  return { fase, erro, documento, abrir };
}
