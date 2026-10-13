"""Cada processo importa o motor de uma cópia privada e estável dos fontes."""

from pathlib import Path
from tempfile import TemporaryDirectory

__version__ = "0.0.1"

# Congelar antes de importar qualquer módulo do motor, inclusive imports tardios.
# Atualizações do checkout só afetam processos novos. Não inclui dependências do
# venv; estas continuam identificadas separadamente e não devem mudar em execução.
_raiz = Path(__file__).parent
_fontes = {p.name: p.read_bytes() for p in sorted(_raiz.glob("*.py"))}
if _fontes != {p.name: p.read_bytes() for p in sorted(_raiz.glob("*.py"))}:
    raise RuntimeError("Fontes do motor mudaram durante a captura; execute novamente.")
_copia_do_motor = TemporaryDirectory(prefix="margem-motor-fontes-")
_diretorio = Path(_copia_do_motor.name)
for _nome, _conteudo in _fontes.items():
    _arquivo = _diretorio / _nome
    _arquivo.write_bytes(_conteudo)
    _arquivo.chmod(0o444)
_diretorio.chmod(0o500)
# O pacote é plano. Nenhum import de submódulo retorna ao checkout mutável.
__path__ = [str(_diretorio)]
del _fontes, _raiz, _nome, _conteudo, _arquivo, _diretorio
