import inspect
import typing
from dataclasses import dataclass
from typing import Any, Callable, get_type_hints


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict  # JSON Schema object
    fn: Callable

    def to_claude_schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "input_schema": self.parameters,
        }


def _annotation_to_json_schema(annotation: Any) -> dict:
    """Recursively convert a Python type annotation to a JSON Schema dict."""
    if annotation is inspect.Parameter.empty:
        return {"type": "string"}

    origin = getattr(annotation, "__origin__", None)

    # Handle Optional[X] = Union[X, None]
    if origin is typing.Union:
        non_none = [a for a in annotation.__args__ if a is not type(None)]
        if len(non_none) == 1:
            return _annotation_to_json_schema(non_none[0])
        return {"type": "string"}

    mapping = {
        str: {"type": "string"},
        int: {"type": "integer"},
        float: {"type": "number"},
        bool: {"type": "boolean"},
        list: {"type": "array"},
        dict: {"type": "object"},
    }
    return mapping.get(annotation, {"type": "string"})


def _extract_param_doc(docstring: str, param_name: str) -> str:
    """Pull a parameter description out of a Google-style docstring."""
    for line in (docstring or "").splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{param_name}:"):
            return stripped[len(param_name) + 1:].strip()
    return ""


class ToolRegistry:
    """Maintains a registry of callable tools with Claude-compatible schemas."""

    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    def register(self, fn: Callable, description: str = "") -> "ToolRegistry":
        """Register a callable as a Jarvis tool.

        Schema is derived automatically from type annotations and the docstring.
        Parameters with defaults are treated as optional.
        """
        sig = inspect.signature(fn)
        hints = get_type_hints(fn)
        docstring = inspect.getdoc(fn) or ""
        doc = description or docstring.split("\n")[0]

        properties: dict[str, dict] = {}
        required: list[str] = []

        for name, param in sig.parameters.items():
            if name == "self":
                continue

            schema = _annotation_to_json_schema(hints.get(name, inspect.Parameter.empty))
            param_desc = _extract_param_doc(docstring, name)
            if param_desc:
                schema = {**schema, "description": param_desc}
            properties[name] = schema

            has_default = param.default is not inspect.Parameter.empty
            annotation = hints.get(name)
            origin = getattr(annotation, "__origin__", None)
            is_optional = origin is typing.Union and type(None) in getattr(annotation, "__args__", ())

            if not has_default and not is_optional:
                required.append(name)

        json_schema: dict[str, Any] = {"type": "object", "properties": properties}
        if required:
            json_schema["required"] = required

        self._tools[fn.__name__] = ToolDefinition(
            name=fn.__name__,
            description=doc,
            parameters=json_schema,
            fn=fn,
        )
        return self

    def execute(self, name: str, **kwargs: Any) -> str:
        """Dispatch a tool call by name, returning a string result."""
        if name not in self._tools:
            return f"Unknown tool: '{name}'"
        try:
            result = self._tools[name].fn(**kwargs)
            return str(result)
        except TypeError as e:
            return f"Tool '{name}' called with invalid arguments: {e}"
        except Exception as e:
            return f"Tool '{name}' raised an error: {e}"

    def claude_schemas(self) -> list[dict]:
        return [t.to_claude_schema() for t in self._tools.values()]

    def info(self) -> list[dict]:
        return [{"name": t.name, "description": t.description} for t in self._tools.values()]

    def names(self) -> list[str]:
        return list(self._tools.keys())

    def __len__(self) -> int:
        return len(self._tools)
