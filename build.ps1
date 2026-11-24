$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$src = Join-Path $root 'src'
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Path $bin -Force | Out-Null

$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "Не найден компилятор: $csc" }

$serverOut = Join-Path $bin 'priks-server.exe'
& $csc /nologo /target:exe /platform:anycpu /optimize+ /codepage:65001 /warn:4 "/out:$serverOut" /r:System.dll /r:System.Core.dll /r:System.Web.Extensions.dll (Join-Path $src 'Server.cs')
if ($LASTEXITCODE -ne 0) { throw "Сервер не собрался ($LASTEXITCODE)" }

$clientOut = Join-Path $bin 'priks.exe'
& $csc /nologo /target:winexe /platform:anycpu /optimize+ /codepage:65001 /warn:4 "/out:$clientOut" /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll /r:System.Web.Extensions.dll (Join-Path $src 'Client.cs')
if ($LASTEXITCODE -ne 0) { throw "Клиент не собрался ($LASTEXITCODE)" }

Write-Output ("OK: " + $serverOut + " (" + [math]::Round((Get-Item -LiteralPath $serverOut).Length / 1KB, 1) + " КБ)")
Write-Output ("OK: " + $clientOut + " (" + [math]::Round((Get-Item -LiteralPath $clientOut).Length / 1KB, 1) + " КБ)")
