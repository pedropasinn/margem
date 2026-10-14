import { useRef, useState } from 'react';
import { usarAparencia } from '../leitor/ContextoDeAparencia';
import type { Preferencias } from '../leitor/preferencias';
import { Button, Chip, IconButton, Input, Textarea, Select, Switch, Checkbox, SegmentedControl, Popover, Drawer, SeletorDeArquivo } from './Primitives';
import './galeria-ui.css';
import { ExemploDeAvisos, ExemploDeAvisosComRessalva } from '../avisos/ExemploDeAvisos';

function ExemploPopover({ tipo }: { tipo: 'normal' | 'overflow' | 'borda' }) {
  const ancora = useRef<HTMLButtonElement>(null);
  const [aberto, abrir] = useState(false);
  return <div className={`exemplo-popover exemplo-${tipo}`}><Button ref={ancora} onClick={() => abrir(!aberto)}>Popover {tipo}</Button>{aberto && <Popover ancora={ancora} rotulo={`Popover ${tipo}`} aoFechar={() => abrir(false)}><div className="formulario"><h2>Opções da leitura</h2><Select aria-label={`Select no popover ${tipo}`}>{Array.from({ length: 20 }, (_, i) => <option key={i} value={i}>Opção {i + 1} com texto extenso para verificar a quebra no menu</option>)}</Select>{Array.from({ length: tipo === 'overflow' ? 24 : 1 }, (_, i) => <p key={i}>Conteúdo do painel {i + 1}.</p>)}<Button onClick={() => abrir(false)}>Fechar painel</Button></div></Popover>}</div>;
}
export function GaleriaDeUi() {
  const { preferencias, alterar } = usarAparencia();
  const [ligado, ligar] = useState(true);
  const [desligado, desligar] = useState(false);
  const [desmarcado, desmarcar] = useState(false);
  const [marcado, marcar] = useState(true);
  const [segmento, escolherSegmento] = useState('arquivo');
  const [chip, ligarChip] = useState(true);
  const [drawer, abrirDrawer] = useState(false);
  const [arquivos, escolherArquivo] = useState<File[]>([]);
  const opcoes = <><option value="automatico">Automático</option><option value="prosa">Prosa</option><option value="poesia">Poesia</option><option value="longo">Uma opção com texto longo para conferir largura e truncamento do controle</option></>;
  return <main className="galeria-ui"><header><h1>Primitives do Margem</h1><p>Galeria local · sem API. Abra os menus, use Tab, setas e Escape para conferir os estados.</p><SegmentedControl rotulo="Tema da galeria" valor={preferencias.tema} aoMudar={(tema) => alterar({ tipo: 'alterar', valores: { tema: tema as Preferencias['tema'] } })} opcoes={['escuro', 'claro', 'sepia'].map((valor) => ({ valor, rotulo: valor }))} /></header>
    <section className="card"><h2>Button</h2><p>Três tamanhos (sm 32 · md 40 · lg 44) e quatro variantes. Um primário por formulário ou página; Cancelar é ghost, à esquerda dele; Apagar é perigo, dentro de menu ou confirmação.</p>
      <div className="grade-de-botoes" role="table" aria-label="Tamanhos e variantes">
        <div role="row"><span role="columnheader" />{(['sm', 'md', 'lg'] as const).map((tamanho) => <span role="columnheader" key={tamanho}>{tamanho}</span>)}</div>
        {(['primario', 'secundario', 'ghost', 'perigo'] as const).map((variante) => <div role="row" key={variante}><span role="rowheader">{variante}</span>
          {(['sm', 'md', 'lg'] as const).map((tamanho) => <span role="cell" key={tamanho}><Button variante={variante} tamanho={tamanho}>{variante === 'perigo' ? 'Apagar' : 'Salvar'}</Button><Button variante={variante} tamanho={tamanho} disabled>Indisponível</Button></span>)}</div>)}
      </div>
      <div className="ui-rodape exemplo-rodape"><Button variante="ghost" tamanho="md">Cancelar</Button><Button variante="primario" tamanho="md">Salvar</Button></div>
    </section>
    <section className="card"><h2>IconButton e Chip</h2><div className="amostras-ui">
      <IconButton tamanho="sm" icone="reticencias" aria-label="Mais opções (sm)" /><IconButton icone="reticencias" aria-label="Mais opções" /><IconButton icone="xis" aria-label="Fechar" /><IconButton icone="relacao" aria-label="Conexões" disabled />
    </div><div className="amostras-ui">
      <Chip>Desligado</Chip><Chip pressionado>Ligado</Chip><Chip cor="#e0b100" conta={12} pressionado={chip} onClick={() => ligarChip(!chip)}>Tese</Chip><Chip tamanho="md" conta={3}>Médio</Chip><Chip disabled>Indisponível</Chip>
    </div></section>
    <section className="card"><h2>Input</h2><div className="grade-ui"><label>Padrão<Input placeholder="Título" /></label><label>Foco<Input data-estado="focus" defaultValue="Título em edição" /></label><label>Erro<Input aria-invalid="true" aria-describedby="erro-campo" defaultValue="Valor inválido" /><small id="erro-campo">Confira o título.</small></label><label>Desabilitado<Input disabled defaultValue="Indisponível" /></label><label>Texto longo<Textarea defaultValue="Uma nota de leitura." /></label></div></section>
    <section className="card"><h2>Select</h2><p>Acione qualquer controle para conferir o estado aberto e o teclado.</p><div className="grade-ui">{(['fechado', 'hover', 'focus', 'disabled', 'longo'] as const).map((estado) => <label key={estado}>{estado}<Select aria-label={`Select ${estado}`} data-estado={estado === 'hover' || estado === 'focus' ? estado : undefined} disabled={estado === 'disabled'} defaultValue={estado === 'longo' ? 'longo' : 'automatico'}>{opcoes}</Select></label>)}</div></section>
    <section className="card"><h2>Switch, Checkbox e SegmentedControl</h2><div className="amostras-ui"><Switch checked={desligado} onChange={desligar}>Desligado</Switch><Switch checked={ligado} onChange={ligar}>Ligado</Switch><Switch checked disabled onChange={() => {}}>Desabilitado</Switch><Checkbox checked={marcado} onChange={marcar}>Marcado</Checkbox><Checkbox checked={desmarcado} onChange={desmarcar}>Desmarcado</Checkbox><Checkbox checked disabled onChange={() => {}}>Desabilitado</Checkbox></div><SegmentedControl rotulo="Entrada" valor={segmento} aoMudar={escolherSegmento} opcoes={[{ valor: 'arquivo', rotulo: 'Arquivo' }, { valor: 'texto', rotulo: 'Colar texto' }]} /></section>
    <section className="card"><h2>Popover e Drawer</h2><div className="amostras-ui"><ExemploPopover tipo="normal" /><ExemploPopover tipo="overflow" /><Button onClick={() => abrirDrawer(true)}>Abrir Drawer</Button><span>Drawer {drawer ? 'aberto' : 'fechado'}</span></div><ExemploPopover tipo="borda" />{drawer && <Drawer rotulo="Drawer de demonstração" aoFechar={() => abrirDrawer(false)}><div className="formulario"><p>A página mantém sua posição.</p><Select aria-label="Select no drawer">{opcoes}</Select><Input aria-label="Nota no drawer" /><Button onClick={() => abrirDrawer(false)}>Concluir</Button></div></Drawer>}</section>
    <section className="card"><h2>Seletor de arquivo</h2><SeletorDeArquivo arquivos={arquivos} aoEscolher={escolherArquivo} /></section>
    <section className="card"><h2>Avisos do Codex</h2><p>Dados falsos. Esc dispensa o aviso em foco.</p><ExemploDeAvisos /></section>
    <section className="card"><h2>Concluída com avisos</h2><p>Dados falsos. Fica até ser dispensada.</p><ExemploDeAvisosComRessalva /></section>
  </main>;
}
