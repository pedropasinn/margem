/**
 * "Exportar para o Obsidian": uma pasta com a nota do documento e uma nota para cada grifo,
 * anotação, pergunta e relação. No navegador, baixa o ZIP; no app de computador, grava direto no
 * cofre escolhido (sem perder o que a pessoa escreveu nas notas). A escolha das marcas fica neste
 * navegador.
 */
import { useState, type ReactNode } from 'react';
import { Button, Switch } from '../ui/Primitives';
import {
  gravarPreferenciasDoObsidian, lerPreferenciasDoObsidian, ponteDoDesktop, urlDoZip, type PonteDoDesktop, type PreferenciasDoObsidian,
} from './obsidian';

export interface PropsDoEnvio {
  documentoId: string;
  origem?: string;
  /** A ponte do app de computador (nos testes, um falso); sem ela, só o ZIP. */
  desktop?: PonteDoDesktop | null;
}

export function EnviarParaObsidian({ documentoId, origem = window.location.origin, desktop = ponteDoDesktop() }: PropsDoEnvio): ReactNode {
  const [preferencias, definirPreferencias] = useState<PreferenciasDoObsidian>(lerPreferenciasDoObsidian);
  const [ocupado, ocupar] = useState(false);
  const [aviso, definirAviso] = useState<string | null>(null);
  const mudar = (valores: Partial<PreferenciasDoObsidian>) => {
    const novas = { ...preferencias, ...valores };
    definirPreferencias(novas);
    gravarPreferenciasDoObsidian(novas);
  };

  async function exportarNoCofre(ponte: PonteDoDesktop) {
    if (ocupado) return;
    ocupar(true); definirAviso(null);
    try {
      const resultado = await ponte.exportarParaObsidian(documentoId);
      if (resultado.estado !== 'cancelada') definirAviso(resultado.mensagem);
    } catch {
      definirAviso('Não foi possível exportar agora.');
    } finally { ocupar(false); }
  }

  const zipDoDocumento = urlDoZip(preferencias.marcas, origem, documentoId);
  return <section className="formulario enviar-obsidian" aria-label="Exportar para o Obsidian">
    <p className="dados">Uma pasta com a nota do documento e uma nota para cada grifo, anotação, pergunta e relação, com os trechos inteiros e o link de volta para o Margem.</p>
    <Switch checked={preferencias.marcas === 'todas'} onChange={(valor) => mudar({ marcas: valor ? 'todas' : 'minhas' })}>Incluir as marcas da leitura</Switch>
    {aviso && <p role="status">{aviso}</p>}
    <div className="button-row">
      {desktop && <Button variante="primario" disabled={ocupado} onClick={() => void exportarNoCofre(desktop)}>{ocupado ? 'Exportando…' : 'Exportar para o cofre…'}</Button>}
      <a className={`ui-button ${desktop ? 'ui-secundario' : 'ui-primario'}`} href={zipDoDocumento} download>Baixar a pasta (.zip)</a>
    </div>
    <p className="dados"><a href={urlDoZip(preferencias.marcas, origem)} download>Baixar a biblioteca inteira (.zip)</a> · para manter o cofre em dia, use o plugin Margem do Obsidian: ele atualiza as notas sem apagar o que você escreveu nelas.</p>
  </section>;
}
