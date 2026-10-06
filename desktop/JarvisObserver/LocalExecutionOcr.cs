using System.Drawing;
using System.Drawing.Imaging;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace JarvisObserver;

/// <summary>
/// Windows OCR front end: captures text rows (with order-label colors) from the
/// TradingView frame and hands them to the platform-neutral <see cref="ExecutionParser"/>.
/// </summary>
internal sealed class LocalExecutionOcr
{
    private readonly OcrEngine? _engine;
    private readonly ExecutionParser _parser = new();

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

    public async Task<string?> ReadAsync(Bitmap bitmap, Point? pointer = null, string? titleSymbol = null)
    {
        if (_engine is null) return null;

        try
        {
            var rows = await RecognizeRowsAsync(bitmap, 0, 0, 1.0);

            // First find the actual order interaction cluster. TradingView often renders
            // qty/type/price as tiny sibling labels, so a whole-window OCR pass can see
            // "Buy" but miss "10 / Limit / 29,733.75". Re-scan only that active pane.
            (double X, double Y)? at = pointer is null ? null : (pointer.Value.X, pointer.Value.Y);
            var activeAnchor = ExecutionParser.FindActiveOrderAnchor(rows, at);
            if (activeAnchor is not null)
            {
                var paneRows = await RecognizeActiveOrderPaneAsync(bitmap, activeAnchor);
                rows = ExecutionParser.MergeRows(rows, paneRows);
            }

            var canonical = ExecutionParser.TryBuildExecution(rows, titleSymbol) ?? ExecutionParser.TryBuildPreparation(rows, titleSymbol);

            // If the targeted pass still did not produce a rich object, do one broader
            // enlarged lower-chart pass. This remains fallback, not the primary reader.
            if (!ExecutionParser.IsRichCanonical(canonical))
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
                    rows = ExecutionParser.MergeRows(rows, detailRows);
                }
            }

            var scoped = ExecutionParser.ScopeToOrderPane(rows, ExecutionParser.FindActiveOrderAnchor(rows, at));
            return _parser.BuildSemantic(scoped, DateTime.UtcNow, titleSymbol);
        }
        catch
        {
            return null;
        }
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
        var rows = new List<OcrRow>();
        foreach (var line in result.Lines)
        {
            var words = line.Words.ToList();
            if (words.Count == 0) continue;
            var text = string.Join(" ", words.Select(w => w.Text)).Trim();
            if (string.IsNullOrWhiteSpace(text)) continue;
            var left = words.Min(w => w.BoundingRect.X);
            var top = words.Min(w => w.BoundingRect.Y);
            var right = words.Max(w => w.BoundingRect.X + w.BoundingRect.Width);
            var bottom = words.Max(w => w.BoundingRect.Y + w.BoundingRect.Height);
            rows.Add(new OcrRow(text, left * coordinateScale + originX, top * coordinateScale + originY,
                (right - left) * coordinateScale, (bottom - top) * coordinateScale)
                { MarkerColor = ReadMarkerColor(bitmap, left, top, right - left, bottom - top) });
            // Keep actual word boxes as well as complete strings. OCR often returns
            // "10 Limit x" as one line; the qty and type still have separate boxes.
            foreach (var word in words.Where(_ => words.Count > 1))
            {
                var box = word.BoundingRect;
                rows.Add(new OcrRow(word.Text, box.X * coordinateScale + originX, box.Y * coordinateScale + originY,
                    box.Width * coordinateScale, box.Height * coordinateScale)
                    { MarkerColor = ReadMarkerColor(bitmap, box.X, box.Y, box.Width, box.Height) });
            }
        }
        return rows;
    }

    private static string? ReadMarkerColor(Bitmap bitmap, double x, double y, double width, double height)
    {
        var red = 0; var blue = 0; var total = 0;
        for (var py = Math.Max(0, (int)y); py < Math.Min(bitmap.Height, (int)(y + height)); py += 2)
            for (var px = Math.Max(0, (int)x); px < Math.Min(bitmap.Width, (int)(x + width)); px += 3)
            {
                var c = bitmap.GetPixel(px, py); total++;
                if (c.R > 140 && c.R > c.G * 1.45 && c.R > c.B * 1.25) red++;
                if (c.B > 140 && c.B > c.R * 1.4 && c.B > c.G * 1.12) blue++;
            }
        return total > 0 && red > total * .08 && red > blue ? "RED" :
            total > 0 && blue > total * .08 ? "BLUE" : null;
    }
}
