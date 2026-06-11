param()

$tcp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    Protocol = "TCP"
    LocalAddress = $_.LocalAddress
    LocalPort = $_.LocalPort
    PID = $_.OwningProcess
  }
}

$udp = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object {
  [pscustomobject]@{
    Protocol = "UDP"
    LocalAddress = $_.LocalAddress
    LocalPort = $_.LocalPort
    PID = $_.OwningProcess
  }
}

function Get-BindingType($address) {
  if ($address -in @("127.0.0.1", "::1")) { return "Loopback" }
  if ($address -in @("0.0.0.0", "::")) { return "Wildcard" }
  if ($address -match "^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)") { return "LAN" }
  if ($address) { return "Public" }
  return "Unknown"
}

function Get-Risk($row) {
  $bindingType = Get-BindingType $row.LocalAddress
  if ($row.LocalPort -eq 12864 -and $bindingType -ne "Loopback") { return "Critical" }
  if ($row.Protocol -eq "UDP" -and $row.LocalPort -eq 12345 -and $bindingType -eq "Wildcard") { return "High" }
  if ($row.Protocol -eq "TCP" -and $row.LocalPort -eq 30144 -and $bindingType -ne "Loopback") { return "High" }
  if ($bindingType -eq "Wildcard") { return "Medium" }
  return "Low"
}

($tcp + $udp) |
  Sort-Object Protocol, LocalPort, LocalAddress |
  ForEach-Object {
    $processName = (Get-Process -Id $_.PID -ErrorAction SilentlyContinue).ProcessName
    [pscustomobject]@{
      Protocol = $_.Protocol
      LocalAddress = $_.LocalAddress
      LocalPort = $_.LocalPort
      PID = $_.PID
      ProcessName = $processName
      BindingType = Get-BindingType $_.LocalAddress
      Risk = Get-Risk $_
    }
  }
