import { useState, type ReactNode } from 'react';
import { Icon } from '../ui/Icon';
import { Button, classesDoBotao } from '../ui/Primitives';
import './onboarding.css';
import type { Rota } from '../biblioteca/rotas';
import { usarOnboarding } from './ContextoDoOnboarding';
import { usarInstalacao, type ComoInstalar } from './instalacao';
import { integracoes } from './integracoes';

/**
 * "Leve o Margem com você": instalar como app, a extensão de navegador e o Obsidian.
 * Ver o passo já o conta como feito quando a pessoa instala ou marca "Entendi".
 */
export function LevarConsigo({ ir, como: comoDado }: { ir: (destino: Rota) => void; como?: ComoInstalar }): ReactNode {
  const { estado, despachar } = usarOnboarding();
  const instalacao = usarInstalacao();
  const como = comoDado ?? instalacao.como;
  const [resultado, definirResultado] = useState<'aceito' | 'recusado' | null>(null);
  const instalar = async () => {
    if (!instalacao.instalar) return;
    const escolha = await instalacao.instalar();
    definirResultado(escolha);
    if (escolha === 'aceito') despachar({ tipo: 'concluir_levar' });
  };
  return <div className="levar-consigo">
    <article className="cartao-levar cartao-instalar">
      <span className="levar-icone"><Icon name="celular" size={22} /></span>
      <div className="levar-corpo">
        <h3>Instalar como app</h3>
        {como === 'instalado' && <p>O Margem já está instalado neste aparelho. Abra pelo ícone, como qualquer app.</p>}
        {como === 'pedido' && <p>Abre numa janela própria, sem a barra do navegador, e fica no menu de apps e na tela inicial.</p>}
        {como === 'ios' && <ol className="passos-ios">
          <li>No Safari, toque em <strong>Compartilhar</strong> <Icon name="compartilhar-ios" size={16} />.</li>
          <li>Escolha <strong>Adicionar à Tela de Início</strong>.</li>
          <li>Confirme com <strong>Adicionar</strong>: o Margem aparece entre os seus apps.</li>
        </ol>}
        {como === 'manual' && <p>No Chrome ou no Edge, use o ícone de instalar <Icon name="baixar" size={16} /> na barra de endereço (ou o menu ⋮ → <strong>Instalar Margem</strong>). No Safari do Mac, <strong>Arquivo → Adicionar ao Dock</strong>.</p>}
        {resultado === 'recusado' && <p className="secundario" role="status">Tudo bem: dá para instalar depois, por aqui ou pelo navegador.</p>}
      </div>
      <div className="levar-acao">
        {como === 'pedido' && <Button variante="primario" onClick={() => void instalar()}><Icon name="baixar" size={16} /> Instalar</Button>}
        {como === 'instalado' && <span className="badge ativo"><Icon name="check" size={14} /> Instalado</span>}
        {(como === 'ios' || como === 'manual') && <a className={classesDoBotao({ tamanho: 'md' })} href="/ajuda/instalar" onClick={(e) => { e.preventDefault(); ir({ nome: 'ajuda', pagina: 'instalar' }); }}>Como instalar</a>}
      </div>
    </article>
    {integracoes().map((integracao) => <article key={integracao.nome} className="cartao-levar">
      <span className="levar-icone"><Icon name={integracao.icone} size={22} /></span>
      <div className="levar-corpo">
        <h3>{integracao.titulo}</h3>
        <p>{integracao.resumo}</p>
      </div>
      <div className="levar-acao">
        {integracao.link
          ? <a className={classesDoBotao({ tamanho: 'md' })} href={integracao.link} target="_blank" rel="noreferrer">Abrir <Icon name="arrow" size={14} /></a>
          : <a className={classesDoBotao({ tamanho: 'md' })} href={`/ajuda/${integracao.nome}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'ajuda', pagina: integracao.nome }); }}>Saiba mais</a>}
      </div>
    </article>)}
    {estado.levar !== 'concluida' && <div className="button-row levar-fim"><Button variante="ghost" className="small" onClick={() => despachar({ tipo: 'concluir_levar' })}><Icon name="check" size={16} /> Entendi</Button></div>}
  </div>;
}
