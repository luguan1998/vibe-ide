Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Select-Object ProcessId, ParentProcessId,
    @{N='MemMB';E={[math]::Round($_.WorkingSetSize/1MB)}},
    @{N='Cmd';E={$_.CommandLine.Substring(0, [Math]::Min(100, $_.CommandLine.Length))}} |
  Format-Table -AutoSize
