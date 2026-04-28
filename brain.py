import logging
from typing import AsyncGenerator, Optional

import anthropic

from tools import REGISTRY

logger = logging.getLogger(__name__)

_MODEL = "claude-opus-4-7"
_MAX_TOKENS = 16000
_MAX_TOOL_ITERATIONS = 10

_SYSTEM_PROMPT = """You are Jarvis, a capable and direct local AI assistant running on the user's computer.

You have access to tools that can open applications, navigate websites, and inspect the filesystem.
When a user asks you to perform an action, call the appropriate tool immediately — do not ask for confirmation
unless the request is genuinely ambiguous. After using a tool, confirm what you did concisely.

Be helpful, precise, and action-oriented."""


class JarvisBrain:
    """Orchestrates multi-turn conversations with Claude, including tool use loops."""

    def __init__(self, api_key: Optional[str] = None) -> None:
        self._client = anthropic.AsyncAnthropic(api_key=api_key)
        self._history: list[dict] = []
        self._tool_schemas = REGISTRY.claude_schemas()

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def process_message(self, user_message: str) -> str:
        """Run the full agentic loop and return the final text response."""
        self._history.append({"role": "user", "content": user_message})
        messages = list(self._history)

        for iteration in range(_MAX_TOOL_ITERATIONS):
            logger.debug("Agentic loop iteration %d", iteration)

            response = await self._client.messages.create(
                model=_MODEL,
                max_tokens=_MAX_TOKENS,
                system=_SYSTEM_PROMPT,
                thinking={"type": "adaptive"},
                tools=self._tool_schemas,
                messages=messages,
            )

            logger.debug("stop_reason=%s", response.stop_reason)

            if response.stop_reason == "end_turn":
                text = _extract_text(response)
                self._history.append({"role": "assistant", "content": text})
                return text

            if response.stop_reason == "tool_use":
                messages.append({"role": "assistant", "content": response.content})
                results = self._run_tools(response)
                messages.append({"role": "user", "content": results})
                continue

            # Unexpected stop reason — surface whatever text is available
            text = _extract_text(response)
            self._history.append({"role": "assistant", "content": text})
            return text

        fallback = "I reached the tool iteration limit. Please try a simpler request."
        self._history.append({"role": "assistant", "content": fallback})
        return fallback

    async def stream_message(self, user_message: str) -> AsyncGenerator[str, None]:
        """Stream text tokens as they are produced, pausing transparently for tool calls."""
        self._history.append({"role": "user", "content": user_message})
        messages = list(self._history)
        final_text: list[str] = []

        for iteration in range(_MAX_TOOL_ITERATIONS):
            async with self._client.messages.stream(
                model=_MODEL,
                max_tokens=_MAX_TOKENS,
                system=_SYSTEM_PROMPT,
                thinking={"type": "adaptive"},
                tools=self._tool_schemas,
                messages=messages,
            ) as stream:
                async for event in stream:
                    if (
                        event.type == "content_block_delta"
                        and event.delta.type == "text_delta"
                    ):
                        yield event.delta.text
                        final_text.append(event.delta.text)

                response = await stream.get_final_message()

            if response.stop_reason == "end_turn":
                self._history.append({"role": "assistant", "content": "".join(final_text)})
                return

            if response.stop_reason == "tool_use":
                tool_names = [b.name for b in response.content if b.type == "tool_use"]
                yield f"\n\n🔧 *Running: {', '.join(tool_names)}…*\n\n"

                messages.append({"role": "assistant", "content": response.content})
                results = self._run_tools(response)
                messages.append({"role": "user", "content": results})
                final_text.clear()
                continue

            self._history.append({"role": "assistant", "content": "".join(final_text)})
            return

        fallback = "\n\nI reached the tool iteration limit."
        yield fallback
        self._history.append({"role": "assistant", "content": "".join(final_text) + fallback})

    def get_history(self) -> list[dict]:
        """Return the conversation history as plain dicts (serialisation-safe)."""
        return [{"role": m["role"], "content": m["content"]} for m in self._history]

    def clear_history(self) -> None:
        self._history.clear()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _run_tools(self, response: anthropic.types.Message) -> list[dict]:
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            logger.info("Tool call: %s(%s)", block.name, block.input)
            output = REGISTRY.execute(block.name, **block.input)
            logger.info("Tool result: %s", output)
            results.append(
                {"type": "tool_result", "tool_use_id": block.id, "content": output}
            )
        return results


def _extract_text(response: anthropic.types.Message) -> str:
    parts = [b.text for b in response.content if b.type == "text"]
    return "\n".join(parts).strip() or "Done."
