# Live PowerPoint for ServiceEx on Windows: plays private copies of presentations (never the operator's
# originals) as slide shows over the output display, through desktop PowerPoint's COM interface.
# NOT YET TESTED ON WINDOWS. Written against the documented PowerPoint object model.
#
# One long-lived process: reads one JSON command per line on standard input, such as
#   {"id":3,"cmd":"start","copy":"C:\\...\\deck.pptx","slide":4,"useTimings":false,"x":0,"y":0,"width":1440,"height":810}
# and writes one JSON answer per line: {"id":3,"ok":true,"result":...} or {"id":3,"ok":false,"error":"..."}.
# Positions are in points, as PowerPoint's SlideShowWindow uses them; ServiceEx converts.
# Show results are {slide, state, step, steps, frame}, or null when no show of that copy is running.

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

$msoTrue = -1
$msoFalse = 0
$ppShowTypeSpeaker = 1
$ppShowAll = 1
$ppSlideShowManualAdvance = 1
$ppSlideShowUseSlideTimings = 2
$ppSlideShowRunning = 1
$ppSlideShowPaused = 2
$ppSlideShowDone = 5

$script:app = $null
$script:wasRunning = $null
# Copy path to its Presentation.
$script:decks = @{}

function Get-PowerPoint {
  if (-not $script:app) {
    if ($null -eq $script:wasRunning) {
      $script:wasRunning = $null -ne (Get-Process -Name POWERPNT -ErrorAction SilentlyContinue)
    }
    $script:app = New-Object -ComObject PowerPoint.Application
  }
  return $script:app
}

function Get-Deck([string]$copy) {
  $deck = $script:decks[$copy]
  if (-not $deck) { throw 'The presentation is not open in PowerPoint.' }
  return $deck
}

function Find-Show([string]$copy) {
  $app = Get-PowerPoint
  foreach ($win in $app.SlideShowWindows) {
    if ($win.Presentation.FullName -eq $copy) { return $win }
  }
  return $null
}

function Get-ShowState($win) {
  if (-not $win) { return $null }
  $view = $win.View
  $slide = 0
  $step = $null
  $steps = $null
  if ($view.State -ne $ppSlideShowDone) {
    $slide = [int]$view.Slide.SlideIndex
    try {
      $step = [int]$view.GetClickIndex()
      $steps = [int]$view.GetClickCount()
    } catch { }
  }
  return [ordered]@{
    slide = $slide
    state = [int]$view.State
    step  = $step
    steps = $steps
    frame = [ordered]@{ x = [double]$win.Left; y = [double]$win.Top; width = [double]$win.Width; height = [double]$win.Height }
  }
}

function Get-RunningShow([string]$copy) {
  $win = Find-Show $copy
  if (-not $win) { throw 'The PowerPoint slide show is no longer running.' }
  return $win
}

function Invoke-LiveCommand($request) {
  switch ($request.cmd) {
    'open' {
      if (-not $script:decks[$request.copy]) {
        $app = Get-PowerPoint
        # Read only, not untitled, no document window: only the slide show will show.
        $script:decks[$request.copy] = $app.Presentations.Open($request.copy, $msoTrue, $msoFalse, $msoFalse)
      }
      return [int]$script:decks[$request.copy].Slides.Count
    }
    'close' {
      $win = Find-Show $request.copy
      if ($win) { $win.View.Exit() }
      $deck = $script:decks[$request.copy]
      if ($deck) {
        $deck.Close()
        $script:decks.Remove($request.copy)
      }
      return $null
    }
    'start' {
      $deck = Get-Deck $request.copy
      $win = Find-Show $request.copy
      if ($win) { $win.View.Exit() }
      $settings = $deck.SlideShowSettings
      # The full screen (speaker) show, moved onto the output below; it has no border or title bar.
      $settings.ShowType = $ppShowTypeSpeaker
      try { $settings.ShowPresenterView = $msoFalse } catch { }
      if ($request.useTimings) { $settings.AdvanceMode = $ppSlideShowUseSlideTimings } else { $settings.AdvanceMode = $ppSlideShowManualAdvance }
      $settings.LoopUntilStopped = $msoFalse
      $settings.RangeType = $ppShowAll
      $win = $settings.Run()
      $win.Left = [single]$request.x
      $win.Top = [single]$request.y
      $win.Width = [single]$request.width
      $win.Height = [single]$request.height
      if ([int]$request.slide -gt 1) { $win.View.GotoSlide([int]$request.slide, $msoTrue) }
      return Get-ShowState $win
    }
    'goto' {
      $win = Get-RunningShow $request.copy
      $win.View.GotoSlide([int]$request.slide, $msoTrue)
      return Get-ShowState $win
    }
    'next' {
      $win = Get-RunningShow $request.copy
      $view = $win.View
      # Past the end of the last slide PowerPoint shows "End of slide show"; stay on the last slide instead.
      $atEnd = $false
      try { $atEnd = ($view.Slide.SlideIndex -eq $win.Presentation.Slides.Count) -and ($view.GetClickIndex() -ge $view.GetClickCount()) } catch { }
      if (-not $atEnd) {
        $view.Next()
        if ($view.State -eq $ppSlideShowDone) { $view.Previous() }
      }
      return Get-ShowState $win
    }
    'previous' {
      $win = Get-RunningShow $request.copy
      $win.View.Previous()
      return Get-ShowState $win
    }
    'pause' {
      $win = Get-RunningShow $request.copy
      $win.View.State = $ppSlideShowPaused
      return Get-ShowState $win
    }
    'resume' {
      $win = Get-RunningShow $request.copy
      $win.View.State = $ppSlideShowRunning
      return Get-ShowState $win
    }
    'end' {
      $win = Find-Show $request.copy
      if ($win) { $win.View.Exit() }
      return $null
    }
    'position' {
      return Get-ShowState (Find-Show $request.copy)
    }
    'dispose' {
      foreach ($copy in @($script:decks.Keys)) {
        try {
          $win = Find-Show $copy
          if ($win) { $win.View.Exit() }
          $script:decks[$copy].Close()
        } catch { }
        $script:decks.Remove($copy)
      }
      if ($script:app) {
        # Quit only when this started PowerPoint and nothing else is open in it.
        if ($script:wasRunning -eq $false -and $script:app.Presentations.Count -eq 0) { $script:app.Quit() }
        [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($script:app)
        $script:app = $null
      }
      return $null
    }
    default { throw "Unknown command $($request.cmd)" }
  }
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $request = $null
  try {
    $request = ConvertFrom-Json -InputObject $line
    $result = Invoke-LiveCommand $request
    $answer = [ordered]@{ id = $request.id; ok = $true; result = $result }
  } catch {
    $id = $null
    if ($request) { $id = $request.id }
    $answer = [ordered]@{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $answer -Depth 6 -Compress))
  [Console]::Out.Flush()
  if ($request -and $request.cmd -eq 'dispose') { break }
}
