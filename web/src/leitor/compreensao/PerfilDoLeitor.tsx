/**
 * Perfil do leitor (J31, `docs/desenho/09-VISAO.md` §4): explícito e editável. Entra só no plano
 * pedagógico e nas respostas, nunca na compreensão do texto. Cada gravação é uma revisão nova, e o
 * plano do capítulo aberto passa a ser refeito para ela na próxima preparação.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { NivelDeArea, PerfilDoLeitorV1 } from '@margem/contratos';
import { gravarPerfil, obterPerfil } from '../../biblioteca/api';
import { Button, IconButton, Input, Select, Textarea } from '../../ui/Primitives';

export interface FontesDoPerfil { obter: typeof obterPerfil; gravar: typeof gravarPerfil }
export const FONTES_DO_PERFIL: FontesDoPerfil = { obter: obterPerfil, gravar: gravarPerfil };

const NIVEIS: { valor: NivelDeArea; rotulo: string }[] = [
  { valor: 'basico', rotulo: 'Básico' }, { valor: 'intermediario', rotulo: 'Intermediário' }, { valor: 'avancado', rotulo: 'Avançado' },
];

export function PerfilDoLeitor({ aoSalvar, fontes = FONTES_DO_PERFIL }: { aoSalvar?: (perfil: PerfilDoLeitorV1) => void; fontes?: FontesDoPerfil }): ReactNode {
  const [areas, definirAreas] = useState<PerfilDoLeitorV1['areas']>([]);
  const [preferencias, definirPreferencias] = useState('');
  const [observacoes, definirObservacoes] = useState('');
  const [revisao, definirRevisao] = useState<number | null>(null);
  const [estado, definirEstado] = useState<'carregando' | 'pronto' | 'salvando'>('carregando');
  const [mensagem, definirMensagem] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fontes.obter().then(({ perfil }) => {
      if (!vivo) return;
      if (perfil) {
        definirAreas(perfil.areas); definirPreferencias(perfil.preferencias.join('\n')); definirObservacoes(perfil.observacoes); definirRevisao(perfil.revisao);
      }
      definirEstado('pronto');
    }, () => { if (vivo) { definirMensagem('Não foi possível carregar o perfil.'); definirEstado('pronto'); } });
    return () => { vivo = false; };
  }, [fontes]);

  async function salvar(): Promise<void> {
    definirEstado('salvando'); definirMensagem(null);
    try {
      const lista = [...new Set(preferencias.split('\n').map((linha) => linha.trim()).filter((linha) => linha !== ''))];
      const { perfil } = await fontes.gravar({ areas: areas.filter((area) => area.nome.trim() !== '').map((area) => ({ ...area, nome: area.nome.trim() })), preferencias: lista, observacoes });
      definirRevisao(perfil.revisao);
      definirMensagem('Perfil salvo. Os próximos planos de leitura usam esta versão.');
      aoSalvar?.(perfil);
    } catch (falha) {
      definirMensagem(falha instanceof Error ? falha.message : 'Não foi possível salvar o perfil.');
    } finally { definirEstado('pronto'); }
  }

  const mudarArea = (indice: number, mudanca: Partial<PerfilDoLeitorV1['areas'][number]>) =>
    definirAreas((atuais) => atuais.map((area, i) => (i === indice ? { ...area, ...mudanca } : area)));

  return <form className="formulario perfil-do-leitor" aria-label="Perfil do leitor" onSubmit={(evento) => { evento.preventDefault(); void salvar(); }}>
    <p className="linha-meta">O perfil orienta como a leitura guiada explica; nunca muda o que o texto diz.{revisao !== null ? ` Versão ${String(revisao + 1)}.` : ''}</p>
    <fieldset>
      <legend>Conhecimento</legend>
      {areas.map((area, indice) => <div className="linha-area" key={indice}>
        <Input aria-label="Área" value={area.nome} placeholder="Economia" onChange={(evento) => mudarArea(indice, { nome: evento.target.value })} />
        <Select aria-label={`Nível em ${area.nome || 'área'}`} value={area.nivel} onChange={(evento) => mudarArea(indice, { nivel: evento.target.value as NivelDeArea })}>
          {NIVEIS.map((nivel) => <option key={nivel.valor} value={nivel.valor}>{nivel.rotulo}</option>)}
        </Select>
        <IconButton aria-label={`Remover ${area.nome || 'área'}`} onClick={() => definirAreas((atuais) => atuais.filter((_, i) => i !== indice))}>×</IconButton>
      </div>)}
      <Button variante="ghost" onClick={() => definirAreas((atuais) => [...atuais, { nome: '', nivel: 'intermediario' }])}>+ Área</Button>
    </fieldset>
    <label>Preferências <span className="linha-meta">(uma por linha)</span>
      <Textarea value={preferencias} rows={4} placeholder={'explicações conceituais\nnão explicar conceitos básicos'} onChange={(evento) => definirPreferencias(evento.target.value)} />
    </label>
    <label>Observações
      <Textarea value={observacoes} rows={3} onChange={(evento) => definirObservacoes(evento.target.value)} />
    </label>
    {mensagem && <p role="status">{mensagem}</p>}
    <div className="button-row"><Button type="submit" disabled={estado !== 'pronto'}>Salvar perfil</Button></div>
  </form>;
}
