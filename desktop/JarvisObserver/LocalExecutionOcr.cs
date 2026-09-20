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
            var rows = await RecognizeRowsAsync(bitmap, 0, 0, 1.0);

            // First find the actual order interaction cluster. TradingView often renders
            // qty/type/price as tiny sibling labels, so a whole-window OCR pass can see
            // "Buy" but miss "10 / Limit / 29,733.75". Re-scan only that active pane.
            var activeAnchor = FindActiveOrderAnchor(rows);
            if (activeAnchor is not null)
            {
                var paneRows = await RecognizeActiveOrderPaneAsync(bitmap, activeAnchor);
                rows = MergeRows(rows, paneRows);
            }

            var canonical = TryBuildExecution(rows) ?? TryBuildPreparation(rows);

            // If the targeted pass still did not produce a rich object, do one broader
            // enlarged lower-chart pass. This remains fallback, not the primary reader.
            if (!IsRichCanonical(canonical))
            {
                var cropY = Math.Max(0, (int)Math.Round(bitmap.Height * 0.30));
                var cropHeight = Math.Max(1, bitmap.Height - cropY);
                using var crop = new Bitmap(bitmap.Width, cropHeight, PixelFormat.Format32bppArgb);
                using (var graphics = Graphics.FromImage(crop))
                {
                    graphics.DrawImage(
                        bitmap,
                        new Rectangle(0, 0, crop.Width, crop.Height),
                        new Rectangle(0, cropY, bitmap.Width, cropHeight),
                        GraphicsUnit.Pixel);
                }

                var scale = Math.Min(3.0, 4090d / Math.Max(crop.Width, crop.Height));
                if (scale > 1.05)
                {
                    var scaledWidth = Math.Max(1, (int)Math.Round(crop.Width * scale));
                    var scaledHeight = Math.Max(1, (int)Math.Round(crop.Height * scale));
                    using var enlarged = new Bitmap(scaledWidth, scaledHeight, PixelFormat.Format32bppArgb);
                    using (var graphics = Graphics.FromImage(enlarged))
                    {
                        graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                        graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
                        graphics.DrawImage(crop, new Rectangle(0, 0, scaledWidth, scaledHeight));
                    }

                    var detailRows = await RecognizeRowsAsync(enlarged, 0, cropY, 1d / scale);
                    rows = MergeRows(rows, detailRows);
                }
            }

            return BuildSemantic(rows);
        }
        catch
        {
            return null;
        }
    }

    private static OcrRow? FindActiveOrderAnchor(List<OcrRow> rows)
    {
        // Prefer explicit draft controls because they identify the exact pane being edited.
        var draft = rows
            .Where(row => Regex.IsMatch(
                row.Text,
                @"\b(change order type|change order quantity|add order on|stop loss|take profit)\b",
                RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        if (draft is not null) return draft;

        // Then prefer a real working-order row.
        var combined = rows
            .Where(row => Regex.IsMatch(
                row.Text,
                @"^(Buy|Sell)\s+\d+(?:\.\d+)?\s+[A-Z]{1,8}[A-Z0-9!]{0,10}\s+@",
                RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        if (combined is not null) return combined;

        // Last resort: a lower-chart Buy/Sell action next to order controls.
        return rows
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Buy|Sell)$", RegexOptions.IgnoreCase))
            .Where(row => row.Y > 300)
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
    }

    private async Task<List<OcrRow>> RecognizeActiveOrderPaneAsync(Bitmap bitmap, OcrRow anchor)
    {
        // The active order label sits inside the chart pane. Capture a generous box
        // around it so the pane header, order row, bracket labels, and price axis are
        // read together. This naturally follows the correct pane in split-screen layouts.
        var left = Math.Max(0, (int)Math.Floor(anchor.X - 320));
        var top = Math.Max(0, (int)Math.Floor(anchor.Y - 260));
        var right = Math.Min(bitmap.Width, (int)Math.Ceiling(anchor.X + 560));
        var bottom = Math.Min(bitmap.Height, (int)Math.Ceiling(anchor.Y + 240));

        if (right - left < 180 || bottom - top < 120) return new List<OcrRow>();

        var width = right - left;
        var height = bottom - top;
        using var crop = new Bitmap(width, height, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(crop))
        {
            graphics.DrawImage(
                bitmap,
                new Rectangle(0, 0, width, height),
                new Rectangle(left, top, width, height),
                GraphicsUnit.Pixel);
        }

        var scale = Math.Min(4.25, 4090d / Math.Max(width, height));
        scale = Math.Max(1.0, scale);

        if (scale <= 1.05)
        {
            return await RecognizeRowsAsync(crop, left, top, 1.0);
        }

        var scaledWidth = Math.Max(1, (int)Math.Round(width * scale));
        var scaledHeight = Math.Max(1, (int)Math.Round(height * scale));
        using var enlarged = new Bitmap(scaledWidth, scaledHeight, PixelFormat.Format32bppArgb);
        using (var graphics = Graphics.FromImage(enlarged))
        {
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            graphics.DrawImage(crop, new Rectangle(0, 0, scaledWidth, scaledHeight));
        }

        return await RecognizeRowsAsync(enlarged, left, top, 1d / scale);
    }

    private async Task<List<OcrRow>> RecognizeRowsAsync(
        Bitmap bitmap,
        double originX,
        double originY,
        double coordinateScale)
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

        var result = await _engine!.RecognizeAsync(softwareBitmap);
        return result.Lines
            .Select(line =>
            {
                var words = line.Words.ToList();
                var text = string.Join(" ", words.Select(w => w.Text)).Trim();
                if (string.IsNullOrWhiteSpace(text)) return null;

                var left = words.Min(w => w.BoundingRect.X) * coordinateScale + originX;
                var top = words.Min(w => w.BoundingRect.Y) * coordinateScale + originY;
                var right = words.Max(w => w.BoundingRect.X + w.BoundingRect.Width) * coordinateScale + originX;
                var bottom = words.Max(w => w.BoundingRect.Y + w.BoundingRect.Height) * coordinateScale + originY;

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
    }

    private static List<OcrRow> MergeRows(List<OcrRow> primary, List<OcrRow> extra)
    {
        var merged = new List<OcrRow>(primary);
        foreach (var row in extra)
        {
            var duplicate = merged.Any(existing =>
                string.Equals(NormalizeText(existing.Text), NormalizeText(row.Text), StringComparison.OrdinalIgnoreCase) &&
                Math.Abs(existing.X - row.X) <= 16 &&
                Math.Abs(existing.Y - row.Y) <= 16);
            if (!duplicate) merged.Add(row);
        }
        return merged.OrderBy(row => row.Y).ThenBy(row => row.X).ToList();
    }

    private static bool IsRichCanonical(string? canonical)
    {
        if (string.IsNullOrWhiteSpace(canonical)) return false;
        if (!canonical.StartsWith("JARVIS_OCR_EXECUTION|", StringComparison.Ordinal)) return false;

        var required = new[] { "SYMBOL=", "SIDE=", "QTY=", "ENTRY=" };
        return required.All(key =>
        {
            var match = Regex.Match(canonical, $@"(?:^|\|){Regex.Escape(key)}([^|]*)");
            return match.Success && !string.IsNullOrWhiteSpace(match.Groups[1].Value);
        });
    }

    private static string NormalizeText(string value) =>
        Regex.Replace(value.Trim(), @"\s+", " ");

    private string BuildSemantic(List<OcrRow> rows)
    {
        var output = new List<string>
        {
            "JARVIS_OCR_SURFACE|OK=1"
        };

        foreach (var row in rows.Take(220))
        {
            output.Add($"JARVIS_OCR|X={Math.Round(row.X)}|Y={Math.Round(row.Y)}|W={Math.Round(row.Width)}|H={Math.Round(row.Height)}|TEXT={Sanitize(row.Text)}");
        }

        var canonical = TryBuildExecution(rows);
        var preparing = canonical is null ? TryBuildPreparation(rows) : null;
        if (canonical is not null)
        {
            _hadWorkingOrder = true;
            _missingWorkingOrderScans = 0;
            output.Insert(0, canonical);
        }
        else if (preparing is not null)
        {
            _missingWorkingOrderScans = 0;
            output.Insert(0, preparing);
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
        var combinedOrders = rows
            .Select(row => ParseCombinedOrder(row))
            .Where(order => order is not null)
            .Cast<ReconstructedOrder>()
            .ToList();

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
                    null,
                    null,
                    actionRow);
            })
            .Where(order => order is not null)
            .Cast<ReconstructedOrder>()
            .ToList();

        reconstructed = combinedOrders
            .Concat(reconstructed)
            .GroupBy(order => new
            {
                order.Action,
                order.Quantity,
                order.Type,
                Price = order.Price is null ? (double?)null : Math.Round(order.Price.Value, 4),
                order.Contract,
            })
            .Select(group => group.First())
            .ToList();

        if (reconstructed.Count == 0) return null;

        var symbol = NormalizeContractRoot(reconstructed.Select(order => order.Contract).FirstOrDefault(contract => !string.IsNullOrWhiteSpace(contract))) ?? InferSymbol(rows, reconstructed.OrderByDescending(order => order.Anchor.Y).FirstOrDefault()?.Anchor);

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
            stop = FindRiskRewardPrice(rows, entry.Anchor, negative: true) ?? bracketWithEntry.Stop!.Price;
            target = FindRiskRewardPrice(rows, entry.Anchor, negative: false) ?? bracketWithEntry.Limit!.Price;
        }
        else
        {
            var protectiveAction = combinedOrders
                .Where(order => order.Type == "STOP")
                .GroupBy(order => order.Action)
                .OrderByDescending(group => group.Count())
                .Select(group => group.Key)
                .FirstOrDefault();

            var inferredEntryAction =
                protectiveAction == "SELL" ? "BUY" :
                protectiveAction == "BUY" ? "SELL" :
                null;

            entry =
                (inferredEntryAction is not null
                    ? combinedOrders.FirstOrDefault(order =>
                        order.Action == inferredEntryAction &&
                        (order.Type == "LIMIT" || order.Type == "STOP" || order.Type == "MARKET"))
                    : null)
                ?? combinedOrders.OrderBy(order => order.Anchor.Y).FirstOrDefault()
                ?? reconstructed.OrderBy(order => order.Anchor.Y).First();

            stop = FindRiskRewardPrice(rows, entry.Anchor, negative: true);
            target = FindRiskRewardPrice(rows, entry.Anchor, negative: false);
        }

        var pendingSide = entry.Action == "BUY" ? "LONG" : "SHORT";
        var hasFullOrderLine = combinedOrders.Count > 0;
        var hasDraftControls = rows.Any(row =>
            Regex.IsMatch(row.Text, @"\b(change order type|change order quantity|^quantity$)\b", RegexOptions.IgnoreCase));

        return string.Join("|", new[]
        {
            "JARVIS_OCR_EXECUTION",
            $"STATUS={(hasFullOrderLine || !hasDraftControls ? "PENDING" : "PREPARING")}",
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
        string? Contract,
        double? SecondaryLimitPrice,
        OcrRow Anchor);

    private static ReconstructedOrder? ParseCombinedOrder(OcrRow row)
    {
        var match = Regex.Match(
            row.Text.Trim(),
            @"^(Buy|Sell)\s+(\d+(?:\.\d+)?)\s+([A-Z]{1,8}[A-Z0-9!]{0,10})\s+@\s+([\d,]+(?:\.\d+)?)\s+(limit|stop|market)\b(?:\s+([\d,]+(?:\.\d+)?)\s+limit\b)?",
            RegexOptions.IgnoreCase);
        if (!match.Success) return null;

        return new ReconstructedOrder(
            match.Groups[1].Value.Equals("Buy", StringComparison.OrdinalIgnoreCase) ? "BUY" : "SELL",
            ParseNumber(match.Groups[2].Value),
            match.Groups[5].Value.ToUpperInvariant(),
            ParseNumber(match.Groups[4].Value.Replace(",", "")),
            match.Groups[3].Value.ToUpperInvariant(),
            match.Groups[6].Success ? ParseNumber(match.Groups[6].Value.Replace(",", "")) : null,
            row);
    }

    private static string? TryBuildPreparation(List<OcrRow> rows)
    {
        var ticketAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, @"\b(change order type|change order quantity|^quantity$|stop loss|take profit)\b", RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        if (ticketAnchor is null) return null;

        var symbol = InferSymbol(rows, ticketAnchor);
        var addOrder = rows
            .Select(row => Regex.Match(row.Text, @"Add order on\s+([A-Z0-9! ]{2,20}?)\s+at\s+([\d,]+(?:\.\d+)?)", RegexOptions.IgnoreCase))
            .FirstOrDefault(match => match.Success);

        if (symbol is null && addOrder is not null && addOrder.Success)
        {
            symbol = NormalizeOcrTicker(addOrder.Groups[1].Value);
        }

        var entryPrice = addOrder is not null && addOrder.Success
            ? ParseNumber(addOrder.Groups[2].Value.Replace(",", ""))
            : (double?)null;

        var quantityAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, @"\b(change order quantity|^quantity$)\b", RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        var quantity = quantityAnchor is null ? null : FindNearestPlainNumber(rows, quantityAnchor, 140, 75, 1, 1000);

        var orderTypeAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, @"\bchange order type\b", RegexOptions.IgnoreCase))
            .OrderByDescending(row => row.Y)
            .FirstOrDefault();
        var orderType = orderTypeAnchor is null ? null : FindNearestOrderType(rows, orderTypeAnchor);

        var stopPrice = FindRiskRewardPrice(rows, ticketAnchor, negative: true);
        var targetPrice = FindRiskRewardPrice(rows, ticketAnchor, negative: false);

        string? side = null;
        var action = rows
            .Where(row => row.Y >= ticketAnchor.Y - 180 && row.Y <= ticketAnchor.Y + 180)
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Buy|Sell)$", RegexOptions.IgnoreCase))
            .OrderBy(row => VerticalDistance(row, ticketAnchor))
            .FirstOrDefault();

        if (action is not null)
        {
            side = action.Text.Equals("Buy", StringComparison.OrdinalIgnoreCase) ? "LONG" : "SHORT";
        }
        else if (entryPrice is not null && stopPrice is not null && Math.Abs(entryPrice.Value - stopPrice.Value) > 0.000001)
        {
            side = stopPrice < entryPrice ? "LONG" : "SHORT";
        }

        var hasDetails =
            symbol is not null ||
            quantity is not null ||
            orderType is not null ||
            entryPrice is not null ||
            stopPrice is not null ||
            targetPrice is not null;
        if (!hasDetails) return null;

        return string.Join("|", new[]
        {
            "JARVIS_OCR_EXECUTION",
            "STATUS=PREPARING",
            $"SIDE={side ?? ""}",
            $"QTY={quantity?.ToString(System.Globalization.CultureInfo.InvariantCulture) ?? ""}",
            $"TYPE={orderType ?? ""}",
            $"SYMBOL={symbol ?? ""}",
            $"ENTRY={Format(entryPrice)}",
            $"STOP={Format(stopPrice)}",
            $"TARGET={Format(targetPrice)}"
        });
    }

    private static double? FindNearestPlainNumber(
        List<OcrRow> rows,
        OcrRow anchor,
        double maxDx,
        double maxDy,
        double min,
        double max)
    {
        return rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Select(row => new
            {
                row,
                value = Regex.IsMatch(row.Text.Trim(), @"^\d+(?:\.\d+)?$")
                    ? ParseNumber(row.Text.Trim())
                    : null,
                dx = Math.Abs((row.X + row.Width / 2) - (anchor.X + anchor.Width / 2)),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
            })
            .Where(item => item.value is not null && item.value >= min && item.value <= max)
            .Where(item => item.dx <= maxDx && item.dy <= maxDy)
            .OrderBy(item => item.dy * 4 + item.dx)
            .Select(item => item.value)
            .FirstOrDefault();
    }

    private static string? FindNearestOrderType(List<OcrRow> rows, OcrRow anchor)
    {
        var candidates = rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Where(row => Regex.IsMatch(row.Text.Trim(), @"^(Limit|Stop|Market)$", RegexOptions.IgnoreCase))
            .Select(row => new
            {
                row,
                dx = Math.Abs((row.X + row.Width / 2) - (anchor.X + anchor.Width / 2)),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
            })
            .Where(item => item.dx <= 180 && item.dy <= 95)
            .OrderBy(item => item.dy * 4 + item.dx)
            .ToList();

        if (candidates.Count == 0) return null;
        if (candidates.Count > 1 && Math.Abs(candidates[0].dy - candidates[1].dy) < 8) return null;
        return candidates[0].row.Text.Trim().ToUpperInvariant();
    }

    private static double? FindRiskRewardPrice(List<OcrRow> rows, OcrRow anchor, bool negative)
    {
        var signPattern = negative
            ? @"(^|\s)-\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\bstop loss\b"
            : @"(^|\s)\+\s*\$?\d[\d,]*(?:\.\d+)?\s*(USD)?\b|\b(take profit|target)\b";

        var riskAnchor = rows
            .Where(row => Regex.IsMatch(row.Text, signPattern, RegexOptions.IgnoreCase))
            .OrderBy(row => VerticalDistance(row, anchor))
            .FirstOrDefault();

        return riskAnchor is null ? null : FindNearestPriceWide(rows, riskAnchor);
    }

    private static double? FindNearestPriceWide(List<OcrRow> rows, OcrRow anchor)
    {
        return rows
            .Where(row => !ReferenceEquals(row, anchor))
            .Select(row => new
            {
                price = ExtractPrice(row.Text),
                dy = Math.Abs((row.Y + row.Height / 2) - (anchor.Y + anchor.Height / 2)),
                dx = row.X - (anchor.X + anchor.Width),
            })
            .Where(item => item.price is not null && item.dy <= 48 && item.dx >= -35 && item.dx <= 520)
            .OrderBy(item => item.dy * 5 + Math.Abs(item.dx))
            .Select(item => item.price)
            .FirstOrDefault();
    }

    private static string? NormalizeContractRoot(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var symbol = Regex.Replace(raw.ToUpperInvariant(), @"[^A-Z0-9!]", "");
        var contract = Regex.Match(symbol, @"^([A-Z]{1,5})[FGHJKMNQUVXZ]\d{2,4}$");
        if (contract.Success) return contract.Groups[1].Value;
        return NormalizeOcrTicker(symbol);
    }

    private static string? NormalizeOcrTicker(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var symbol = Regex.Replace(raw.ToUpperInvariant(), @"[^A-Z0-9!]", "");

        var known = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["MNQ"] = "MNQ", ["MNQ1"] = "MNQ", ["MNQI"] = "MNQ", ["MNQ1!"] = "MNQ", ["MNQI!"] = "MNQ",
            ["NQ"] = "NQ", ["NQ1"] = "NQ", ["NQI"] = "NQ", ["NQ1!"] = "NQ", ["NQI!"] = "NQ",
            ["MES"] = "MES", ["MES1"] = "MES", ["MESI"] = "MES", ["MES1!"] = "MES",
            ["ES"] = "ES", ["ES1"] = "ES", ["ESI"] = "ES", ["ES1!"] = "ES",
            ["MYM"] = "MYM", ["MYM1"] = "MYM", ["MYMI"] = "MYM", ["MYM1!"] = "MYM",
            ["YM"] = "YM", ["YM1"] = "YM", ["YMI"] = "YM", ["YM1!"] = "YM",
            ["M2K"] = "M2K", ["RTY"] = "RTY", ["MGC"] = "MGC", ["GC"] = "GC",
            ["MCL"] = "MCL", ["CL"] = "CL", ["SIL"] = "SIL", ["SI"] = "SI",
            ["HG"] = "HG", ["ZB"] = "ZB", ["ZN"] = "ZN", ["ZF"] = "ZF", ["ZT"] = "ZT"
        };

        return known.TryGetValue(symbol, out var normalized) ? normalized : null;
    }

    private static string? InferSymbol(List<OcrRow> rows, OcrRow? activeAnchor = null)
    {
        IEnumerable<OcrRow> scoped = rows;

        if (activeAnchor is not null)
        {
            // Prefer the same visual pane as the active order. This prevents a second
            // chart in a split-screen layout from donating the wrong symbol.
            scoped = rows
                .Where(row => Math.Abs((row.X + row.Width / 2) - (activeAnchor.X + activeAnchor.Width / 2)) <= 520)
                .Where(row => row.Y <= activeAnchor.Y + 140);
        }

        var scopedList = scoped.ToList();

        foreach (var row in scopedList.Take(220))
        {
            var contract = Regex.Match(row.Text.ToUpperInvariant(), @"\b([A-Z]{1,5}[FGHJKMNQUVXZ]\d{2,4})\b");
            if (contract.Success)
            {
                var normalized = NormalizeContractRoot(contract.Groups[1].Value);
                if (normalized is not null) return normalized;
            }

            var continuous = Regex.Match(row.Text.ToUpperInvariant(), @"\b([A-Z0-9]{2,6}[1I]?!?)\b");
            if (continuous.Success)
            {
                var normalized = NormalizeOcrTicker(continuous.Groups[1].Value);
                if (normalized is not null) return normalized;
            }
        }

        var text = string.Join(" ", scopedList.Take(220).Select(r => r.Text));
        if (Regex.IsMatch(text, @"Micro.*Nasdaq.*100", RegexOptions.IgnoreCase)) return "MNQ";
        if (Regex.IsMatch(text, @"Nasdaq.*100", RegexOptions.IgnoreCase)) return "NQ";
        if (Regex.IsMatch(text, @"Micro.*S\s*&?\s*P", RegexOptions.IgnoreCase)) return "MES";
        if (Regex.IsMatch(text, @"E-?mini.*S\s*&?\s*P", RegexOptions.IgnoreCase)) return "ES";
        if (Regex.IsMatch(text, @"Micro.*Dow", RegexOptions.IgnoreCase)) return "MYM";
        if (Regex.IsMatch(text, @"E-?mini.*Dow", RegexOptions.IgnoreCase)) return "YM";
        if (Regex.IsMatch(text, @"Micro.*Russell", RegexOptions.IgnoreCase)) return "M2K";
        if (Regex.IsMatch(text, @"Russell.*2000", RegexOptions.IgnoreCase)) return "RTY";
        if (Regex.IsMatch(text, @"Micro.*Gold", RegexOptions.IgnoreCase)) return "MGC";
        if (Regex.IsMatch(text, @"Gold.*Futures", RegexOptions.IgnoreCase)) return "GC";
        if (Regex.IsMatch(text, @"Micro.*Crude", RegexOptions.IgnoreCase)) return "MCL";
        if (Regex.IsMatch(text, @"Crude.*Oil", RegexOptions.IgnoreCase)) return "CL";

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
