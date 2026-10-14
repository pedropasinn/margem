import { useEffect, useState } from 'react';
import { Button, IconButton } from '../ui/Primitives';
import { Icon } from '../ui/Icon';
import { TipoDoDocumento } from '../ui/TipoDoDocumento';
import { lerProgresso } from './api';
import { fraseDoEstado, frasesDasMarcas, funcoesDasMarcas } from './estado';
import type { Rota } from './rotas';
import type { ArvoreDaVersao, ItemDaBiblioteca } from './tipos';
import { tipoDoDocumento, verboDoDocumento } from './tipos';

export function PainelDoItem({ item, arvore, ir, fechar }: { item: ItemDaBiblioteca | undefined; arvore: ArvoreDaVersao | undefined; ir: (rota: Rota) => void; fechar: () => void }) {
  const [aba, mudarAba] = useState('info');
  const [progresso, definirProgresso] = useState<{ id: string; concluidos: string[] } | null>(null);
  const [erro, definirErro] = useState(false);
  useEffect(() => {
    let vivo = true; definirErro(false);
    if (item) void lerProgresso(item.id).then((r) => { if (vivo) definirProgresso({ id: item.id, concluidos: r.progresso?.capitulos_concluidos ?? [] }); }, () => { if (vivo) definirErro(true); });
    return () => { vivo = false; };
  }, [item?.id]);
  const total = typeof item?.capitulos_total === 'number' ? item.capitulos_total : arvore?.capitulos.length;
  const quantidade = item?.progresso?.capitulos_concluidos ?? 0;
  const concluidos = progresso?.id === item?.id ? progresso?.concluidos : undefined;
  return <aside className="painel-biblioteca" aria-label="Informações do texto"><header className="painel-abas"><Button variante="ghost" aria-pressed={aba === 'info'} onClick={() => mudarAba('info')}>Info</Button><Button variante="ghost" aria-pressed={aba === 'capitulos'} onClick={() => mudarAba('capitulos')}>Capítulos <span className="contador-capitulos">{total ?? '—'}</span></Button><Button variante="ghost" aria-pressed={aba === 'marcas'} onClick={() => mudarAba('marcas')}>Marcas <span className="contador-capitulos">{item?.marcas.total ?? 0}</span></Button><IconButton aria-label="Fechar informações" title="Fechar informações (])" onClick={fechar}><Icon name="painel" /></IconButton></header>
    {!item ? <p className="empty">Selecione um texto.</p> : aba === 'info' ? <div className="painel-corpo"><h2>{item.titulo}</h2>{item.autor && <p className="autor">{item.autor}</p>}<h3 className="eyebrow">Metadados</h3><dl>
      <dt>Tipo</dt><dd>{item.midia || item.formato === 'pdf' || total !== undefined ? <TipoDoDocumento {...tipoDoDocumento(item, total)} /> : '—'}</dd>{item.midia && <><dt>Duração</dt><dd>{Math.max(1, Math.round(item.midia.duracao_s / 60))} min</dd></>}<dt>Formato</dt><dd>{item.formato === 'md' ? 'Markdown' : item.formato.toUpperCase()}</dd><dt>Capítulos</dt><dd>{total ?? '—'}</dd><dt>Marcas</dt><dd>{item.marcas.total}{item.marcas.total > 0 && <small>{frasesDasMarcas(item).join(' · ')}</small>}</dd><dt>Adicionado em</dt><dd>{new Date(item.criado_em).toLocaleDateString('pt-BR')}</dd><dt>Última leitura</dt><dd>{item.progresso ? new Date(item.progresso.atualizado_em).toLocaleDateString('pt-BR') : 'Não aberto'}</dd><dt>Progresso</dt><dd>{total ? `${quantidade} de ${total} capítulos · ${Math.min(100, Math.round(100 * quantidade / total))}%` : '—'}</dd><dt>Estado</dt><dd>{fraseDoEstado(item)}</dd>
    </dl></div> : aba === 'marcas' ? <div className="painel-corpo"><h3 className="eyebrow">Marcas por função</h3>{item.marcas.total > 0 ? <ul className="painel-marcas">{funcoesDasMarcas(item).map(({ funcao, rotulo, quantidade }) => <li key={funcao}><span className="ponto-neutro" aria-hidden="true" /><span>{rotulo}</span><span>{quantidade}</span></li>)}</ul> : <p>Nenhuma marca ainda.</p>}</div> : <div className="painel-corpo">{erro && <p role="status">Não foi possível carregar os capítulos lidos.</p>}<ul className="painel-capitulos">{arvore?.capitulos.map((c) => <li key={c.id}><a href={`/ler/${item.id}/${c.id}`} onClick={(e) => { e.preventDefault(); ir({ nome: 'leitura', documento_id: item.id, secao_id: c.id }); }}><span className={`ponto-leitura ${concluidos?.includes(c.id) ? 'concluido' : ''}`} aria-label={concluidos === undefined ? 'Progresso indisponível' : concluidos.includes(c.id) ? 'Lido' : 'Não lido'} />{c.titulo}</a></li>)}</ul>{!arvore && <p>Capítulos indisponíveis.</p>}</div>}
    {item && <footer className="painel-rodape"><div className="button-row">{item.texto_disponivel && <Button variante="primario" onClick={() => ir({ nome: 'leitura', documento_id: item.id })}>{verboDoDocumento(item)} <Icon name="arrow" size={16} /></Button>}<Button onClick={() => ir({ nome: 'documento', documento_id: item.id })}>Documento</Button></div></footer>}
  </aside>;
}
