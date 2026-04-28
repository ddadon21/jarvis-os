import json
import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from brain import JarvisBrain
from tools import REGISTRY

load_dotenv()

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

jarvis: JarvisBrain


@asynccontextmanager
async def lifespan(app: FastAPI):
    global jarvis
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set. Copy .env.example → .env and fill it in.")
    jarvis = JarvisBrain(api_key=api_key)
    logger.info("Jarvis online. Tools loaded: %s", REGISTRY.names())
    yield
    logger.info("Jarvis shutting down.")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Jarvis AI Assistant",
    description="Local AI assistant powered by Claude — chat, tools, file access.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, description="The user's message to Jarvis.")


class ChatResponse(BaseModel):
    response: str
    model: str = "claude-opus-4-7"


class ToolInfo(BaseModel):
    name: str
    description: str


class HistoryItem(BaseModel):
    role: str
    content: str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get("/health", tags=["meta"])
async def health():
    """Service health check."""
    return {"status": "ok", "tools_loaded": len(REGISTRY)}


@app.get("/tools", response_model=list[ToolInfo], tags=["meta"])
async def list_tools():
    """List all tools Jarvis can call."""
    return [ToolInfo(**t) for t in REGISTRY.info()]


@app.post("/chat", response_model=ChatResponse, tags=["chat"])
async def chat(request: ChatRequest):
    """Send a message and receive a complete response (blocking)."""
    try:
        text = await jarvis.process_message(request.message)
        return ChatResponse(response=text)
    except Exception as exc:
        logger.exception("Error in /chat")
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/chat/stream", tags=["chat"])
async def chat_stream(request: ChatRequest):
    """Send a message and stream the response token by token (Server-Sent Events)."""

    async def sse_generator():
        try:
            async for chunk in jarvis.stream_message(request.message):
                payload = json.dumps({"text": chunk})
                yield f"data: {payload}\n\n"
        except Exception as exc:
            logger.exception("Streaming error")
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")


@app.get("/history", response_model=list[HistoryItem], tags=["chat"])
async def get_history():
    """Return the current conversation history."""
    return [HistoryItem(**m) for m in jarvis.get_history()]


@app.delete("/history", tags=["chat"])
async def clear_history():
    """Clear the conversation history and start fresh."""
    jarvis.clear_history()
    return {"message": "History cleared."}
