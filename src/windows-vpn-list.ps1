$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$profiles = @(
    Get-VpnConnection -ErrorAction Stop
    Get-VpnConnection -AllUserConnection -ErrorAction Stop
)
$result = @($profiles | ForEach-Object {
    [pscustomobject]@{
        Name = $_.Name
        ConnectionStatus = [string]$_.ConnectionStatus
        AllUserConnection = [bool]$_.AllUserConnection
    }
})
ConvertTo-Json -InputObject $result -Compress
