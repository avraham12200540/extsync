using System.Buffers.Binary;
using System.IO.Pipes;
using System.Text;

// ExtSync Native Messaging Host (§27).
// A thin, dependency-free bridge: it relays Chrome Native Messaging (4-byte
// little-endian length-prefixed UTF-8 JSON on stdin/stdout) to/from the Agent
// over the per-user named pipe `extsync-agent`. It performs NO file operations
// and runs at user level. Chrome launches it on demand for an allowed origin.

const string PipeName = "extsync-agent";
const int MaxMessageBytes = 1 * 1024 * 1024; // Chrome caps ext->host at 1MB

using var stdin = Console.OpenStandardInput();
using var stdout = Console.OpenStandardOutput();

NamedPipeClientStream pipe;
try
{
    pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
    await pipe.ConnectAsync(3000);
}
catch
{
    // Agent not running. Tell the extension and exit cleanly (Bridge handles this).
    WriteChrome(stdout, "{\"type\":\"agent.status\",\"protocolVersion\":1,\"requestId\":\"na\"," +
                        "\"timestamp\":0,\"projectId\":\"\",\"extensionId\":\"\"," +
                        "\"payload\":{\"connected\":false}}");
    return;
}

using var cts = new CancellationTokenSource();
var pipeReader = new StreamReader(pipe, Encoding.UTF8);
var pipeWriter = new StreamWriter(pipe, new UTF8Encoding(false)) { AutoFlush = true };

// Chrome -> Agent
var toAgent = Task.Run(async () =>
{
    try
    {
        while (!cts.IsCancellationRequested)
        {
            var msg = ReadChrome(stdin);
            if (msg is null) break; // stdin closed -> Chrome closed the port
            await pipeWriter.WriteLineAsync(msg);
        }
    }
    catch { /* terminate on any error */ }
    finally { cts.Cancel(); }
});

// Agent -> Chrome
var toChrome = Task.Run(async () =>
{
    try
    {
        while (!cts.IsCancellationRequested)
        {
            var line = await pipeReader.ReadLineAsync(cts.Token);
            if (line is null) break; // pipe closed
            if (line.Length == 0) continue;
            WriteChrome(stdout, line);
        }
    }
    catch { /* terminate on any error */ }
    finally { cts.Cancel(); }
});

await Task.WhenAny(toAgent, toChrome);
cts.Cancel();
pipe.Dispose();
return;

static string? ReadChrome(Stream stdin)
{
    Span<byte> lenBuf = stackalloc byte[4];
    int read = ReadExact(stdin, lenBuf);
    if (read < 4) return null;
    int length = BinaryPrimitives.ReadInt32LittleEndian(lenBuf);
    if (length <= 0 || length > MaxMessageBytes) return null;
    var buffer = new byte[length];
    if (ReadExact(stdin, buffer) < length) return null;
    return Encoding.UTF8.GetString(buffer);
}

static void WriteChrome(Stream stdout, string json)
{
    var bytes = Encoding.UTF8.GetBytes(json);
    Span<byte> lenBuf = stackalloc byte[4];
    BinaryPrimitives.WriteInt32LittleEndian(lenBuf, bytes.Length);
    stdout.Write(lenBuf);
    stdout.Write(bytes);
    stdout.Flush();
}

static int ReadExact(Stream s, Span<byte> buffer)
{
    int total = 0;
    while (total < buffer.Length)
    {
        int n = s.Read(buffer[total..]);
        if (n == 0) break;
        total += n;
    }
    return total;
}
