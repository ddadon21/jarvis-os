from .registry import ToolRegistry
from .system_tools import list_files, open_chrome, open_tradingview

REGISTRY = ToolRegistry()
REGISTRY.register(open_chrome)
REGISTRY.register(open_tradingview)
REGISTRY.register(list_files)

__all__ = ["REGISTRY"]
