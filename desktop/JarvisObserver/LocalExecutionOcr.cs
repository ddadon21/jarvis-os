using System.Drawing;
using System.Drawing.Imaging;
using System.Text.RegularExpressions;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace JarvisObserver;

internal sealed class LocalExecutionOcr
{
    private readonly OcrEngine? _engine;
    private bool _hadWorkingOrder;
    private int _missingWorkingOrderScans;

    public LocalExecutionOcr()
    {
        try
        {
            _engine = OcrEngine.TryCreateFromUserProfileLanguages();
        }
        catch
        {
            _engine = null;
        }
    }

    public bool Available => _engine is not null;

    public async Task<string?> ReadAsync(Bitmap bitmap)
    {
        if (_engine is null) return null;

        try
        {
            using var png = new MemoryStream();
            bitmap.Save(png, ImageFormat.Png);
            var bytes = png.ToArray();

            using var randomAccess = new InMemoryRandomAccessStream();
            using (var output = randomAccess.GetOutputStreamAt(0))
            using (var writer = new DataWriter(output))
            {
                writer.WriteBytes(bytes);
                await writer.StoreAsync();
                await writer.FlushAsync();
            }

            randomAccess.Seek(0);
            var decoder = await BitmapDecoder.CreateAsync(randomAccess);
            using var softwareBitmap = await decoder.GetSoftwareBitmapAsync(
                BitmapPixelFormat.Bgra8,
                BitmapAlphaMode.Premultiplied);

            var result = await _engine.RecognizeAsync(softwareBitmap);
            return BuildSemantic(result);
        }
        catch
        {
            return null;
        }
    }

    private string BuildSemantic(OcrResult result)
    {
        var rows = result.Lines
            .Select(line =>
            {
                var words = line.Words.ToList();
                var text = string.Join(" ", words.Select(w => w.Text)).Trim();
                if (string.IsNullOrWhiteSpace(text)) return null;

                var left = words.Min(w => w.BoundingRect.X);
                var top = words.Min(w => w.BoundingRect.Y);
                var right = words.Max(w => w.BoundingRect.X + w.BoundingRect.Width);
                var bottom = words.Max(w => w.BoundingRect.Y + w.BoundingRect.Height);

                return new OcrRow(
                    text,
                    left,
                    top,
                    Math.Max(1, right - left),
                    Math.Max(1, bottom - top));
            })
            .Where(x => x is not null)
            .Cast<OcrRow>()
            .ToList();

        var output = new List<string>
        {
            "JARVIS_OCR_SURFACE|OK=1"
        };

        foreach (var row in rows.Take(220))
        {
            output.Add($"JARVIS_OCR|X={Math.Round(row.X)}|Y={Math.Round(row.Y)}|W={Math.Round(row.Width)}|H={Math.Round(row.Height)}|TEXT={Sanitize(row.Text)}");
        }

        var canonical = TryBuildExecution(rows);
        if (canonical is not null)
        {
            _hadWorkingOrder = true;
            _missingWorkingOrderScans = 0;
            output.Insert(0, canonical);
        }
        else
        {
            _missingWorkingOrderScans++;
            if (_missingWorkingOrderScans >= 2)
            {
                // A healthy OCR surface with no working-order row is explicit negative
                // evidence. Emit it continuously so a pending state confirmed by the
                // accessibility lane can still be cleared immediately after cancel.
                output.Insert(0, "JARVIS_OCR_EXECUTION|STATUS=FLAT");
                _hadWorkingOrder = false;
                _missingWorkingOrderScans = 2;
            }
        }

        return string.Join(Environment.NewLine, output);
    }

    private static string? TryBuildExecution(List<OcrRow> rows)
    {
        var reconstructed = rows
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Buy|Sell)$", RegexOptions.IgnoreCase))
            .Select(actionRow =>
            {
                var centerY = actionRow.Y + actionRow.Height / 2;
                var peers = rows
                    .Where(row => !ReferenceEquals(row, actionRow))
                    .Where(row => Math.Abs((row.Y + row.Height / 2) - centerY) <= Math.Max(16, actionRow.Height * 1.8))
                    .Where(row => row.X >= actionRow.X - 8 && row.X <= actionRow.X + 520)
                    .OrderBy(row => row.X)
                    .ToList();

                var quantityRow = peers
                    .Where(row => row.X >= actionRow.X + actionRow.Width - 4)
                    .FirstOrDefault(row => Regex.IsMatch(row.Text.Trim(), @"^\d+(?:\.\d+)?$"));

                var typeRow = peers
                    .Where(row => row.X >= actionRow.X + actionRow.Width - 4)
                    .FirstOrDefault(row => Regex.IsMatch(row.Text.Trim(), @"^(Limit|Stop|Market)$", RegexOptions.IgnoreCase));

                if (quantityRow is null || typeRow is null) return null;

                var quantity = ParseNumber(quantityRow.Text.Trim());
                var type = typeRow.Text.Trim().ToUpperInvariant();
                var price = FindNearestPrice(rows, typeRow, preferRight: true)
                    ?? FindNearestPrice(rows, actionRow, preferRight: true);

                return new ReconstructedOrder(
                    actionRow.Text.Trim().Equals("Buy", StringComparison.OrdinalIgnoreCase) ? "BUY" : "SELL",
                    quantity,
                    type,
                    price,
                    actionRow);
            })
            .Where(order => order is not null)
            .Cast<ReconstructedOrder>()
            .ToList();

        if (reconstructed.Count == 0) return null;

        var symbol = InferSymbol(rows);

        // A live bracketed position presents as two same-side exit orders: one STOP
        // and one LIMIT, with the original opposite-side entry order gone.
        var bracket = reconstructed
            .Where(order => order.Quantity is not null)
            .GroupBy(order => new { order.Action, Quantity = order.Quantity!.Value })
            .Select(group => new
            {
                group.Key.Action,
                group.Key.Quantity,
                Stop = group.FirstOrDefault(order => order.Type == "STOP"),
                Limit = group.FirstOrDefault(order => order.Type == "LIMIT"),
                HasOpposite = reconstructed.Any(order => order.Action != group.Key.Action),
            })
            .FirstOrDefault(group => group.Stop is not null && group.Limit is not null && !group.HasOpposite);

        if (bracket is not null)
        {
            var openSide = bracket.Action == "SELL" ? "LONG" : "SHORT";
            return string.Join("|", new[]
            {
                "JARVIS_OCR_EXECUTION",
                "STATUS=OPEN",
                $"SIDE={openSide}",
                $"QTY={bracket.Quantity.ToString(System.Globalization.CultureInfo.InvariantCulture)}",
                "TYPE=",
                $"SYMBOL={symbol ?? ""}",
                "ENTRY=",
                $"STOP={Format(bracket.Stop!.Price)}",
                $"TARGET={Format(bracket.Limit!.Price)}"
            });
        }

        // If an opposite-side entry is still present alongside its protective exits,
        // the position has not filled yet. Prefer that entry as the pending order.
        var bracketWithEntry = reconstructed
            .Where(order => order.Quantity is not null)
            .GroupBy(order => new { order.Action, Quantity = order.Quantity!.Value })
            .Select(group => new
            {
                group.Key.Action,
                group.Key.Quantity,
                Stop = group.FirstOrDefault(order => order.Type == "STOP"),
                Limit = group.FirstOrDefault(order => order.Type == "LIMIT"),
                Entry = reconstructed.FirstOrDefault(order => order.Action != group.Key.Action && order.Quantity == group.Key.Quantity),
            })
            .FirstOrDefault(group => group.Stop is not null && group.Limit is not null && group.Entry is not null);

        ReconstructedOrder entry;
        double? stop;
        double? target;

        if (bracketWithEntry is not null)
        {
            entry = bracketWithEntry.Entry!;
            stop = bracketWithEntry.Stop!.Price;
            target = bracketWithEntry.Limit!.Price;
        }
        else
        {
            entry = reconstructed
                .OrderByDescending(order => order.Anchor.Y)
                .First();
            stop = null;
            target = null;

            var stopAnchor = rows
                .Where(row => Regex.IsMatch(row.Text, @"(^|\s)-\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b", RegexOptions.IgnoreCase)
                           || Regex.IsMatch(row.Text, @"\b(stop loss|stop)\b", RegexOptions.IgnoreCase))
                .OrderBy(row => VerticalDistance(row, entry.Anchor))
                .FirstOrDefault();

            var targetAnchor = rows
                .Where(row => Regex.IsMatch(row.Text, @"(^|\s)\+\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b", RegexOptions.IgnoreCase)
                           || Regex.IsMatch(row.Text, @"\b(take profit|target)\b", RegexOptions.IgnoreCase))
                .OrderBy(row => VerticalDistance(row, entry.Anchor))
                .FirstOrDefault();

            stop = stopAnchor is null ? null : FindNearestPrice(rows, stopAnchor, preferRight: true);
            target = targetAnchor is null ? null : FindNearestPrice(rows, targetAnchor, preferRight: true);
        }

        var pendingSide = entry.Action == "BUY" ? "LONG" : "SHORT";
        return string.Join("|", new[]
        {
            "JARVIS_OCR_EXECUTION",
            "STATUS=PENDING",
            $"SIDE={pendingSide}",
            $"QTY={entry.Quantity?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? ""}",
            $"TYPE={entry.Type}",
            $"SYMBOL={symbol ?? ""}",
            $"ENTRY={Format(entry.Price)}",
            $"STOP={Format(stop)}",
            $"TARGET={Format(target)}"
        });
    }

    private sealed record ReconstructedOrder(
        string Action,
        double? Quantity,
        string Type,
        double? Price,
        OcrRow Anchor);

    private static string? InferSymbol(List<OcrRow> rows)
    {
        var text = string.Join(" ", rows.Take(80).Select(r => r.Text));

        if (Regex.IsMatch(text, @"Micro\s+E-?mini\s+Nasdaq-?100", RegexOptions.IgnoreCase)) return "MNQ";
        if (Regex.IsMatch(text, @"E-?mini\s+Nasdaq-?100", RegexOptions.IgnoreCase)) return "NQ";
        if (Regex.IsMatch(text, @"Micro\s+E-?mini\s+S&P", RegexOptions.IgnoreCase)) return "MES";
        if (Regex.IsMatch(text, @"E-?mini\s+S&P", RegexOptions.IgnoreCase)) return "ES";
        if (Regex.IsMatch(text, @"Micro\s+E-?mini\s+Dow", RegexOptions.IgnoreCase)) return "MYM";
        if (Regex.IsMatch(text, @"E-?mini\s+Dow", RegexOptions.IgnoreCase)) return "YM";

        return null;
    }

    private static double? FindNearestPrice(List<OcrRow> rows, OcrRow anchor, bool preferRight)
    {
        var candidates = rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Select(row => new
            {
                row,
                price = ExtractPrice(row.Text),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
                dx = row.X - (anchor.X + anchor.Width)
            })
            .Where(x => x.price is not null && x.dy <= Math.Max(34, anchor.Height * 2.5))
            .Where(x => !preferRight || x.dx >= -20)
            .OrderBy(x => x.dy * 4 + Math.Abs(x.dx))
            .FirstOrDefault();

        return candidates?.price;
    }

    private static double? ExtractPrice(string text)
    {
        var matches = Regex.Matches(text, @"(?<![\d$])\d{1,3}(?:,\d{3})+(?:\.\d{1,4})?|(?<![\d$])\d{4,6}(?:\.\d{1,4})?");
        foreach (Match match in matches)
        {
            var raw = match.Value.Replace(",", "");
            if (!double.TryParse(raw, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)) continue;
            if (value >= 100 && value <= 1_000_000) return value;
        }
        return null;
    }

    private static double? ParseNumber(string raw)
    {
        return double.TryParse(raw, System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var value)
            ? value
            : null;
    }

    private static double VerticalDistance(OcrRow a, OcrRow b)
    {
        return Math.Abs((a.Y + a.Height / 2) - (b.Y + b.Height / 2));
    }

    private static string Format(double? value)
    {
        return value?.ToString("0.####", System.Globalization.CultureInfo.InvariantCulture) ?? "";
    }

    private static string Sanitize(string value)
    {
        return value.Replace("|", "/").Replace("\r", " ").Replace("\n", " ").Trim();
    }

    private sealed record OcrRow(string Text, double X, double Y, double Width, double Height);
}
