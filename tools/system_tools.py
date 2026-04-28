import platform
import subprocess
from pathlib import Path


def open_chrome(url: str) -> str:
    """Open Google Chrome at the specified URL.

    Args:
        url: The full URL to open (e.g. https://example.com).
    """
    system = platform.system()
    try:
        if system == "Darwin":
            subprocess.Popen(["open", "-a", "Google Chrome", url])
        elif system == "Linux":
            for browser in ["google-chrome", "google-chrome-stable", "chromium-browser", "chromium"]:
                try:
                    subprocess.Popen([browser, url])
                    return f"Opened Chrome at: {url}"
                except FileNotFoundError:
                    continue
            subprocess.Popen(["xdg-open", url])
        elif system == "Windows":
            subprocess.Popen(["cmd", "/c", "start", "chrome", url])
        else:
            return f"Unsupported platform: {system}"
        return f"Opened Chrome at: {url}"
    except Exception as e:
        return f"Failed to open Chrome: {e}"


def open_tradingview(symbol: str = "") -> str:
    """Open TradingView in Chrome, optionally for a specific trading symbol.

    Args:
        symbol: Optional ticker symbol (e.g. AAPL, BTCUSDT, BINANCE:BTCUSDT).
    """
    base = "https://www.tradingview.com/chart/"
    url = f"{base}?symbol={symbol.upper()}" if symbol else base
    return open_chrome(url)


def list_files(directory: str = ".", pattern: str = "*", recursive: bool = False) -> str:
    """List files and directories at the given path.

    Args:
        directory: Path to list (defaults to current directory).
        pattern: Glob pattern to filter results (e.g. *.py).
        recursive: Whether to search subdirectories recursively.
    """
    try:
        path = Path(directory).expanduser().resolve()
        if not path.exists():
            return f"Directory not found: {directory}"
        if not path.is_dir():
            return f"Not a directory: {directory}"

        entries = list(path.rglob(pattern) if recursive else path.glob(pattern))
        if not entries:
            return f"No entries found in '{path}' matching '{pattern}'"

        dirs = sorted(e for e in entries if e.is_dir())
        files = sorted(e for e in entries if e.is_file())

        lines = [f"Contents of '{path}':"]
        for d in dirs:
            lines.append(f"  [DIR]  {d.relative_to(path)}/")
        for f in files:
            size = f.stat().st_size
            size_str = f"{size / 1024:.1f} KB" if size >= 1024 else f"{size} B"
            lines.append(f"  [FILE] {f.relative_to(path)} ({size_str})")
        lines.append(f"\nTotal: {len(dirs)} dirs, {len(files)} files")
        return "\n".join(lines)
    except PermissionError:
        return f"Permission denied: {directory}"
    except Exception as e:
        return f"Error listing files: {e}"
