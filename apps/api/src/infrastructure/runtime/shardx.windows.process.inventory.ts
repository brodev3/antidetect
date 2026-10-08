import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { win32 } from "node:path";
import type {
  ShardXCdpListenerObservation,
  ShardXProcessInventory,
  ShardXProcessObservation,
} from "./shardx.process.identity.ts";

const execFileAsync = promisify(execFile);
const processScanFailureCode = "RUNTIME_PROCESS_SCAN_UNAVAILABLE" as const;
const powerShellTimeoutMs = 15_000;
const powerShellMaxBufferBytes = 2 * 1024 * 1024;

export type PendingLauncherState = ShardXProcessInventory["pendingLauncher"];

export interface ShardXWindowsProcessInventoryRequest {
  readonly executablePath: string;
  readonly profileDirectory: string;
  /** Must be established by the runtime adapter; this scanner cannot infer it. */
  readonly pendingLauncher: PendingLauncherState;
}

export type ShardXWindowsProcessInventoryResult =
  | { readonly status: "available"; readonly inventory: ShardXProcessInventory }
  | {
      readonly status: "unavailable";
      readonly failureCode: typeof processScanFailureCode;
    };

export type PowerShellScriptExecutor = (script: string) => Promise<string>;

function unavailable(): ShardXWindowsProcessInventoryResult {
  return { status: "unavailable", failureCode: processScanFailureCode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullablePort(value: unknown): value is number | null {
  return (
    value === null ||
    (Number.isSafeInteger(value) &&
      (value as number) >= 1 &&
      (value as number) <= 65535)
  );
}

function parseProcess(value: unknown): ShardXProcessObservation | null {
  if (!isRecord(value)) return null;
  if (
    !Number.isSafeInteger(value.pid) ||
    !Number.isSafeInteger(value.parentPid) ||
    !isNullableString(value.executablePath) ||
    !isNullableString(value.profileDirectory) ||
    !isNullableString(value.createdAt)
  ) {
    return null;
  }

  return {
    pid: value.pid as number,
    parentPid: value.parentPid as number,
    executablePath: value.executablePath,
    profileDirectory: value.profileDirectory,
    createdAt: value.createdAt,
  };
}

function parseListener(value: unknown): ShardXCdpListenerObservation | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.localAddress !== "string" ||
    !Number.isSafeInteger(value.localPort) ||
    !Number.isSafeInteger(value.ownerPid)
  ) {
    return null;
  }

  return {
    localAddress: value.localAddress,
    localPort: value.localPort as number,
    ownerPid: value.ownerPid as number,
  };
}

export function parseShardXWindowsProcessSnapshot(
  output: string,
  pendingLauncher: PendingLauncherState,
): ShardXWindowsProcessInventoryResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return unavailable();
  }

  if (
    !isRecord(parsed) ||
    parsed.processScanComplete !== true ||
    !Array.isArray(parsed.processes) ||
    !Number.isSafeInteger(parsed.unattributedPotentialProcessCount) ||
    (parsed.unattributedPotentialProcessCount as number) < 0 ||
    !isNullablePort(parsed.cdpPort) ||
    !(parsed.cdpListeners === null || Array.isArray(parsed.cdpListeners))
  ) {
    return unavailable();
  }

  const processes = parsed.processes.map(parseProcess);
  if (processes.some((process) => process === null)) return unavailable();

  const cdpListeners = Array.isArray(parsed.cdpListeners)
    ? parsed.cdpListeners.map(parseListener)
    : null;
  if (cdpListeners?.some((listener) => listener === null)) return unavailable();

  return {
    status: "available",
    inventory: {
      processScanComplete: true,
      processes: processes as ShardXProcessObservation[],
      unattributedPotentialProcessCount:
        parsed.unattributedPotentialProcessCount as number,
      pendingLauncher,
      cdpPort: parsed.cdpPort,
      cdpListeners: cdpListeners as ShardXCdpListenerObservation[] | null,
    },
  };
}

function createPowerShellScript(request: ShardXWindowsProcessInventoryRequest): string {
  const payload = Buffer.from(
    JSON.stringify({
      executablePath: request.executablePath,
      profileDirectory: request.profileDirectory,
    }),
    "utf8",
  ).toString("base64");

  return `
$ErrorActionPreference = 'Stop'
$WarningPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

function Get-NormalizedPath {
  param([AllowNull()][string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value) -or -not [System.IO.Path]::IsPathRooted($Value)) {
    return $null
  }
  try {
    return [System.IO.Path]::GetFullPath($Value).TrimEnd([char[]]@('\\', '/'))
  }
  catch {
    return $null
  }
}

function Get-ProfileDirectory {
  param([AllowNull()][string]$CommandLine)
  if ([string]::IsNullOrWhiteSpace($CommandLine)) {
    return [pscustomobject]@{ Found = $false; Ambiguous = $false; Path = $null }
  }
  $pattern = '(?:^|\\s)--user-data-dir(?:=|\\s+)(?:"(?<quoted>[^"]+)"|(?<plain>[^\\s"]+))'
  $matches = [System.Text.RegularExpressions.Regex]::Matches(
    $CommandLine,
    $pattern,
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
  )
  $hasSwitch = [System.Text.RegularExpressions.Regex]::IsMatch(
    $CommandLine,
    '(?i)(?:^|\\s)--user-data-dir(?:=|\\s|$)'
  )
  if ($matches.Count -ne 1) {
    return [pscustomobject]@{ Found = $false; Ambiguous = $hasSwitch; Path = $null }
  }
  $value = if ($matches[0].Groups['quoted'].Success) {
    $matches[0].Groups['quoted'].Value
  }
  else {
    $matches[0].Groups['plain'].Value
  }
  $normalized = Get-NormalizedPath -Value $value
  if ($null -eq $normalized) {
    return [pscustomobject]@{ Found = $false; Ambiguous = $true; Path = $null }
  }
  return [pscustomobject]@{ Found = $true; Ambiguous = $false; Path = $normalized }
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
    return $createdAt.ToUniversalTime().ToString('o', [System.Globalization.CultureInfo]::InvariantCulture)
  }
  catch {
    return $null
  }
}

try {
  $payloadJson = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${payload}'))
  $request = $payloadJson | ConvertFrom-Json -ErrorAction Stop
  $expectedExecutable = Get-NormalizedPath -Value ([string]$request.executablePath)
  $expectedProfile = Get-NormalizedPath -Value ([string]$request.profileDirectory)
  if ($null -eq $expectedExecutable -or $null -eq $expectedProfile) {
    throw 'Invalid process scan target'
  }

  $processes = [System.Collections.Generic.List[object]]::new()
  $unattributedPotentialProcessCount = 0
  $chromeProcesses = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction Stop)
  foreach ($process in $chromeProcesses) {
    $commandLine = [string]$process.CommandLine
    $executablePath = Get-NormalizedPath -Value ([string]$process.ExecutablePath)
    $isExpectedExecutable = (
      $null -ne $executablePath -and
      [string]::Equals($executablePath, $expectedExecutable, [System.StringComparison]::OrdinalIgnoreCase)
    )
    if ([string]::IsNullOrWhiteSpace($commandLine)) {
      $unattributedPotentialProcessCount++
      continue
    }

    $profile = Get-ProfileDirectory -CommandLine $commandLine
    if (-not $profile.Found) {
      if ($isExpectedExecutable -or $profile.Ambiguous -or $null -eq $executablePath) {
        $unattributedPotentialProcessCount++
      }
      continue
    }

    $pidValue = 0
    $parentPidValue = 0
    if (
      -not [int]::TryParse([string]$process.ProcessId, [ref]$pidValue) -or
      -not [int]::TryParse([string]$process.ParentProcessId, [ref]$parentPidValue)
    ) {
      $pidValue = 0
      $parentPidValue = 0
    }
    $processes.Add([pscustomobject]@{
      pid = $pidValue
      parentPid = $parentPidValue
      executablePath = $executablePath
      profileDirectory = $profile.Path
      createdAt = Get-CreationTimeUtc -Process $process
    })
  }

  $cdpPort = $null
  $cdpListeners = $null
  $activePortPath = Join-Path $expectedProfile 'DevToolsActivePort'
  if ([System.IO.File]::Exists($activePortPath)) {
    try {
      $activePortLines = [System.IO.File]::ReadAllLines($activePortPath)
      $portValue = 0
      $validActivePort = (
        $activePortLines.Count -ge 2 -and
        [int]::TryParse([string]$activePortLines[0], [ref]$portValue) -and
        $portValue -ge 1 -and $portValue -le 65535 -and
        [string]$activePortLines[1] -match '^/devtools/browser/[^/\\s]+$'
      )
      if ($validActivePort) {
        $cdpPort = $portValue
        $listenerRows = [System.Collections.Generic.List[object]]::new()
        foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort $portValue -ErrorAction Stop)) {
          $ownerPid = 0
          if (-not [int]::TryParse([string]$listener.OwningProcess, [ref]$ownerPid)) {
            $ownerPid = 0
          }
          $listenerRows.Add([pscustomobject]@{
            localAddress = [string]$listener.LocalAddress
            localPort = [int]$listener.LocalPort
            ownerPid = $ownerPid
          })
        }
        $cdpListeners = $listenerRows.ToArray()
      }
    }
    catch {
      $cdpListeners = $null
    }
  }

  $result = [pscustomobject]@{
    processScanComplete = $true
    processes = $processes.ToArray()
    unattributedPotentialProcessCount = $unattributedPotentialProcessCount
    cdpPort = $cdpPort
    cdpListeners = $cdpListeners
  }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
}
catch {
  $result = [pscustomobject]@{
    processScanComplete = $false
    processes = @()
    unattributedPotentialProcessCount = 0
    cdpPort = $null
    cdpListeners = $null
  }
  [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 5 -Compress))
}
`;
}

async function executePowerShellScript(script: string): Promise<string> {
  if (process.platform !== "win32") throw new Error("Windows is required");
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedScript],
    {
      encoding: "utf8",
      maxBuffer: powerShellMaxBufferBytes,
      timeout: powerShellTimeoutMs,
      windowsHide: true,
    },
  );
  return stdout;
}

export async function readShardXWindowsProcessInventory(
  request: ShardXWindowsProcessInventoryRequest,
  execute: PowerShellScriptExecutor = executePowerShellScript,
): Promise<ShardXWindowsProcessInventoryResult> {
  if (
    !win32.isAbsolute(request.executablePath) ||
    !win32.isAbsolute(request.profileDirectory)
  ) {
    return unavailable();
  }

  try {
    const output = await execute(createPowerShellScript(request));
    return parseShardXWindowsProcessSnapshot(output, request.pendingLauncher);
  } catch {
    return unavailable();
  }
}
