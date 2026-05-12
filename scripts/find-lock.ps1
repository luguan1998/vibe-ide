$procs = Get-Process | Where-Object { $_.ProcessName -like '*electron*' -or $_.ProcessName -like '*vibe*' }
if ($procs) {
    $procs | Format-Table Id, ProcessName, Path
} else {
    Write-Host "No electron/vibe processes found"
}
