import type { MovimentoDoCapituloV1 } from '@margem/contratos';

export function SinteseDoCapitulo({ movimento }: { movimento: MovimentoDoCapituloV1 | null }) {
  if (!movimento?.texto.trim()) return null;
  return <details className="metodo-estudo sintese-capitulo">
    <summary>Síntese do capítulo · IA</summary>
    <p>{movimento.texto}</p>
    {movimento.etapas.length > 0 && <ol>{movimento.etapas.map((etapa, indice) => <li key={indice}>{etapa.descricao}</li>)}</ol>}
  </details>;
}
