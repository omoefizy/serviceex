# Exports every slide of a presentation as a PNG with desktop PowerPoint through COM, for WorshipDeck.
# Opens the file read only and without a window, writes slide-001.png, slide-002.png... into OutputDir, fitted
# inside 1920x1080 at the slide's own shape (hidden slides left out), then slides.json with the count, titles,
# notes, and for each slide whether it has animations (TimeLine.MainSequence.Count) or a transition. PowerPoint is
# quit afterwards only when no other presentation is open in it.
param(
  [Parameter(Mandatory = $true)][string]$InputPath,
  [Parameter(Mandatory = $true)][string]$OutputDir
)

$ErrorActionPreference = 'Stop'
$msoTrue = -1
$msoFalse = 0
$ppPlaceholderBody = 2

function Get-ShapeText($shape) {
  if ($shape.HasTextFrame -and $shape.TextFrame.HasText) { return [string]$shape.TextFrame.TextRange.Text }
  return ''
}

$app = New-Object -ComObject PowerPoint.Application
$deck = $null
try {
  # ReadOnly, not Untitled, no window.
  $deck = $app.Presentations.Open($InputPath, $msoTrue, $msoFalse, $msoFalse)
  $ratio = $deck.PageSetup.SlideWidth / $deck.PageSetup.SlideHeight
  if ($ratio -ge (1920 / 1080)) { $width = 1920; $height = [int][Math]::Round(1920 / $ratio) }
  else { $height = 1080; $width = [int][Math]::Round(1080 * $ratio) }

  $slides = @()
  foreach ($slide in $deck.Slides) {
    # Hidden slides are left out, as they are from a slide show and a PDF export.
    if ($slide.SlideShowTransition.Hidden -eq $msoTrue) { continue }
    $file = 'slide-{0:D3}.png' -f ($slides.Count + 1)
    $slide.Export((Join-Path $OutputDir $file), 'PNG', $width, $height)

    $title = ''
    if ($slide.Shapes.HasTitle -eq $msoTrue) { $title = Get-ShapeText $slide.Shapes.Title }
    $text = @()
    foreach ($shape in $slide.Shapes) {
      $value = Get-ShapeText $shape
      if ($value) { $text += $value }
    }
    $notes = ''
    foreach ($placeholder in $slide.NotesPage.Shapes.Placeholders) {
      if ($placeholder.PlaceholderFormat.Type -eq $ppPlaceholderBody) { $notes = Get-ShapeText $placeholder }
    }

    $slides += [ordered]@{
      file       = $file
      title      = $title
      text       = ($text -join "`n")
      notes      = $notes
      animations = [int]$slide.TimeLine.MainSequence.Count
      transition = ($slide.SlideShowTransition.EntryEffect -ne 0)
    }
  }

  $result = [ordered]@{ count = $slides.Count; slides = $slides }
  $json = ConvertTo-Json -InputObject $result -Depth 4
  [System.IO.File]::WriteAllText((Join-Path $OutputDir 'slides.json'), $json, (New-Object System.Text.UTF8Encoding $false))
}
finally {
  if ($deck) { $deck.Close() }
  if ($app.Presentations.Count -eq 0) { $app.Quit() }
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
