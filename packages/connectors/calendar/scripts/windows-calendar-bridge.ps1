$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { throw 'Empty calendar bridge request' }
$req = $raw | ConvertFrom-Json

[Windows.ApplicationModel.Appointments.AppointmentManager, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
[Windows.ApplicationModel.Appointments.AppointmentStore, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
[Windows.ApplicationModel.Appointments.AppointmentCalendar, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
[Windows.ApplicationModel.Appointments.Appointment, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
[Windows.ApplicationModel.Appointments.FindAppointmentsOptions, Windows.ApplicationModel.Appointments, ContentType=WindowsRuntime] | Out-Null
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asAction = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]

function AwaitOp($op, [Type]$type) {
  return $asTask.MakeGenericMethod($type).Invoke($null, @($op)).GetAwaiter().GetResult()
}
function AwaitAct($op) {
  $null = $asAction.Invoke($null, @($op)).GetAwaiter().GetResult()
}

function Get-RoStore {
  return AwaitOp ([Windows.ApplicationModel.Appointments.AppointmentManager]::RequestStoreAsync([Windows.ApplicationModel.Appointments.AppointmentStoreAccessType]::AllCalendarsReadOnly)) ([Windows.ApplicationModel.Appointments.AppointmentStore])
}

function Get-AppRwStore {
  return AwaitOp ([Windows.ApplicationModel.Appointments.AppointmentManager]::RequestStoreAsync([Windows.ApplicationModel.Appointments.AppointmentStoreAccessType]::AllCalendarsReadWrite)) ([Windows.ApplicationModel.Appointments.AppointmentStore])
}

function Get-AllCalendars($store) {
  return AwaitOp ($store.FindAppointmentCalendarsAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.AppointmentCalendar]])
}

function Project-Appointment($appt, [bool]$canWrite) {
  $start = $appt.StartTime.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $end = $appt.StartTime.Add($appt.Duration).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $invCount = 0
  if ($null -ne $appt.Invitees) { $invCount = [int]$appt.Invitees.Count }
  return [ordered]@{
    localId = [string]$appt.LocalId
    roamingId = if ($appt.RoamingId) { [string]$appt.RoamingId } else { $null }
    calendarId = [string]$appt.CalendarId
    subject = [string]$appt.Subject
    startUtc = $start
    endUtc = $end
    location = if ($appt.Location) { [string]$appt.Location } else { $null }
    details = if ($appt.Details) { [string]$appt.Details } else { $null }
    changeNumber = [long]$appt.ChangeNumber
    cancelled = [bool]$appt.IsCanceledMeeting
    organizer = if ($appt.Organizer -and $appt.Organizer.Address) { [string]$appt.Organizer.Address } else { $null }
    inviteeCount = $invCount
    canWrite = $canWrite
  }
}

function New-FindOptions {
  $opts = New-Object Windows.ApplicationModel.Appointments.FindAppointmentsOptions
  $opts.IncludeHidden = $false
  $opts.MaxCount = 500
  return $opts
}

function Ensure-WritableCalendar($rwStore, [string]$name) {
  $existing = Get-AllCalendars $rwStore
  foreach ($c in $existing) {
    if ($c.DisplayName -eq $name) { return $c }
  }
  $created = AwaitOp ($rwStore.CreateAppointmentCalendarAsync($name)) ([Windows.ApplicationModel.Appointments.AppointmentCalendar])
  $created.OtherAppWriteAccess = [Windows.ApplicationModel.Appointments.AppointmentCalendarOtherAppWriteAccess]::Limited
  AwaitAct ($created.SaveAsync())
  return $created
}

function Is-WritableTargetCal($cal, [string]$calName) {
  if ($cal.DisplayName -eq $calName) { return $true }
  if ($cal.CanCreateOrUpdateAppointments) { return $true }
  return $false
}

function Find-RoByUid($roStore, [string]$uid) {
  try {
    $direct = AwaitOp ($roStore.GetAppointmentAsync($uid)) ([Windows.ApplicationModel.Appointments.Appointment])
    if ($null -ne $direct) { return $direct }
  } catch {}
  $opts = New-FindOptions
  $appts = AwaitOp ($roStore.FindAppointmentsAsync([DateTimeOffset]::UtcNow.AddYears(-10), [TimeSpan]::FromDays(7300), $opts)) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.Appointment]])
  foreach ($a in $appts) {
    if ($a.LocalId -eq $uid -or ($a.RoamingId -and $a.RoamingId -eq $uid)) { return $a }
  }
  return $null
}

function Find-ByUidInCalendar($cal, [string]$uid) {
  try {
    $direct = AwaitOp ($cal.GetAppointmentAsync($uid)) ([Windows.ApplicationModel.Appointments.Appointment])
    if ($null -ne $direct) { return $direct }
  } catch {}
  $opts = New-FindOptions
  $list = AwaitOp ($cal.FindAppointmentsAsync([DateTimeOffset]::UtcNow.AddYears(-10), [TimeSpan]::FromDays(7300), $opts)) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.Appointment]])
  foreach ($a in $list) {
    if ($a.LocalId -eq $uid -or ($a.RoamingId -and $a.RoamingId -eq $uid)) { return $a }
  }
  return $null
}

function Write-Result($obj) {
  Write-Output ($obj | ConvertTo-Json -Depth 6 -Compress)
}

switch ($req.op) {
  'listCalendars' {
    $ro = Get-RoStore
    $cals = Get-AllCalendars $ro
    $out = @()
    foreach ($c in $cals) {
      $out += [ordered]@{
        id = [string]$c.LocalId
        name = [string]$c.DisplayName
        canWrite = [bool]$c.CanCreateOrUpdateAppointments
      }
    }
    Write-Result @{ calendars = $out }
    break
  }
  'fetchWindow' {
    $ro = Get-RoStore
    $rw = Get-AppRwStore
    $writableIds = @{}
    foreach ($wc in (Get-AllCalendars $rw)) { $writableIds[[string]$wc.LocalId] = [bool]$wc.CanCreateOrUpdateAppointments }
    foreach ($rc in (Get-AllCalendars $ro)) { if ($rc.CanCreateOrUpdateAppointments) { $writableIds[[string]$rc.LocalId] = $true } }
    $fromDto = [DateTimeOffset]::Parse($req.fromUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    $toDto = [DateTimeOffset]::Parse($req.toUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    $span = $toDto - $fromDto
    if ($span.TotalMilliseconds -le 0) { Write-Result @{ events = @() }; break }
    $opts = New-FindOptions
    $appts = AwaitOp ($ro.FindAppointmentsAsync($fromDto, $span, $opts)) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.Appointment]])
    $out = @()
    foreach ($a in $appts) {
      $full = $a
      try {
        $hydrated = AwaitOp ($ro.GetAppointmentAsync([string]$a.LocalId)) ([Windows.ApplicationModel.Appointments.Appointment])
        if ($null -ne $hydrated) { $full = $hydrated }
      } catch {}
      $canW = [bool]($writableIds[[string]$full.CalendarId])
      $out += Project-Appointment $full $canW
    }
    Write-Result @{ events = $out }
    break
  }
  'getEvent' {
    $ro = Get-RoStore
    $rw = Get-AppRwStore
    $writableIds = @{}
    foreach ($wc in (Get-AllCalendars $rw)) { $writableIds[[string]$wc.LocalId] = [bool]$wc.CanCreateOrUpdateAppointments }
    foreach ($rc in (Get-AllCalendars $ro)) { if ($rc.CanCreateOrUpdateAppointments) { $writableIds[[string]$rc.LocalId] = $true } }
    $found = $null
    try { $found = AwaitOp ($ro.GetAppointmentAsync([string]$req.externalId)) ([Windows.ApplicationModel.Appointments.Appointment]) } catch {}
    if ($null -eq $found) {
      $opts = New-FindOptions
      $appts = AwaitOp ($ro.FindAppointmentsAsync([DateTimeOffset]::UtcNow.AddYears(-10), [TimeSpan]::FromDays(7300), $opts)) ([System.Collections.Generic.IReadOnlyList[Windows.ApplicationModel.Appointments.Appointment]])
      foreach ($a in $appts) {
        if ($a.LocalId -eq $req.externalId -or ($a.RoamingId -and $a.RoamingId -eq $req.externalId)) { $found = $a; break }
      }
    }
    if ($null -eq $found) { Write-Result @{ event = $null }; break }
    $canW = [bool]($writableIds[[string]$found.CalendarId])
    Write-Result @{ event = (Project-Appointment $found $canW) }
    break
  }
  'createEvent' {
    $rw = Get-AppRwStore
    $calName = if ($req.targetCalendarName) { [string]$req.targetCalendarName } else { 'PersonalAgent' }
    $cal = Ensure-WritableCalendar $rw $calName
    if ($req.uid) {
      $existing = Find-ByUidInCalendar $cal ([string]$req.uid)
      if ($null -ne $existing) {
        Write-Result @{ conflictCheck = $true; event = (Project-Appointment $existing $true) }
        break
      }
    }
    $appt = New-Object Windows.ApplicationModel.Appointments.Appointment
    $appt.Subject = [string]$req.summary
    $startDto = [DateTimeOffset]::Parse($req.startUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    $endDto = [DateTimeOffset]::Parse($req.endUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    $appt.StartTime = $startDto
    $appt.Duration = $endDto - $startDto
    if ($req.location) { $appt.Location = [string]$req.location }
    if ($req.notes) { $appt.Details = [string]$req.notes }
    if ($req.uid) { $appt.RoamingId = [string]$req.uid }
    AwaitAct ($cal.SaveAppointmentAsync($appt))
    $readback = AwaitOp ($cal.GetAppointmentAsync([string]$appt.LocalId)) ([Windows.ApplicationModel.Appointments.Appointment])
    if ($null -eq $readback) { throw 'EVENT_READBACK_MISSING' }
    Write-Result @{ event = (Project-Appointment $readback $true) }
    break
  }
  'updateEvent' {
    $rw = Get-AppRwStore
    $ro = Get-RoStore
    $calName = if ($req.targetCalendarName) { [string]$req.targetCalendarName } else { 'PersonalAgent' }
    $foundCal = $null
    $appt = $null
    foreach ($c in (Get-AllCalendars $rw)) {
      if (-not (Is-WritableTargetCal $c $calName)) { continue }
      $candidate = Find-ByUidInCalendar $c ([string]$req.uid)
      if ($null -ne $candidate) { $foundCal = $c; $appt = $candidate; break }
    }
    if ($null -eq $appt) {
      $roFound = Find-RoByUid $ro ([string]$req.uid)
      if ($null -ne $roFound) { throw 'READ_ONLY_SYSTEM_CALENDAR' }
      throw 'EVENT_NOT_FOUND'
    }
    $currentSeq = [long]$appt.ChangeNumber
    if ($null -ne $req.expectedSequence -and [long]$req.expectedSequence -ne $currentSeq) {
      throw "SEQUENCE_MISMATCH:$currentSeq"
    }
    if ($null -ne $req.ifMatch -and [string]$req.ifMatch -ne ('"win-seq-' + $currentSeq + '"')) {
      throw "ETAG_MISMATCH:$currentSeq"
    }
    if ($null -ne $req.summary) { $appt.Subject = [string]$req.summary }
    $curStart = $appt.StartTime
    $curEnd = $appt.StartTime.Add($appt.Duration)
    if ($null -ne $req.startUtc) {
      $curStart = [DateTimeOffset]::Parse($req.startUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    }
    if ($null -ne $req.endUtc) {
      $curEnd = [DateTimeOffset]::Parse($req.endUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AssumeUniversal)
    }
    if ($curEnd -le $curStart) { throw 'INVALID_WINDOW' }
    $appt.StartTime = $curStart
    $appt.Duration = $curEnd - $curStart
    if ($null -ne $req.location) { $appt.Location = [string]$req.location }
    if ($null -ne $req.notes) { $appt.Details = [string]$req.notes }
    AwaitAct ($foundCal.SaveAppointmentAsync($appt))
    try {
      $readback = AwaitOp ($foundCal.GetAppointmentAsync([string]$appt.LocalId)) ([Windows.ApplicationModel.Appointments.Appointment])
      if ($null -eq $readback) { throw 'EVENT_READBACK_MISSING' }
      $event = Project-Appointment $readback $true
    } catch { throw 'UPDATE_READBACK_UNKNOWN' }
    Write-Result @{ event = $event }
    break
  }
  'cancelEvent' {
    $rw = Get-AppRwStore
    $ro = Get-RoStore
    $calName = if ($req.targetCalendarName) { [string]$req.targetCalendarName } else { 'PersonalAgent' }
    $foundCal = $null
    $appt = $null
    foreach ($c in (Get-AllCalendars $rw)) {
      if (-not (Is-WritableTargetCal $c $calName)) { continue }
      $candidate = Find-ByUidInCalendar $c ([string]$req.uid)
      if ($null -ne $candidate) { $foundCal = $c; $appt = $candidate; break }
    }
    if ($null -eq $appt) {
      $roFound = Find-RoByUid $ro ([string]$req.uid)
      if ($null -ne $roFound) { throw 'READ_ONLY_SYSTEM_CALENDAR' }
      Write-Result @{ state = 'already_absent' }
      break
    }
    AwaitAct ($foundCal.DeleteAppointmentAsync([string]$appt.LocalId))
    $check = $null
    try { $check = AwaitOp ($foundCal.GetAppointmentAsync([string]$appt.LocalId)) ([Windows.ApplicationModel.Appointments.Appointment]) } catch {}
    if ($null -ne $check) { throw 'DELETE_READBACK_STILL_PRESENT' }
    Write-Result @{ state = 'cancelled' }
    break
  }
  default {
    throw "UNKNOWN_OP:$($req.op)"
  }
}
