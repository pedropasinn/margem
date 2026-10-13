import './estilos/legal.css';
import { montar } from './montar';
import { PaginaLegal, PRIVACIDADE } from './paginas/Legal';

montar(<PaginaLegal titulo="Política de privacidade" atualizado="outubro de 2026" secoes={PRIVACIDADE} />);
