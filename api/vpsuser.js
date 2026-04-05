const { Octokit } = require('@octokit/rest');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Lấy token từ body
  let githubToken = null;
  
  try {
    if (typeof req.body === 'string') {
      const parsed = JSON.parse(req.body);
      githubToken = parsed.githubToken;
    } else if (typeof req.body === 'object') {
      githubToken = req.body.githubToken;
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request format' });
  }

  if (!githubToken || githubToken.trim() === '') {
    return res.status(400).json({ error: 'Vui lòng nhập GitHub Token' });
  }

  const cleanToken = githubToken.trim();

  try {
    const octokit = new Octokit({ auth: cleanToken });
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;
    const repoName = `vps-${Date.now()}`;

    // Tạo repo
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'VPS Windows với Tailscale + noVNC',
      private: false,
      auto_init: false
    });

    // Tạo file README.md
    const readmeContent = `# VPS Windows - Tailscale + noVNC

## Thông tin kết nối

- **Tailscale IP**: Xem trong GitHub Actions logs
- **noVNC**: https://${username}.github.io/${repoName}/vnc.html
- **Mật khẩu**: \`VPS@123456\`

## Cách kết nối qua Tailscale

1. Cài Tailscale trên máy bạn: https://tailscale.com/download
2. Đăng nhập cùng tài khoản với VM
3. Dùng Remote Desktop kết nối đến IP Tailscale của VM
4. Nhập mật khẩu \`VPS@123456\`

## Cách kết nối qua noVNC

1. Click vào link noVNC bên trên
2. Nhập mật khẩu: \`VPS@123456\`
3. Bắt đầu sử dụng

---
*VPS tự động tắt sau 6 tiếng và restart*
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'README.md',
      message: 'Add README',
      content: Buffer.from(readmeContent).toString('base64')
    });

    // Nội dung workflow CHUẨN NHẤT - có Tailscale + noVNC + TightVNC
    const workflowContent = `name: 🖥️ Windows VPS - Tailscale + noVNC

on:
  workflow_dispatch:
  schedule:
    - cron: '*/5 * * * *'

env:
  TAILSCALE_AUTH_KEY: ${{ secrets.TAILSCALE_AUTH_KEY }}

jobs:
  build:
    runs-on: windows-latest
    timeout-minutes: 360
    
    steps:
      - name: 📡 Enable RDP & Firewall
        run: |
          Write-Host "Enabling RDP..." -ForegroundColor Cyan
          Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fDenyTSConnections" -Value 0
          netsh advfirewall firewall add rule name="RDP" dir=in action=allow protocol=TCP localport=3389
          
      - name: 🔐 Set User Password
        run: |
          $password = ConvertTo-SecureString "VPS@123456" -AsPlainText -Force
          Set-LocalUser -Name "runneradmin" -Password $password
          Write-Host "Password set to: VPS@123456" -ForegroundColor Green
          
      - name: 🔗 Install Tailscale
        run: |
          Write-Host "Installing Tailscale..." -ForegroundColor Cyan
          $msi = "$env:TEMP\\tailscale.msi"
          Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" -OutFile $msi -UseBasicParsing
          Start-Process msiexec -ArgumentList "/i $msi /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          
          & "$env:ProgramFiles\\Tailscale\\tailscale.exe" up --authkey="$env:TAILSCALE_AUTH_KEY" --hostname="vps-windows" --accept-routes
          Start-Sleep -Seconds 5
          
          $tailscaleIp = & "$env:ProgramFiles\\Tailscale\\tailscale.exe" ip -4
          Write-Host "Tailscale IP: $tailscaleIp" -ForegroundColor Green
          echo "TAILSCALE_IP=$tailscaleIp" >> $env:GITHUB_ENV
          
      - name: 🖥️ Install TightVNC (theo chuẩn nhà phát hành)
        run: |
          Write-Host "Downloading TightVNC from official source..." -ForegroundColor Cyan
          $vncUrl = "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi"
          $vncInstaller = "$env:TEMP\\tightvnc.msi"
          Invoke-WebRequest -Uri $vncUrl -OutFile $vncInstaller -UseBasicParsing
          
          Write-Host "Installing TightVNC silently..." -ForegroundColor Cyan
          Start-Process msiexec -ArgumentList "/i $vncInstaller /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          
          Write-Host "Configuring TightVNC password..." -ForegroundColor Cyan
          $vncPass = "VPS@123456"
          $regPath = "HKLM:\\SOFTWARE\\TightVNC\\Server"
          New-Item -Path $regPath -Force | Out-Null
          Set-ItemProperty -Path $regPath -Name "ControlPassword" -Value $vncPass
          Set-ItemProperty -Path $regPath -Name "UseVncAuthentication" -Value 1
          Set-ItemProperty -Path $regPath -Name "AcceptRfbConnections" -Value 1
          
          netsh advfirewall firewall add rule name="VNC" dir=in action=allow protocol=TCP localport=5900
          Start-Service tvnserver -ErrorAction SilentlyContinue
          Set-Service tvnserver -StartupType Automatic
          Write-Host "TightVNC ready on port 5900" -ForegroundColor Green
          
      - name: 🌐 Install & Configure noVNC
        run: |
          Write-Host "Downloading noVNC..." -ForegroundColor Cyan
          Remove-Item C:\\novnc -Recurse -Force -ErrorAction SilentlyContinue
          New-Item C:\\novnc -ItemType Directory -Force | Out-Null
          Set-Location C:\\novnc
          
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/noVNC/zip/refs/tags/v1.4.0" -OutFile "novnc.zip" -UseBasicParsing
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/websockify/zip/refs/tags/v0.11.0" -OutFile "ws.zip" -UseBasicParsing
          
          Expand-Archive -Path "novnc.zip" -DestinationPath "." -Force
          Expand-Archive -Path "ws.zip" -DestinationPath "." -Force
          
          $novncFolder = Get-ChildItem -Directory | Where-Object { $_.Name -like "noVNC-*" } | Select-Object -First 1
          $wsFolder = Get-ChildItem -Directory | Where-Object { $_.Name -like "websockify-*" } | Select-Object -First 1
          
          Get-ChildItem "$($novncFolder.FullName)" | Copy-Item -Destination "C:\\novnc\\" -Recurse -Force
          New-Item "C:\\novnc\\websockify" -ItemType Directory -Force | Out-Null
          Get-ChildItem "$($wsFolder.FullName)" | Copy-Item -Destination "C:\\novnc\\websockify\\" -Recurse -Force
          
          Remove-Item "*.zip" -Force
          Remove-Item $novncFolder.FullName -Recurse -Force
          Remove-Item $wsFolder.FullName -Recurse -Force
          
          Write-Host "noVNC installed" -ForegroundColor Green
          
      - name: 🚀 Start noVNC Service
        run: |
          Write-Host "Starting noVNC service..." -ForegroundColor Cyan
          netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=TCP localport=6080
          
          $psCode = @"
Set-Location 'C:\\novnc'
python websockify\\websockify.py --web . 6080 localhost:5900
"@
          $scriptPath = "C:\\novnc\\start.ps1"
          $psCode | Out-File -FilePath $scriptPath -Encoding UTF8
          
          $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-ExecutionPolicy Bypass -File `"$scriptPath`""
          $trigger = New-ScheduledTaskTrigger -AtStartup
          $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
          Register-ScheduledTask -TaskName "StartNoVNC" -Action $action -Trigger $trigger -Principal $principal -Force
          Start-ScheduledTask -TaskName "StartNoVNC"
          Start-Sleep -Seconds 10
          Write-Host "noVNC started on port 6080" -ForegroundColor Green
          
      - name: 📝 Display Connection Info
        run: |
          Write-Host ""
          Write-Host "============================================================" -ForegroundColor Green
          Write-Host "              WINDOWS VPS READY" -ForegroundColor Green
          Write-Host "============================================================" -ForegroundColor Green
          Write-Host ""
          Write-Host "🔗 TAILSCALE CONNECTION:" -ForegroundColor Cyan
          Write-Host "   IP Address: $env:TAILSCALE_IP" -ForegroundColor Yellow
          Write-Host "   Protocol: RDP (port 3389)" -ForegroundColor Yellow
          Write-Host "   Username: runneradmin" -ForegroundColor Yellow
          Write-Host "   Password: VPS@123456" -ForegroundColor Yellow
          Write-Host ""
          Write-Host "🌐 noVNC CONNECTION:" -ForegroundColor Cyan
          Write-Host "   URL: https://${{ github.repository_owner }}.github.io/${{ github.event.repository.name }}/vnc.html" -ForegroundColor Yellow
          Write-Host "   Password: VPS@123456" -ForegroundColor Yellow
          Write-Host ""
          Write-Host "============================================================" -ForegroundColor Green
          
      - name: ⏳ Keep Alive
        run: |
          $endTime = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $endTime) {
            $remaining = [math]::Round(($endTime - (Get-Date)).TotalMinutes)
            Write-Host "✅ VPS Running - $remaining minutes remaining" -ForegroundColor Green
            Write-Host "🔗 Tailscale IP: $env:TAILSCALE_IP" -ForegroundColor Cyan
            Start-Sleep -Seconds 60
          }
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow with Tailscale + noVNC',
      content: Buffer.from(workflowContent).toString('base64')
    });

    // Tạo index.html cho GitHub Pages (noVNC)
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
    <title>VPS Windows - noVNC</title>
    <style>
        body { font-family: Arial; text-align: center; padding: 50px; }
        h1 { color: #333; }
        .info { background: #f0f0f0; padding: 20px; border-radius: 10px; display: inline-block; }
        code { background: #333; color: #fff; padding: 5px 10px; border-radius: 5px; }
    </style>
</head>
<body>
    <h1>🖥️ Windows VPS Ready</h1>
    <div class="info">
        <p>🔗 <strong>noVNC</strong> đang chạy tại port 6080</p>
        <p>🔐 <strong>Mật khẩu:</strong> <code>VPS@123456</code></p>
        <p>📡 <strong>Tailscale IP:</strong> Xem trong GitHub Actions logs</p>
    </div>
    <p><a href="/vnc.html">Click here to launch noVNC</a></p>
</body>
</html>`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'index.html',
      message: 'Add noVNC index page',
      content: Buffer.from(indexHtml).toString('base64')
    });

    // Tạo file vnc.html cho noVNC
    const vncHtml = `<!DOCTYPE html>
<html>
<head>
    <title>noVNC - Windows VPS</title>
    <meta charset="utf-8">
    <link rel="stylesheet" href="https://novnc.com/noVNC-1.4.0/app/styles/base.css">
    <script src="https://novnc.com/noVNC-1.4.0/app/novnc.js"></script>
</head>
<body>
    <div id="noVNC_status"></div>
    <script>
        window.addEventListener('load', function() {
            const host = window.location.hostname;
            const rfb = new RFB(document.getElementById('noVNC_status'), 'ws://' + host + ':6080', {
                credentials: { password: 'VPS@123456' }
            });
            rfb.connect();
        });
    </script>
</body>
</html>`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'vnc.html',
      message: 'Add vnc client',
      content: Buffer.from(vncHtml).toString('base64')
    });

    // Kích hoạt workflow
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: username,
        repo: repoName,
        workflow_id: 'vps.yml',
        ref: 'main'
      });
    } catch (e) {
      console.log('Workflow dispatch error:', e.message);
    }

    // Tạo link GitHub Pages
    const pagesUrl = `https://${username}.github.io/${repoName}/vnc.html`;

    return res.status(200).json({
      success: true,
      message: '✅ Đã tạo VPS thành công!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: pagesUrl,
      tailscaleNote: 'IP Tailscale sẽ hiển thị trong GitHub Actions logs sau khi workflow chạy (khoảng 2-3 phút)',
      username: 'runneradmin',
      password: 'VPS@123456'
    });

  } catch (error) {
    console.error('Error:', error);
    
    let errorMessage = error.message;
    if (error.status === 401) {
      errorMessage = '❌ Token không hợp lệ hoặc đã hết hạn! Vui lòng tạo token mới.';
    } else if (error.status === 403) {
      errorMessage = '❌ Token không có đủ quyền! Cần cấp quyền: repo, workflow.';
    }
    
    return res.status(500).json({
      error: errorMessage,
      success: false
    });
  }
};
