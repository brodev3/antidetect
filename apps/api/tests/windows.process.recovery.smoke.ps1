[CmdletBinding()]
param(
  [ValidateSet("Run", "Owner", "Helper")]
  [string]$Mode = "Run",
  [string]$MetadataPath,
  [string]$ReadyPath,
  [string]$RunId,
  [string]$ProfileDirectory,
  [string]$StopSignalName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function ConvertTo-QuotedArgument {
  param([Parameter(Mandatory)][string]$Value)

  if ($Value.Contains('"')) {
    throw "Test arguments must not contain quotation marks."
  }

  return '"' + $Value + '"'
}

if ($env:OS -ne "Windows_NT") {
  throw "This smoke test can only run on Windows."
}

if ($Mode -eq "Helper") {
  if ([string]::IsNullOrWhiteSpace($ReadyPath) -or
      [string]::IsNullOrWhiteSpace($RunId) -or
      [string]::IsNullOrWhiteSpace($StopSignalName) -or
      [string]::IsNullOrWhiteSpace($ProfileDirectory)) {
    throw "Helper mode requires ready path, run id, profile directory, and stop signal name."
  }

  $profilePath = [System.IO.Path]::GetFullPath($ProfileDirectory)
  if (-not [System.IO.Directory]::Exists($profilePath)) {
    throw "The disposable helper profile directory does not exist."
  }
  $profileMarkerPath = Join-Path $profilePath "recovery.marker"
  [System.IO.File]::WriteAllText($profileMarkerPath, $RunId)
  $stopAckPath = Join-Path $profilePath "stop.ack"
  $createdNewSignal = $false
  $stopSignal = [System.Threading.EventWaitHandle]::new(
    $false,
    [System.Threading.EventResetMode]::ManualReset,
    $StopSignalName,
    [ref]$createdNewSignal
  )
  if (-not $createdNewSignal) {
    throw "The disposable helper stop signal already exists."
  }

  try {
    [System.IO.File]::WriteAllText($ReadyPath, $RunId)
    if (-not $stopSignal.WaitOne(20000)) {
      throw "The disposable helper self-expired before receiving a stop signal."
    }
    [System.IO.File]::WriteAllText($stopAckPath, $RunId)
  }
  finally {
    $stopSignal.Dispose()
  }

  exit 0
}

if ($Mode -eq "Owner") {
  foreach ($requiredValue in @($MetadataPath, $ReadyPath, $RunId, $ProfileDirectory, $StopSignalName)) {
    if ([string]::IsNullOrWhiteSpace($requiredValue)) {
      throw "Owner mode is missing a required argument."
    }
  }

  $powerShellPath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $scriptArgument = ConvertTo-QuotedArgument -Value $PSCommandPath
  $profileArgument = ConvertTo-QuotedArgument -Value $ProfileDirectory
  $readyArgument = ConvertTo-QuotedArgument -Value $ReadyPath
  $helperArguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-File",
    $scriptArgument,
    "-Mode",
    "Helper",
    "-RunId",
    $RunId,
    "-ProfileDirectory",
    $profileArgument,
    "-StopSignalName",
    $StopSignalName,
    "-ReadyPath",
    $readyArgument
  ) -join " "

  $helper = Start-Process `
    -FilePath $powerShellPath `
    -ArgumentList $helperArguments `
    -WindowStyle Hidden `
    -PassThru

  $readyDeadline = [DateTime]::UtcNow.AddSeconds(10)
  while (-not [System.IO.File]::Exists($ReadyPath)) {
    $helper.Refresh()
    if ($helper.HasExited) {
      throw "The disposable helper exited before becoming ready."
    }
    if ([DateTime]::UtcNow -ge $readyDeadline) {
      throw "Timed out waiting for the disposable helper to become ready."
    }
    Start-Sleep -Milliseconds 100
  }

  $helper.Refresh()
  if ($helper.HasExited) {
    throw "The disposable helper exited before its identity was persisted."
  }

  $helperProcess = [System.Diagnostics.Process]::GetProcessById([int]$helper.Id)
  $helperProcess.Refresh()
  if ($helperProcess.HasExited) {
    throw "The disposable helper exited before its identity was persisted."
  }

  $metadata = [ordered]@{
    runId = $RunId
    processId = [int]$helper.Id
    processCreationTimeUtcTicks = [long]$helper.StartTime.ToUniversalTime().Ticks
    executablePath = [System.IO.Path]::GetFullPath($helperProcess.MainModule.FileName)
    profileDirectory = [System.IO.Path]::GetFullPath($ProfileDirectory)
    stopSignalName = $StopSignalName
  }
  $json = ConvertTo-Json -InputObject $metadata -Compress
  $utf8 = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($MetadataPath, $json, $utf8)
  exit 0
}

$runRoot = $null
$runId = [Guid]::NewGuid().ToString("N")
$stopSignalName = "Local\antidetect-recovery-$runId"
$identityVerified = $false
$helperExited = $false
$reopenedProcess = $null
$stopSignal = $null
$runExitCode = 0

try {
  $runRoot = [System.IO.Path]::GetFullPath(
    (Join-Path ([System.IO.Path]::GetTempPath()) "antidetect-process-recovery-$runId")
  )
  $profileDirectory = Join-Path $runRoot "profile"
  $metadataPath = Join-Path $runRoot "recovery.json"
  $readyPath = Join-Path $runRoot "helper.ready"
  $null = New-Item -ItemType Directory -Path $profileDirectory

  $powerShellPath = [System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
  $ownerArguments = @(
    "-NoProfile",
    "-NonInteractive",
    "-File",
    (ConvertTo-QuotedArgument -Value $PSCommandPath),
    "-Mode",
    "Owner",
    "-MetadataPath",
    (ConvertTo-QuotedArgument -Value $metadataPath),
    "-ReadyPath",
    (ConvertTo-QuotedArgument -Value $readyPath),
    "-RunId",
    $runId,
    "-ProfileDirectory",
    (ConvertTo-QuotedArgument -Value $profileDirectory),
    "-StopSignalName",
    $stopSignalName
  ) -join " "

  # Wait for this controller only; Start-Process -Wait also waits for descendants on Windows.
  $owner = Start-Process `
    -FilePath $powerShellPath `
    -ArgumentList $ownerArguments `
    -WindowStyle Hidden `
    -PassThru
  if (-not $owner.WaitForExit(10000)) {
    throw "The first controller did not exit before the timeout."
  }
  $owner.Refresh()
  if ($owner.ExitCode -ne 0) {
    throw "The first controller failed with exit code $($owner.ExitCode)."
  }

  if (-not [System.IO.File]::Exists($metadataPath)) {
    throw "The first controller exited without persisting process identity."
  }
  $metadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
  if ($metadata.runId -ne $runId -or $metadata.stopSignalName -ne $stopSignalName) {
    throw "Persisted helper metadata does not match this test run."
  }

  $reportedProcessId = [int]$metadata.processId
  $reportedCreationTimeUtcTicks = [long]$metadata.processCreationTimeUtcTicks
  $expectedExecutablePath = [System.IO.Path]::GetFullPath([string]$metadata.executablePath)
  $expectedProfileDirectory = [System.IO.Path]::GetFullPath([string]$metadata.profileDirectory)

  if (-not [string]::Equals($expectedProfileDirectory, [System.IO.Path]::GetFullPath($profileDirectory), [StringComparison]::OrdinalIgnoreCase) -or
      [System.IO.File]::ReadAllText((Join-Path $expectedProfileDirectory "recovery.marker")) -ne $runId) {
    throw "The persisted run marker does not match the test profile directory."
  }

  $reopenedProcess = [System.Diagnostics.Process]::GetProcessById($reportedProcessId)
  $reopenedProcess.Refresh()
  if ($reopenedProcess.HasExited -or
      $reopenedProcess.StartTime.ToUniversalTime().Ticks -ne [long]$metadata.processCreationTimeUtcTicks -or
      -not [string]::Equals(
        [System.IO.Path]::GetFullPath($reopenedProcess.MainModule.FileName),
        $expectedExecutablePath,
        [StringComparison]::OrdinalIgnoreCase
      )) {
    throw "The verified helper exited or changed identity before reattachment."
  }
  $identityVerified = $true

  $stopSignal = [System.Threading.EventWaitHandle]::OpenExisting($stopSignalName)
  $null = $stopSignal.Set()
  if (-not $reopenedProcess.WaitForExit(5000)) {
    throw "The reattached process did not confirm exit before the timeout."
  }
  if ([System.IO.File]::ReadAllText((Join-Path $expectedProfileDirectory "stop.ack")) -ne $runId) {
    throw "The helper exited without writing the expected cooperative stop acknowledgement."
  }
  $helperExited = $true

  Write-Host "PASS: the second controller reopened the process and matched PID, creation time, executable path, and profile marker."
  Write-Host "PASS: the controller signaled a run-id-scoped event and observed the helper's acknowledged exit."
  Write-Host "No forceful process termination was used."
}
catch {
  $runExitCode = 1
  Write-Error $_
}
finally {
  if ($identityVerified -and $null -ne $reopenedProcess -and -not $helperExited) {
    try {
      $reopenedProcess.Refresh()
      if (-not $reopenedProcess.HasExited) {
        if ($null -eq $stopSignal) {
          $stopSignal = [System.Threading.EventWaitHandle]::OpenExisting($stopSignalName)
          $null = $stopSignal.Set()
        }
        $helperExited = $reopenedProcess.WaitForExit(5000)
      }
    }
    catch {
      Write-Warning "The test helper did not confirm cooperative cleanup; it will self-expire within 20 seconds."
    }
  }

  if ($null -ne $stopSignal) {
    $stopSignal.Dispose()
  }

  if ($null -ne $runRoot -and [System.IO.Directory]::Exists($runRoot)) {
    $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd("\") + "\"
    $resolvedRunRoot = [System.IO.Path]::GetFullPath($runRoot)
    $expectedLeafPrefix = "antidetect-process-recovery-"
    if (-not $resolvedRunRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Split-Path -Leaf $resolvedRunRoot).StartsWith($expectedLeafPrefix, [StringComparison]::Ordinal)) {
      throw "Refusing to remove a test path outside its unique temporary directory."
    }

    if ($helperExited -or $runExitCode -eq 0) {
      Remove-Item -LiteralPath $resolvedRunRoot -Recurse -Force
    }
    else {
      Write-Warning "Temporary test data retained at $resolvedRunRoot because helper exit was not confirmed."
    }
  }
}

exit $runExitCode
