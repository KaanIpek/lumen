# Fits any screenshot onto a canvas size App Store Connect accepts for an
# in-app purchase review screenshot.
#
# ASC rejects arbitrary dimensions — it wants a real device size. This scales
# the image to fit (keeping its aspect ratio, so nothing is stretched) and
# centres it on a 1242x2208 canvas filled with the game's own background, so
# the padding reads as part of the screen rather than as a white border.
#
#   powershell -ExecutionPolicy Bypass -File tools\fit-iap-shot.ps1
#
# Reads every .png in iap-shots\ and writes <name>-fitted.png beside it.
Add-Type -AssemblyName System.Drawing
$W = 1242; $H = 2208
$dir = Join-Path $PSScriptRoot '..\iap-shots'
$dir = (Resolve-Path $dir).Path
Get-ChildItem $dir -Filter *.png | Where-Object { $_.Name -notlike '*-fitted.png' } | ForEach-Object {
  $src = [System.Drawing.Image]::FromFile($_.FullName)
  $scale = [Math]::Min($W / $src.Width, $H / $src.Height)
  $w = [int]($src.Width * $scale); $h = [int]($src.Height * $scale)
  $bmp = New-Object System.Drawing.Bitmap $W, $H
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.ColorTranslator]::FromHtml('#080a18'))
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($src, [int](($W - $w) / 2), [int](($H - $h) / 2), $w, $h)
  $out = Join-Path $dir ($_.BaseName + '-fitted.png')
  $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $src.Dispose()
  Write-Output ("{0}  ->  {1}x{2}" -f $_.Name, $W, $H)
}
