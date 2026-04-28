"""Interactive CLI — an alternative to the HTTP API for local testing."""
import asyncio
import os

from dotenv import load_dotenv

load_dotenv()


async def main() -> None:
    from brain import JarvisBrain  # imported here so dotenv is loaded first

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        print("ERROR: ANTHROPIC_API_KEY not set. Copy .env.example → .env and fill it in.")
        return

    jarvis = JarvisBrain(api_key=api_key)
    print("🤖  Jarvis CLI  (type 'exit' to quit, 'clear' to reset history)\n")

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() == "exit":
            print("Goodbye!")
            break
        if user_input.lower() == "clear":
            jarvis.clear_history()
            print("History cleared.\n")
            continue

        print("Jarvis: ", end="", flush=True)
        async for chunk in jarvis.stream_message(user_input):
            print(chunk, end="", flush=True)
        print("\n")


if __name__ == "__main__":
    asyncio.run(main())
