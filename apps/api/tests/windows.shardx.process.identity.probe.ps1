[CmdletBinding()]
param(
  [string]$SdkAuditRoot = (Join-Path $env:TEMP "shardx-sdk-2.0.3-audit")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-NormalizedPath {
  param([Parameter(Mandatory)][string]$Value)

  return [System.IO.Path]::GetFullPath($Value).TrimEnd([char[]]@("\", "/"))
}

function Get-UserDataDirectory {
  param([AllowNull()][string]$CommandLine)

  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return $null
  }

  $match = [System.Text.RegularExpressions.Regex]::Match(
    $CommandLine,
    '(?:^|\s)--user-data-dir(?:=|\s+)(?:"(?<quoted>[^"]+)"|(?<plain>[^\s"]+))',
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  if (-not $match.Success) {
    return $null
  }

  $value = if ($match.Groups["quoted"].Success) {
    $match.Groups["quoted"].Value
  }
  else {
    $match.Groups["plain"].Value
  }

  try {
    return Get-NormalizedPath -Value $value
  }
  catch {
    return $null
  }
}

function Get-CreationTimeUtc {
  param([Parameter(Mandatory)]$Process)

  try {
    $createdAt = if ($Process.CreationDate -is [datetime]) {
      $Process.CreationDate
    }
    else {
      [System.Management.ManagementDateTimeConverter]::ToDateTime([string]$Process.CreationDate)
    }

    return $createdAt.ToUniversalTime().ToString("o")
  }
  catch {
    return "UNAVAILABLE"
  }
}

function Get-CdpOwnerAssociation {
  param([Parameter(Mandatory)][object[]]$ProfileProcesses)

  $profileDirectory = [string]$ProfileProcesses[0].ProfileDirectory
  $activePortFile = Join-Path $profileDirectory "DevToolsActivePort"
  if (-not [System.IO.File]::Exists($activePortFile)) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "ACTIVE_PORT_FILE_MISSING"
      OwnerProcessId = $null
      TreeProcessCount = 0
    }
  }

  try {
    $activePortLines = [System.IO.File]::ReadAllLines($activePortFile)
  }
  catch {
    return [pscustomobject]@{
      Verified = $false
      Reason = "ACTIVE_PORT_FILE_UNREADABLE"
      OwnerProcessId = $null
      TreeProcessCount = 0
    }
  }

  $cdpPort = 0
  $hasValidPort = (
    $activePortLines.Count -ge 2 -and
    [int]::TryParse(
      $activePortLines[0].Trim(),
      [System.Globalization.NumberStyles]::None,
      [System.Globalization.CultureInfo]::InvariantCulture,
      [ref]$cdpPort
    ) -and
    $cdpPort -ge 1 -and
    $cdpPort -le 65535
  )
  $hasValidBrowserPath = (
    $activePortLines.Count -ge 2 -and
    $activePortLines[1].Trim() -match '^/devtools/browser/[^/\s]+$'
  )
  if (-not $hasValidPort -or -not $hasValidBrowserPath) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "ACTIVE_PORT_FILE_INVALID"
      OwnerProcessId = $null
      TreeProcessCount = 0
    }
  }

  $profileProcessIds = @($ProfileProcesses | ForEach-Object { [int]$_.ProcessId })
  $rootProcesses = @(
    $ProfileProcesses | Where-Object {
      $profileProcessIds -notcontains [int]$_.ParentProcessId
    }
  )
  if ($rootProcesses.Count -ne 1) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "PROFILE_PROCESS_TREE_ROOT_NOT_UNIQUE"
      OwnerProcessId = $null
      TreeProcessCount = 0
    }
  }

  $treeProcessIds = [System.Collections.Generic.HashSet[int]]::new()
  $pendingProcessIds = [System.Collections.Generic.Queue[int]]::new()
  $pendingProcessIds.Enqueue([int]$rootProcesses[0].ProcessId)
  while ($pendingProcessIds.Count -gt 0) {
    $parentProcessId = $pendingProcessIds.Dequeue()
    if (-not $treeProcessIds.Add($parentProcessId)) {
      continue
    }

    foreach ($child in $ProfileProcesses) {
      if ([int]$child.ParentProcessId -eq $parentProcessId) {
        $pendingProcessIds.Enqueue([int]$child.ProcessId)
      }
    }
  }

  if ($treeProcessIds.Count -ne $ProfileProcesses.Count) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "PROFILE_PROCESS_TREE_INCOMPLETE"
      OwnerProcessId = $null
      TreeProcessCount = $treeProcessIds.Count
    }
  }

  try {
    $listeners = @(
      Get-NetTCPConnection -State Listen -LocalPort $cdpPort -ErrorAction Stop
    )
  }
  catch {
    return [pscustomobject]@{
      Verified = $false
      Reason = "LISTENER_QUERY_FAILED"
      OwnerProcessId = $null
      TreeProcessCount = $treeProcessIds.Count
    }
  }

  if ($listeners.Count -eq 0) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "CDP_LISTENER_NOT_FOUND"
      OwnerProcessId = $null
      TreeProcessCount = $treeProcessIds.Count
    }
  }

  foreach ($listener in $listeners) {
    try {
      $listenerAddress = [System.Net.IPAddress]::Parse([string]$listener.LocalAddress)
      if (-not [System.Net.IPAddress]::IsLoopback($listenerAddress)) {
        return [pscustomobject]@{
          Verified = $false
          Reason = "CDP_LISTENER_NOT_LOOPBACK_ONLY"
          OwnerProcessId = $null
          TreeProcessCount = $treeProcessIds.Count
        }
      }
    }
    catch {
      return [pscustomobject]@{
        Verified = $false
        Reason = "CDP_LISTENER_ADDRESS_UNVERIFIED"
        OwnerProcessId = $null
        TreeProcessCount = $treeProcessIds.Count
      }
    }
  }

  $listenerOwnerIds = @(
    $listeners | ForEach-Object { [int]$_.OwningProcess } | Sort-Object -Unique
  )
  if ($listenerOwnerIds.Count -ne 1) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "CDP_LISTENER_OWNER_OUTSIDE_PROFILE_TREE"
      OwnerProcessId = $null
      TreeProcessCount = $treeProcessIds.Count
    }
  }

  $listenerOwnerProcessId = [int]$listenerOwnerIds[0]
  if (-not $treeProcessIds.Contains($listenerOwnerProcessId)) {
    return [pscustomobject]@{
      Verified = $false
      Reason = "CDP_LISTENER_OWNER_OUTSIDE_PROFILE_TREE"
      OwnerProcessId = $null
      TreeProcessCount = $treeProcessIds.Count
    }
  }

  return [pscustomobject]@{
    Verified = $true
    Reason = "CDP_OWNER_WITHIN_PROFILE_PROCESS_TREE"
    OwnerProcessId = $listenerOwnerProcessId
    TreeProcessCount = $treeProcessIds.Count
  }
}

if ($env:OS -ne "Windows_NT") {
  throw "This probe can only run on Windows."
}

$profilesRoot = Get-NormalizedPath -Value (Join-Path $SdkAuditRoot "profiles")
if (-not [System.IO.Directory]::Exists($profilesRoot)) {
  throw "The expected ShardX SDK profiles directory was not found: $profilesRoot"
}

$allProcesses = @(Get-CimInstance -ClassName Win32_Process -ErrorAction Stop)
$chromeProcesses = @($allProcesses | Where-Object { $_.Name -ieq "chrome.exe" })
$unavailableCommandLineCount = @(
  $chromeProcesses | Where-Object { [string]::IsNullOrWhiteSpace([string]$_.CommandLine) }
).Count
$processesById = @{}
foreach ($process in $allProcesses) {
  $processesById[[int]$process.ProcessId] = $process
}

$expectedExecutablePath = Get-NormalizedPath -Value (
  Join-Path $SdkAuditRoot "runtime-cache\ShardX-Windows\chrome.exe"
)
$profilesRootPrefix = $profilesRoot.TrimEnd([char[]]@("\", "/")) + "\"
$unassociatedExpectedExecutableCount = 0
$matchedProcesses = @(
  foreach ($process in $allProcesses) {
    if ($process.Name -ine "chrome.exe") {
      continue
    }

    $executablePath = [string]$process.ExecutablePath
    $isExpectedShardXExecutable = $false
    if (-not [string]::IsNullOrWhiteSpace($executablePath)) {
      try {
        $normalizedExecutablePath = Get-NormalizedPath -Value $executablePath
        $isExpectedShardXExecutable = [string]::Equals(
          $normalizedExecutablePath,
          $expectedExecutablePath,
          [System.StringComparison]::OrdinalIgnoreCase
        )
      }
      catch {
        $isExpectedShardXExecutable = $false
      }
    }

    $userDataDirectory = Get-UserDataDirectory -CommandLine ([string]$process.CommandLine)
    if ([string]::IsNullOrWhiteSpace($userDataDirectory)) {
      if ($isExpectedShardXExecutable) {
        $unassociatedExpectedExecutableCount++
      }
      continue
    }

    if (-not $userDataDirectory.StartsWith($profilesRootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
      if ($isExpectedShardXExecutable) {
        $unassociatedExpectedExecutableCount++
      }
      continue
    }

    [pscustomobject]@{
      ProfileDirectory = $userDataDirectory
      ProfileId = Split-Path -Leaf $userDataDirectory
      ProfileDirectoryExists = [System.IO.Directory]::Exists($userDataDirectory)
      ProcessId = [int]$process.ProcessId
      ParentProcessId = [int]$process.ParentProcessId
      ParentName = "UNAVAILABLE"
      ParentIsSmokeLauncher = $false
      CreatedAtUtc = Get-CreationTimeUtc -Process $process
      ExecutablePath = $executablePath
      IsExpectedShardXExecutable = $isExpectedShardXExecutable
    }
  }
)

Write-Host "ShardX process identity probe (read-only)"
Write-Host "Expected SDK profiles root: $profilesRoot"
Write-Host "Expected ShardX executable: $expectedExecutablePath"
Write-Host "Chrome processes inspected: $($chromeProcesses.Count)"
Write-Host "Chrome processes with unavailable command lines: $unavailableCommandLineCount"
Write-Host "Expected ShardX executables without a matched SDK profile path: $unassociatedExpectedExecutableCount"
Write-Host "Processes using a profile under this root: $($matchedProcesses.Count)"
Write-Host "Raw command lines and CDP addresses are not displayed. No network requests or process changes are made."

if ($matchedProcesses.Count -eq 0) {
  if ($unavailableCommandLineCount -gt 0 -or $unassociatedExpectedExecutableCount -gt 0) {
    Write-Host "RESULT: AMBIGUOUS_OR_INCOMPLETE_SHARDX_PROFILE_ASSOCIATION"
    Write-Host "At least one Chrome process could not be checked against an SDK profile path."
    exit 3
  }

  Write-Host "RESULT: NO_MATCHING_SHARDX_PROFILE_PROCESS"
  Write-Host "No matching profile process was observed in this snapshot; this does not prove API runId recovery."
  exit 2
}

foreach ($entry in $matchedProcesses) {
  $parent = $processesById[[int]$entry.ParentProcessId]
  if ($null -ne $parent) {
    $entry.ParentName = [string]$parent.Name
    $entry.ParentIsSmokeLauncher = (
      $parent.Name -ieq "node.exe" -and
      ([string]$parent.CommandLine -match "(?i)run-shardx-smoke\.mjs")
    )
  }
}

$profileGroups = @($matchedProcesses | Group-Object -Property ProfileDirectory)
foreach ($group in $profileGroups) {
  Write-Host ""
  Write-Host "Profile directory: $($group.Name)"
  Write-Host "Profile ID: $($group.Group[0].ProfileId)"
  Write-Host "Profile directory exists: $($group.Group[0].ProfileDirectoryExists)"
  Write-Host "Matching process count: $($group.Count)"
  $group.Group |
    Select-Object ProcessId, ParentProcessId, ParentName, ParentIsSmokeLauncher, CreatedAtUtc, IsExpectedShardXExecutable |
    Format-Table -AutoSize
}

$hasExpectedExecutables = @($matchedProcesses | Where-Object { $_.IsExpectedShardXExecutable }).Count -eq $matchedProcesses.Count
$hasMissingProfileDirectory = @($matchedProcesses | Where-Object { -not $_.ProfileDirectoryExists }).Count -gt 0
$hasUnavailableCreationTime = @($matchedProcesses | Where-Object { $_.CreatedAtUtc -eq "UNAVAILABLE" }).Count -gt 0
$hasSmokeLauncherParent = @($matchedProcesses | Where-Object { $_.ParentIsSmokeLauncher }).Count -gt 0

if ($profileGroups.Count -eq 1 -and
    $hasExpectedExecutables -and
    -not $hasMissingProfileDirectory -and
    -not $hasUnavailableCreationTime -and
    $unavailableCommandLineCount -eq 0 -and
    $unassociatedExpectedExecutableCount -eq 0) {
  $cdpAssociation = Get-CdpOwnerAssociation -ProfileProcesses @($profileGroups[0].Group)
  if (-not $cdpAssociation.Verified) {
    Write-Host "CDP listener owner could not be verified: $($cdpAssociation.Reason)"
    Write-Host "CDP endpoint, host, and port are not displayed. No network requests or browser commands are made."
    Write-Host "RESULT: UNKNOWN_CDP_OWNER_NOT_VERIFIED"
    exit 4
  }

  Write-Host "CDP listener owner PID: $($cdpAssociation.OwnerProcessId)"
  Write-Host "Verified ShardX profile process-tree count: $($cdpAssociation.TreeProcessCount)"
  Write-Host "CDP endpoint, host, and port are not displayed. No network requests or browser commands are made."
  Write-Host "RESULT: PASS_SHARDX_PROFILE_AND_CDP_OWNER_ASSOCIATION"
  Write-Host "Smoke launcher parent observed: $hasSmokeLauncherParent"
  Write-Host "This associates the CDP listener with the observed ShardX profile process tree; it does not prove API runId recovery."
  exit 0
}

Write-Host "RESULT: AMBIGUOUS_OR_INCOMPLETE_SHARDX_PROFILE_ASSOCIATION"
Write-Host "Required process metadata was missing or did not match exactly. No process was stopped. Review the profile IDs and executable-match column before drawing a conclusion."
exit 3
