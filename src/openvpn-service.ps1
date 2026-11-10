$ErrorActionPreference = 'Stop'
$pipe = $null
$process = $null
try {
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    if ($request.port -lt 1 -or $request.port -gt 65535) { throw 'Invalid port' }
    if ($request.secret -notmatch '^[a-f0-9]{64}$') { throw 'Invalid secret' }
    $directory = [IO.Path]::GetFullPath([string]$request.directory)
    $config = [IO.Path]::GetFullPath([string]$request.config)
    if ([IO.Path]::GetDirectoryName($config) -ne $directory -or [IO.Path]::GetFileName($config) -ne 'client.ovpn') { throw 'Invalid config' }
    # Fixed protocol to the official Interactive Service. No executable or script paths from renderer.
    $options = '--config "' + $config + '" --management 127.0.0.1 ' + [int]$request.port + ' stdin --management-client --management-hold --management-query-passwords --management-forget-disconnect'
    if ($request.auth -eq $true) { $options += ' --auth-user-pass' }
    $message = $directory + [char]0 + $options + [char]0 + $request.secret + "`n" + [char]0
    $pipe = New-Object IO.Pipes.NamedPipeClientStream('.', 'openvpn-CloudMeet\service', [IO.Pipes.PipeDirection]::InOut, [IO.Pipes.PipeOptions]::None)
    $pipe.Connect(10000)
    $pipe.ReadMode = [IO.Pipes.PipeTransmissionMode]::Message
    $bytes = [Text.Encoding]::Unicode.GetBytes($message)
    $pipe.Write($bytes, 0, $bytes.Length)
    $pipe.Flush()
    $buffer = New-Object byte[] 16384
    $count = $pipe.Read($buffer, 0, $buffer.Length)
    $response = [Text.Encoding]::Unicode.GetString($buffer, 0, $count).Trim([char]0)
    $lines = $response -split "`n"
    if ($lines.Count -lt 3 -or $lines[0].Trim() -ne '0x00000000' -or $lines[1].Trim() -notmatch '^0x[0-9a-fA-F]{8}$') { throw 'Service rejected request' }
    $vpnProcessId = [Convert]::ToInt32($lines[1].Trim().Substring(2), 16)
    $process = [Diagnostics.Process]::GetProcessById($vpnProcessId)
    [Console]::Out.WriteLine('READY:' + $vpnProcessId)
    [Console]::Out.Flush()
    # Parent closes stdin on exit. Closing the service pipe alone does NOT stop OpenVPN.
    $parentClosed = [Console]::In.ReadLineAsync()
    while (-not $process.WaitForExit(500)) {
        if ($parentClosed.IsCompleted) {
            $process.Kill()
            $process.WaitForExit()
            break
        }
    }
    if ($process.HasExited -and $process.ExitCode -ne 0) { exit 1 }
} catch {
    # Never print raw config, service response, command arguments or credentials.
    [Console]::Error.WriteLine('OpenVPN service bridge failed.')
    exit 1
} finally {
    if ($null -ne $pipe) { $pipe.Dispose() }
}
