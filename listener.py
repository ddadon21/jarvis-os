"""Wake-word listener — say "Hey Jarvis" to open a live call with the ElevenLabs agent.

Runs forever:

    listening  ->  wake word detected  ->  conversation  ->  back to listening

Detection uses openWakeWord's pretrained `hey_jarvis` model (ONNX runtime, so it
works on Windows as well as Linux/macOS). The conversation uses the ElevenLabs
`Conversation` class with `DefaultAudioInterface`.

Only one thing can hold the microphone at a time, so the listener always closes
its own mic stream before handing the device over to the conversation, and opens
a fresh one afterwards.

Stop with Ctrl+C.
"""
import os
import signal
import sys
import time

import numpy as np
from dotenv import load_dotenv

# --- wake word -------------------------------------------------------------
# `hey_jarvis` is one of openWakeWord's built-in pretrained models. The trigger
# phrase is literally "Hey Jarvis", spoken as one phrase at a normal pace.
WAKEWORD_MODEL = "hey_jarvis"       # key used by openwakeword.MODELS
WAKEWORD_ASSET = "hey_jarvis_v0.1"  # file name of the downloadable weights
WAKE_PHRASE = "Hey Jarvis"

# Confidence needed to count as a detection. 0.5 is openWakeWord's recommended
# default: lower it if the wake word is missed, raise it if it fires by itself.
THRESHOLD = 0.5

# --- audio -----------------------------------------------------------------
# openWakeWord expects 16 kHz mono 16-bit audio in 1280-sample (80 ms) chunks.
SAMPLE_RATE = 16000
CHUNK_SAMPLES = 1280

# Pause after a call before listening again, so the tail of the agent's last
# words can't immediately re-trigger the wake word.
COOLDOWN_SECONDS = 1.5


def load_config() -> tuple[str, str]:
    """Read credentials from .env, or exit with an actionable message."""
    load_dotenv()

    api_key = os.getenv("ELEVENLABS_API_KEY")
    agent_id = os.getenv("ELEVENLABS_AGENT_ID")

    missing = [
        name
        for name, value in (
            ("ELEVENLABS_API_KEY", api_key),
            ("ELEVENLABS_AGENT_ID", agent_id),
        )
        if not value
    ]
    if missing:
        print(
            "ERROR: missing required setting(s): " + ", ".join(missing) + "\n\n"
            "Create a file named .env next to listener.py (copy .env.example to\n"
            ".env) and fill in:\n\n"
            "    ELEVENLABS_API_KEY=your-elevenlabs-api-key\n"
            "    ELEVENLABS_AGENT_ID=your-agent-id\n\n"
            "The API key is at https://elevenlabs.io/app/settings/api-keys and the\n"
            "agent ID is on your agent's page under Agents.",
            file=sys.stderr,
        )
        sys.exit(1)

    return api_key, agent_id


def load_wakeword_model():
    """Download the pretrained weights if needed and load the detector."""
    import openwakeword
    from openwakeword.model import Model

    # No-op once the files are already on disk.
    openwakeword.utils.download_models([WAKEWORD_ASSET])

    # ONNX rather than the default tflite: tflite-runtime has no Windows build.
    return Model(wakeword_models=[WAKEWORD_MODEL], inference_framework="onnx")


class Microphone:
    """The default input device, as 16 kHz mono 16-bit chunks."""

    def __init__(self):
        try:
            import pyaudio
        except ImportError as exc:
            raise RuntimeError(
                "PyAudio is not installed, so the microphone cannot be opened.\n"
                "Install it with:  pip install -r requirements.txt"
            ) from exc

        self._audio = pyaudio.PyAudio()
        try:
            self._stream = self._audio.open(
                format=pyaudio.paInt16,
                channels=1,
                rate=SAMPLE_RATE,
                input=True,
                frames_per_buffer=CHUNK_SAMPLES,
            )
        except OSError as exc:
            self._audio.terminate()
            raise RuntimeError(
                "Could not open the default microphone. Check that a microphone is\n"
                "plugged in, that Windows has it set as the default input device, and\n"
                "that microphone access is allowed under Settings > Privacy > Microphone.\n"
                f"(PyAudio said: {exc})"
            ) from exc

    def read_chunk(self) -> np.ndarray:
        # A dropped chunk now and then is not worth crashing over.
        data = self._stream.read(CHUNK_SAMPLES, exception_on_overflow=False)
        return np.frombuffer(data, dtype=np.int16)

    def close(self) -> None:
        try:
            self._stream.stop_stream()
            self._stream.close()
        finally:
            self._audio.terminate()


def listen_for_wake_word(model) -> None:
    """Block until the wake phrase is heard. Releases the mic before returning."""
    model.reset()  # drop audio buffered from before this listening turn
    mic = Microphone()
    try:
        while True:
            scores = model.predict(mic.read_chunk())
            if max(scores.values(), default=0.0) >= THRESHOLD:
                return
    finally:
        mic.close()


def run_conversation(api_key: str, agent_id: str) -> bool:
    """Hold one live call with the agent. Returns True if Ctrl+C ended it."""
    from elevenlabs.client import ElevenLabs
    from elevenlabs.conversational_ai.conversation import Conversation
    from elevenlabs.conversational_ai.default_audio_interface import DefaultAudioInterface

    conversation = Conversation(
        ElevenLabs(api_key=api_key),
        agent_id,
        # Authenticate with the API key, which works for private and public agents.
        requires_auth=True,
        audio_interface=DefaultAudioInterface(),
        callback_agent_response=lambda text: print(f"    Jarvis: {text}"),
        callback_user_transcript=lambda text: print(f"    You:    {text}"),
    )

    interrupted = False

    def on_sigint(_signum, _frame):
        nonlocal interrupted
        interrupted = True
        print("\n[Ctrl+C] ending the conversation...")
        end_conversation(conversation)

    # While the call is up, Ctrl+C hangs up cleanly instead of killing the
    # process mid-stream; the previous handler is restored on the way out.
    previous_handler = signal.signal(signal.SIGINT, on_sigint)
    try:
        conversation.start_session()
        print("[conversation started]")
        # Returns when the agent hangs up, the socket closes, or Ctrl+C above.
        conversation.wait_for_session_end()
    finally:
        signal.signal(signal.SIGINT, previous_handler)
        end_conversation(conversation)

    return interrupted


def end_conversation(conversation) -> None:
    """Tear a session down; safe to call when it is already finished."""
    try:
        conversation.end_session()
    except Exception:
        # Already closed, or never fully opened — either way there is nothing
        # left to release.
        pass


def main() -> None:
    api_key, agent_id = load_config()

    print("Loading the wake word model (first run downloads it)...")
    model = load_wakeword_model()

    print(f'Ready. Wake phrase: "{WAKE_PHRASE}".  Press Ctrl+C to quit.\n')

    try:
        while True:
            print(f'[listening] say "{WAKE_PHRASE}"')
            listen_for_wake_word(model)
            print("[wake word detected]")

            try:
                interrupted = run_conversation(api_key, agent_id)
            except Exception as exc:
                print(f"[conversation failed] {type(exc).__name__}: {exc}")
                interrupted = False
            else:
                print("[conversation ended]")

            if interrupted:
                raise KeyboardInterrupt

            time.sleep(COOLDOWN_SECONDS)
            print("[back to listening]\n")
    except KeyboardInterrupt:
        print("\n[stopped] Goodbye.")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
