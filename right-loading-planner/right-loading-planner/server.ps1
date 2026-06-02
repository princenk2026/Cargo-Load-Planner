# Right Loading Planner - Zero-Dependency PowerShell Web Server
# Serves PWA static assets with correct MIME types on http://localhost:8080/

$port = 8080
$localPath = "C:\Users\Prince\.gemini\antigravity\scratch\right-loading-planner"
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

# Clean old listeners on same port
try {
    $listener.Start()
    Write-Host "Right Loading Planner server active at: http://localhost:$port/"
    Write-Host "Press Ctrl+C to terminate the server task."
    
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response
        
        $rawUrl = $req.Url.LocalPath
        if ($rawUrl -eq "/") { $rawUrl = "/index.html" }
        
        # Security sanitization
        $rawUrl = $rawUrl.Replace("..", "")
        $filePath = Join-Path $localPath $rawUrl
        
        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $mime = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".png"  { "image/png" }
                ".txt"  { "text/plain; charset=utf-8" }
                default { "application/octet-stream" }
            }
            
            $res.ContentType = $mime
            # Enable CORS for local testing
            $res.Headers.Add("Access-Control-Allow-Origin", "*")
            
            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $res.StatusCode = 404
            $res.ContentType = "text/plain"
            $errorMessage = "404 - Right Loading Planner: File not found: $rawUrl"
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($errorMessage)
            $res.ContentLength64 = $bytes.Length
            $res.OutputStream.Write($bytes, 0, $bytes.Length)
        }
        $res.Close()
    }
} catch {
    Write-Host "Server interrupted or port in use." -ForegroundColor Yellow
} finally {
    $listener.Stop()
    Write-Host "Server stopped."
}
