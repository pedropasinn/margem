import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PdfReader } from '../src/leitor/PdfReader';
import { capituloExemplo } from '../src/leitor/fixtures/capitulo-exemplo';
import type { Bloco } from '@margem/contratos';

const { blocos } = await (await fetch('/benchmark-fixture.json')).json() as { blocos: Bloco[] };
const marcas = blocos.map((b, i) => ({ ...capituloExemplo.marcas[0]!, id: `M${i}`, subfaixas: [], ancora: {
  ...capituloExemplo.marcas[0]!.ancora, versao_id: 'V', bloco_id: b.id, inicio_utf16: 0, fim_utf16: b.texto.length,
  citacao: b.texto, prefixo: '', sufixo: '',
} }));
const snapshot = { ...capituloExemplo, versao_id: 'V', blocos, marcas, formato: 'pdf' as const, paginas: { inicio: 1, fim: 2 }, assets: {} };
function Ensaio() {
  const [ativa, ativar] = useState<string | null>(null);
  return <><button onClick={() => ativar('M1')}>Ativar segundo grifo</button><PdfReader documento_id="D" snapshot={snapshot} ativa={ativa} /></>;
}
createRoot(document.getElementById('root')!).render(<Ensaio />);
