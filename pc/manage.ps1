param(
    [ValidateSet('build','install','status','uninstall')][string]$Action = 'status',
    [string]$Python = "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    [string]$Codex = "$env:LOCALAPPDATA\Programs\OpenAI\Codex\bin\codex.exe",
    [string]$Rollout = '',
    [string]$User = [Security.Principal.WindowsIdentity]::GetCurrent().Name
)
$ErrorActionPreference = 'Stop'
$serviceName = 'KindleDesk'
$taskName = 'KindleDesk-Codex'
$firewallName = 'KindleDesk-LAN'
$scriptPath = Join-Path $PSScriptRoot 'collector.py'
$hostPath = Join-Path $PSScriptRoot 'KindleDesk.Service.exe'

if ($Action -eq 'status') {
    Get-Service -Name $serviceName -ErrorAction SilentlyContinue | Select-Object Name,Status,StartType
    Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Select-Object TaskName,State
    Invoke-RestMethod http://127.0.0.1:18768/health
    exit
}
if ($Action -eq 'build') {
    & "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /reference:System.ServiceProcess.dll "/out:$hostPath" (Join-Path $PSScriptRoot 'ServiceHost.cs')
    if ($LASTEXITCODE -ne 0) { throw 'Service host compilation failed.' }
    exit
}
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Installing or uninstalling the Windows service requires an elevated PowerShell window.' }

try {
    if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $taskName
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
        Stop-Service -Name $serviceName
        & sc.exe delete $serviceName | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Service deletion failed.' }
    }
    if (Get-NetFirewallRule -Name $firewallName -ErrorAction SilentlyContinue) { Remove-NetFirewallRule -Name $firewallName }
    if ($Action -eq 'install') {
        foreach ($path in @($Python,$Codex,$hostPath,$scriptPath)) {
            if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing file: $path" }
        }
        # This Python installation belongs to the desktop user; LocalService needs
        # read/execute access to the interpreter and its standard library only.
        & icacls.exe (Split-Path $Python) /grant '*S-1-5-19:(OI)(CI)(RX)' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Could not grant LocalService access to Python.' }
        $command = '"{0}" "{1}" "{2}"' -f $hostPath,$Python,$scriptPath
        & sc.exe create $serviceName binPath= $command start= delayed-auto obj= 'NT AUTHORITY\LocalService' DisplayName= 'Kindle Desk 数据服务' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Service creation failed.' }
        & sc.exe description $serviceName 'Windows performance and LAN snapshot for Kindle Desk; Codex credentials stay with the desktop user.' | Out-Null
        if (-not [Diagnostics.EventLog]::SourceExists($serviceName)) { [Diagnostics.EventLog]::CreateEventSource($serviceName,'Application') }
        New-NetFirewallRule -Name $firewallName -DisplayName 'Kindle Desk 局域网数据' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 18768 -Profile Private -RemoteAddress LocalSubnet | Out-Null
        $pythonWindowless = Join-Path (Split-Path $Python) 'pythonw.exe'
        $taskArguments = '"{0}" quota --codex "{1}"' -f $scriptPath,$Codex
        if ($Rollout) {
            if (-not (Test-Path -LiteralPath $Rollout -PathType Leaf)) { throw 'Rollout file not found.' }
            $taskArguments += ' --rollout "{0}"' -f (Resolve-Path -LiteralPath $Rollout).Path
        }
        $taskAction = New-ScheduledTaskAction -Execute $pythonWindowless -Argument $taskArguments -WorkingDirectory $PSScriptRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $User
        $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
        Register-ScheduledTask -TaskName $taskName -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Description 'Read current user Codex quota; publish only display fields to Kindle Desk.' | Out-Null
        Start-Service -Name $serviceName
        Start-ScheduledTask -TaskName $taskName
        $deadline = (Get-Date).AddSeconds(45)
        do {
            Start-Sleep -Milliseconds 500
            $health = $null
            try { $health = Invoke-RestMethod http://127.0.0.1:18768/health -TimeoutSec 2 } catch [System.Net.Http.HttpRequestException] { }
        } until (($health.computer -and $health.quotaState -eq 'ready') -or (Get-Date) -gt $deadline)
        if (-not $health.computer -or $health.quotaState -ne 'ready') { throw 'Service started but real data did not become ready within 45 seconds.' }
        Stop-Service -Name $serviceName
        $listener = Get-NetTCPConnection -LocalPort 18768 -State Listen -ErrorAction SilentlyContinue
        if ($listener) { throw 'HTTP listener remained after service stop.' }
        Start-Service -Name $serviceName
        $deadline = (Get-Date).AddSeconds(45)
        do {
            Start-Sleep -Milliseconds 500
            $health = $null
            try { $health = Invoke-RestMethod http://127.0.0.1:18768/health -TimeoutSec 2 } catch [System.Net.Http.HttpRequestException] { }
        } until (($health.computer -and $health.quotaState -eq 'ready') -or (Get-Date) -gt $deadline)
        if (-not $health.computer -or $health.quotaState -ne 'ready') { throw 'Service restart did not restore real data.' }
    }
    @{action=$Action;success=$true;time=(Get-Date -Format o)} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'install-result.json') -Encoding utf8
} catch {
    @{action=$Action;success=$false;error=$_.Exception.Message;time=(Get-Date -Format o)} | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot 'install-result.json') -Encoding utf8
    throw
}
