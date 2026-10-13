/**
 * "Enviar para o Obsidian": abre a nota do documento direto no cofre (URI `obsidian://new`) ou a
 * baixa como `.md`. O cofre, a pasta e as escolhas ficam neste navegador.
 */
import { useState, type ReactNode } from 'react';
import { Button, Input, Switch } from '../ui/Primitives';
import {
  baixarNota, caminhoNoCofre, consultaDaExportacao, gravarPreferenciasDoObsidian, lerPreferenciasDoObsidian,
  uriDoObsidian, type PreferenciasDoObsidian,
} from './obsidian';

export interface PropsDoEnvio {
  documentoId: string;
  /** Abre a URI `obsidian://` (nos testes, um espião). */
  abrir?: (uri: string) => void;
  /** Copia o texto (nos testes, um espião). */
  copiar?: (texto: string) => Promise<void>;
  origem?: string;
}

function abrirUri(uri: string): void {
  const link = document.createElement('a');
  link.href = uri;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

function copiarTexto(texto: string): Promise<void> {
  if (typeof navigator.clipboard?.writeText !== 'function') return Promise.reject(new Error('sem área de transferência'));
  return navigator.clipboard.writeText(texto);
}

export function EnviarParaObsidian({ documentoId, abrir = abrirUri, copiar = copiarTexto, origem = window.location.origin }: PropsDoEnvio): ReactNode {
  const [preferencias, definirPreferencias] = useState<PreferenciasDoObsidian>(lerPreferenciasDoObsidian);
  const [ocupado, ocupar] = useState(false);
  const [aviso, definirAviso] = useState<string | null>(null);
  const mudar = (valores: Partial<PreferenciasDoObsidian>) => {
    const novas = { ...preferencias, ...valores };
    definirPreferencias(novas);
    gravarPreferenciasDoObsidian(novas);
  };
  const consulta = consultaDaExportacao(preferencias.marcas, origem);

  async function enviar() {
    if (ocupado) return;
    ocupar(true); definirAviso(null);
    try {
      const { arquivo, conteudo } = await baixarNota(documentoId, preferencias.marcas, origem);
      const uri = uriDoObsidian({ cofre: preferencias.cofre, caminho: caminhoNoCofre(preferencias.pasta, arquivo), conteudo, substituir: preferencias.substituir });
      if (uri.via === 'area_de_transferencia') {
        try { await copiar(conteudo); }
        catch {
          definirAviso('A nota é grande demais para ir pelo link e a área de transferência não está disponível aqui. Use “Baixar .md”.');
          return;
        }
        definirAviso('A nota é grande: foi copiada, e o Obsidian a cria a partir da área de transferência.');
      } else {
        definirAviso('Abrindo no Obsidian.');
      }
      abrir(uri.uri);
    } catch (falha) {
      definirAviso(falha instanceof Error ? falha.message : 'Não foi possível gerar a nota.');
    } finally { ocupar(false); }
  }

  return <section className="formulario enviar-obsidian" aria-label="Enviar para o Obsidian">
    <p className="dados">Uma nota com as marcas, as notas e as perguntas deste documento, cada trecho com o link de volta para o Margem.</p>
    <label>Cofre<Input value={preferencias.cofre} placeholder="o cofre aberto" autoComplete="off" spellCheck={false}
      onChange={(evento) => mudar({ cofre: evento.target.value })} /></label>
    <label>Pasta<Input value={preferencias.pasta} placeholder="raiz do cofre" autoComplete="off" spellCheck={false}
      onChange={(evento) => mudar({ pasta: evento.target.value })} /></label>
    <Switch checked={preferencias.marcas === 'todas'} onChange={(valor) => mudar({ marcas: valor ? 'todas' : 'minhas' })}>Incluir as marcas da leitura</Switch>
    <Switch checked={preferencias.substituir} onChange={(valor) => mudar({ substituir: valor })}>Substituir a nota se já existir</Switch>
    {aviso && <p role="status">{aviso}</p>}
    <div className="button-row">
      <Button variante="primario" disabled={ocupado} onClick={() => void enviar()}>Abrir no Obsidian</Button>
      <a className="ui-button ui-secundario" href={`/api/documentos/${documentoId}/obsidian.md?${consulta}`} download>Baixar .md</a>
    </div>
    <p className="dados"><a href={`/api/obsidian/exportacao.zip?${consulta}`} download>Baixar todas as notas (.zip)</a> · para manter o cofre em dia sem abrir documento por documento, use o plugin Margem do Obsidian.</p>
  </section>;
}
