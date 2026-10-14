/** Configurações → Modelos (V-T10): modelo e esforço de cada categoria de execução do Codex. */
import { escrever, pedir } from '../biblioteca/api';

export type Esforco = 'low' | 'medium' | 'high';

export interface EscolhaDaCategoria { modelo: string | null; esforco: Esforco | null }

export interface CategoriaDeExecucao {
  id: string;
  rotulo: string;
  descricao: string;
  /** O que o Margem usa sem escolha; `texto` é a linha que a tela mostra. */
  padrao: { modelo: string | null; esforco: string; texto: string };
  escolha: EscolhaDaCategoria;
}

export interface ModeloDaConta { id: string; nome: string; descricao: string; esforcos: string[] }

export interface ConfiguracaoDosModelos {
  categorias: CategoriaDeExecucao[];
  esforcos: { id: Esforco; rotulo: string }[];
  catalogo: { obtido_em: string; origem: 'conta' | 'cache_do_codex'; modelos: ModeloDaConta[] } | null;
}

export const lerConfiguracaoDosModelos = () => pedir<ConfiguracaoDosModelos>('/api/configuracoes/modelos');
export const gravarEscolhaDeModelo = (categoria: string, escolha: EscolhaDaCategoria) =>
  escrever<ConfiguracaoDosModelos>('/api/configuracoes/modelos', { categorias: { [categoria]: escolha } }, 'PUT');
export const atualizarListaDeModelos = () => escrever<ConfiguracaoDosModelos>('/api/configuracoes/modelos/atualizar', {});
