import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import { APARENCIA_PADRAO, guardarPreferencias, lerPreferencias, reduzirPreferencias, type MudancaDeAparencia, type Preferencias } from './preferencias';

const Contexto = createContext<{ preferencias: Preferencias; alterar: Dispatch<MudancaDeAparencia> }>({
  preferencias: APARENCIA_PADRAO, alterar: () => {},
});
export const usarAparencia = () => useContext(Contexto);

/**
 * Marcas à vista no documento aberto (V-T3). Cada documento abre como manda a preferência
 * "Mostrar todas as marcas ao abrir"; o botão "Marcas" da barra muda só o documento aberto, e a escolha
 * vale enquanto ele estiver aberto (trocar de capítulo não a desfaz).
 */
const ContextoDasMarcas = createContext<{ escolha: { documento: string; visiveis: boolean } | null; escolher: (documento: string, visiveis: boolean) => void }>({
  escolha: null, escolher: () => {},
});
export function usarMarcasVisiveis(documentoId: string): [boolean, (visiveis: boolean) => void] {
  const { preferencias } = usarAparencia();
  const { escolha, escolher } = useContext(ContextoDasMarcas);
  const visiveis = escolha !== null && escolha.documento === documentoId ? escolha.visiveis : preferencias.marcasAoAbrir;
  const definir = useCallback((valor: boolean) => escolher(documentoId, valor), [escolher, documentoId]);
  return [visiveis, definir];
}
export function ContextoDeAparencia({ children }: { children: ReactNode }): ReactNode {
  const [preferencias, alterar] = useReducer(reduzirPreferencias, undefined, lerPreferencias);
  const [escolha, definirEscolha] = useState<{ documento: string; visiveis: boolean } | null>(null);
  const escolher = useCallback((documento: string, visiveis: boolean) => definirEscolha({ documento, visiveis }), []);
  const marcas = useMemo(() => ({ escolha, escolher }), [escolha, escolher]);
  // Antes dos efeitos dos filhos: a camada de marcas e as notas medem o texto já com a aparência nova.
  useLayoutEffect(() => {
    guardarPreferencias(preferencias);
    const html = document.documentElement;
    html.dataset['tema'] = preferencias.tema;
    html.style.setProperty('--tamanho-leitura', `${preferencias.tamanho}px`);
    // Alinhamento, espaçamento e atalhos vão em atributos da raiz: o CSS do leitor e os ouvintes de teclado leem dali.
    html.dataset['alinhamento'] = preferencias.alinhamento;
    html.dataset['espacamento'] = preferencias.espacamento;
    html.dataset['atalhos'] = preferencias.atalhosDeLetra ? 'ligados' : 'desligados';
    html.style.setProperty('--largura-leitura', `${({ 65: 720, 68: 850, 70: 960 })[preferencias.medida] * preferencias.tamanho / 22}px`);
    html.style.setProperty('--medida-leitura', `${preferencias.medida}ch`);
    html.style.setProperty('--entrelinha-leitura', String({ compacta: 1.45, normal: 1.6, folgada: 1.85 }[preferencias.entrelinha]));
    for (const [funcao, cor] of Object.entries(preferencias.cores)) html.style.setProperty(`--${funcao}`, cor);
  }, [preferencias]);
  return <Contexto.Provider value={{ preferencias, alterar }}><ContextoDasMarcas.Provider value={marcas}>{children}</ContextoDasMarcas.Provider></Contexto.Provider>;
}
