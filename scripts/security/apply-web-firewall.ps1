[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [string[]]$AllowedAdminRemoteAddresses = @(),
  [switch]$AllowHttp80
)

$backupDir = Join-Path $PSScriptRoot "backups"
if (-not (Test-Path $backupDir)) {
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupPath = Join-Path $backupDir "firewall-$timestamp.wfw"
Write-Host "Exporting firewall policy backup to $backupPath"
netsh advfirewall export "$backupPath" | Out-Null

$rules = @(
  @{ Name = "BZSS Panel Block 12864"; Direction = "Inbound"; Action = "Block"; Protocol = "TCP"; LocalPort = "12864" },
  @{ Name = "BZSS Panel Allow 443"; Direction = "Inbound"; Action = "Allow"; Protocol = "TCP"; LocalPort = "443"; RemoteAddress = ($AllowedAdminRemoteAddresses -join ",") },
  @{ Name = "BZSS Panel Allow 80"; Direction = "Inbound"; Action = "Allow"; Protocol = "TCP"; LocalPort = "80" }
)

foreach ($rule in $rules) {
  if ($rule.LocalPort -eq "80" -and -not $AllowHttp80.IsPresent) {
    continue
  }

  $existing = Get-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
  if ($existing) {
    Write-Host "Removing existing rule $($rule.Name)"
    if ($PSCmdlet.ShouldProcess($rule.Name, "Remove existing firewall rule")) {
      $existing | Remove-NetFirewallRule
    }
  }

  $params = @{
    DisplayName = $rule.Name
    Direction = $rule.Direction
    Action = $rule.Action
    Protocol = $rule.Protocol
    LocalPort = $rule.LocalPort
  }
  if ($rule.RemoteAddress) {
    $params.RemoteAddress = $rule.RemoteAddress
  }

  Write-Host "Applying rule $($rule.Name)"
  if ($PSCmdlet.ShouldProcess($rule.Name, "Create firewall rule")) {
    New-NetFirewallRule @params | Out-Null
  }
}
