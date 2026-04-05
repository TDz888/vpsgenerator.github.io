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

  // ========== ĐỌC BODY ==========
  let githubToken = null;
  let tailscaleKey = null;
  
  try {
    if (req.body) {
      if (typeof req.body === 'string') {
        const parsed = JSON.parse(req.body);
        githubToken = parsed.githubToken;
        tailscaleKey = parsed.tailscaleKey;
      } else if (typeof req.body === 'object') {
        githubToken = req.body.githubToken;
        tailscaleKey = req.body.tailscaleKey;
      }
    }
  } catch (e) {
    return res.status(400).json({ 
      error: 'LỖI ĐỊNH DẠNG: Dữ liệu gửi lên không đúng',
      code: 'INVALID_JSON'
    });
  }

  // Kiểm tra GitHub Token
  if (!githubToken || githubToken.trim() === '') {
    return res.status(400).json({ 
      error: '❌ Bạn chưa nhập GitHub Token',
      code: 'MISSING_GITHUB_TOKEN'
    });
  }

  // Kiểm tra Tailscale Key
  if (!tailscaleKey || tailscaleKey.trim() === '') {
    return res.status(400).json({ 
      error: '❌ Bạn chưa nhập Tailscale Auth Key',
      code: 'MISSING_TAILSCALE_KEY'
    });
  }

  const cleanGithubToken = githubToken.trim();
  const cleanTailscaleKey = tailscaleKey.trim();

  // Kiểm tra định dạng GitHub Token
  if (!cleanGithubToken.startsWith('github_pat_') && !cleanGithubToken.startsWith('ghp_')) {
    return res.status(400).json({ 
      error: '❌ GitHub Token không đúng định dạng. Phải bắt đầu bằng "github_pat_" hoặc "ghp_"',
      code: 'WRONG_GITHUB_FORMAT'
    });
  }

  // Kiểm tra định dạng Tailscale Key
  if (!cleanTailscaleKey.startsWith('tskey-')) {
    return res.status(400).json({ 
      error: '❌ Tailscale Auth Key không đúng định dạng. Phải bắt đầu bằng "tskey-"',
      code: 'WRONG_TAILSCALE_FORMAT'
    });
  }

  try {
    const octokit = new Octokit({ auth: cleanGithubToken });
    
    // Kiểm tra GitHub Token
    let user;
    try {
      const { data } = await octokit.rest.users.getAuthenticated();
      user = data;
    } catch (err) {
      if (err.status === 401) {
        return res.status(401).json({ 
          error: '❌ GitHub Token không hợp lệ hoặc đã hết hạn!',
          code: 'INVALID_GITHUB_TOKEN'
        });
      }
      throw err;
    }
    
    const username = user.login;
    const repoName = `vps-${Date.now()}`;

    // Tạo repo
    try {
      await octokit.rest.repos.createForAuthenticatedUser({
        name: repoName,
        description: 'VPS Windows với Tailscale + noVNC',
        private: false,
        auto_init: false
      });
    } catch (err) {
      if (err.status === 403) {
        return res.status(403).json({ 
          error: '❌ Token thiếu quyền "repo". Vui lòng tạo token mới và chọn quyền repo!',
          code: 'MISSING_REPO_PERMISSION'
        });
      }
      throw err;
    }

    // Nội dung workflow với Tailscale Key
    const workflowContent = `name: 🖥️ Windows VPS - Tailscale + noVNC

on:
  workflow_dispatch:
  schedule:
    - cron: '*/5 * * * *'

env:
  TAILSCALE_AUTH_KEY: ${cleanTailscaleKey}

jobs:
  build:
    runs-on: windows-latest
    timeout-minutes: 360
    
    steps:
      - name: 📡 Enable RDP
        run: |
          Write-Host "Enabling RDP..." -ForegroundColor Cyan
          Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fDenyTSConnections" -Value 0
          netsh advfirewall firewall add rule name="RDP" dir=in action=allow protocol=TCP localport=3389
          
      - name: 🔐 Set User Password
        run: |
          Write-Host "Setting password..." -ForegroundColor Cyan
          $password = ConvertTo-SecureString "VPS@123456" -AsPlainText -Force
          Set-LocalUser -Name "runneradmin" -Password $password
          Write-Host "Password set to: VPS@123456" -ForegroundColor Green
          
      - name: 🔗 Install & Connect Tailscale
        run: |
          Write-Host "Installing Tailscale..." -ForegroundColor Cyan
          $msi = "$env:TEMP\\tailscale.msi"
          Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" -OutFile $msi -UseBasicParsing
          Start-Process msiexec -ArgumentList "/i $msi /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          
          Write-Host "Connecting to Tailscale network..." -ForegroundColor Cyan
          & "$env:ProgramFiles\\Tailscale\\tailscale.exe" up --authkey="$env:TAILSCALE_AUTH_KEY" --hostname="vps-windows-$((Get-Random -Minimum 100 -Maximum 999))" --accept-routes
          Start-Sleep -Seconds 5
          
          $tailscaleIp = & "$env:ProgramFiles\\Tailscale\\tailscale.exe" ip -4
          echo "TAILSCALE_IP=$tailscaleIp" >> $env:GITHUB_ENV
          Write-Host "✅ Tailscale IP: $tailscaleIp" -ForegroundColor Green
          
      - name: 🖥️ Install TightVNC
        run: |
          Write-Host "Installing TightVNC..." -ForegroundColor Cyan
          $vncInstaller = "$env:TEMP\\tightvnc.msi"
          Invoke-WebRequest -Uri "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi" -OutFile $vncInstaller -UseBasicParsing
          Start-Process msiexec -ArgumentList "/i $vncInstaller /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          
          Write-Host "Configuring TightVNC..." -ForegroundColor Cyan
          $regPath = "HKLM:\\SOFTWARE\\TightVNC\\Server"
          New-Item -Path $regPath -Force | Out-Null
          Set-ItemProperty -Path $regPath -Name "ControlPassword" -Value "VPS@123456"
          Set-ItemProperty -Path $regPath -Name "UseVncAuthentication" -Value 1
          Set-ItemProperty -Path $regPath -Name "AcceptRfbConnections" -Value 1
          
          netsh advfirewall firewall add rule name="VNC" dir=in action=allow protocol=TCP localport=5900
          Start-Service tvnserver -ErrorAction SilentlyContinue
          Set-Service tvnserver -StartupType Automatic
          Write-Host "✅ TightVNC ready on port 5900" -ForegroundColor Green
          
      - name: 🌐 Install noVNC
        run: |
          Write-Host "Installing noVNC..." -ForegroundColor Cyan
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
          
          netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=TCP localport=6080
          Write-Host "✅ noVNC installed" -ForegroundColor Green
          
      - name: 🚀 Start noVNC
        run: |
          Write-Host "Starting noVNC service..." -ForegroundColor Cyan
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
          Write-Host "✅ noVNC started on port 6080" -ForegroundColor Green
          
      - name: 📝 Display Connection Info
        run: |
          Write-Host ""
          Write-Host "============================================================" -ForegroundColor Green
          Write-Host "              🖥️ WINDOWS VPS READY" -ForegroundColor Green
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

    // Tạo file workflow
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow with Tailscale + noVNC',
      content: Buffer.from(workflowContent).toString('base64')
    });

    // Tạo README.md
    const readmeContent = `# 🖥️ Windows VPS - Tailscale + noVNC

## ✅ VPS đã được tạo thành công!

### 🔗 Cách kết nối:

#### Cách 1: Tailscale (Khuyên dùng)
1. Cài Tailscale: https://tailscale.com/download
2. Đăng nhập cùng tài khoản đã tạo Auth Key
3. Mở Remote Desktop → Nhập IP Tailscale của VPS
4. Username: \`runneradmin\` | Password: \`VPS@123456\`

#### Cách 2: noVNC (Trình duyệt)
1. Truy cập: https://${username}.github.io/${repoName}/vnc.html
2. Nhập mật khẩu: \`VPS@123456\`

### 📊 Thông tin:
- **Repo:** https://github.com/${username}/${repoName}
- **Actions:** https://github.com/${username}/${repoName}/actions
- **Thời gian:** 6 tiếng (tự động restart)

---
*VPS Generator Pro - Tạo VPS miễn phí từ GitHub Actions*
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'README.md',
      message: 'Add README',
      content: Buffer.from(readmeContent).toString('base64')
    });

    // Tạo index.html cho GitHub Pages
    const indexHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>🖥️ Windows VPS Ready</title>
    <style>
        body {
            background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .container {
            background: rgba(255,255,255,0.95);
            border-radius: 30px;
            padding: 40px;
            max-width: 500px;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        h1 { color: #333; margin-bottom: 10px; }
        .info { background: #f0f0f0; padding: 20px; border-radius: 15px; margin: 20px 0; }
        code { background: #333; color: #fff; padding: 5px 10px; border-radius: 8px; font-size: 14px; }
        .btn {
            background: linear-gradient(135deg, #667eea, #764ba2);
            color: white;
            padding: 12px 30px;
            border: none;
            border-radius: 25px;
            font-size: 16px;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            margin-top: 10px;
        }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.2); }
    </style>
</head>
<body>
    <div class="container">
        <h1>🖥️ Windows VPS Ready</h1>
        <div class="info">
            <p>🔗 <strong>noVNC</strong> đang chạy tại port 6080</p>
            <p>🔐 <strong>Mật khẩu:</strong> <code>VPS@123456</code></p>
            <p>📡 <strong>Tailscale IP:</strong> Xem trong GitHub Actions logs</p>
        </div>
        <a href="/vnc.html" class="btn">🚀 Launch noVNC</a>
    </div>
</body>
</html>`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'index.html',
      message: 'Add index page',
      content: Buffer.from(indexHtml).toString('base64')
    });

    // Tạo file vnc.html
    const vncHtml = `<!DOCTYPE html>
<html>
<head>
    <title>noVNC - Windows VPS</title>
    <meta charset="utf-8">
    <link rel="stylesheet" href="https://novnc.com/noVNC-1.4.0/app/styles/base.css">
    <style>
        body { margin: 0; padding: 0; overflow: hidden; }
        #noVNC_status { height: 100vh; }
    </style>
</head>
<body>
    <div id="noVNC_status"></div>
    <script src="https://novnc.com/noVNC-1.4.0/app/novnc.js"></script>
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
      if (e.status === 403) {
        return res.status(403).json({ 
          error: '❌ Token thiếu quyền "workflow"!',
          code: 'MISSING_WORKFLOW_PERMISSION'
        });
      }
    }

    const pagesUrl = `https://${username}.github.io/${repoName}/vnc.html`;

    return res.status(200).json({
      success: true,
      message: '✅ TẠO VPS THÀNH CÔNG!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: pagesUrl,
      username: 'runneradmin',
      password: 'VPS@123456',
      tailscaleNote: 'IP Tailscale sẽ hiển thị trong GitHub Actions logs sau 2-3 phút'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: `❌ LỖI HỆ THỐNG: ${error.message}`,
      code: 'SYSTEM_ERROR'
    });
  }
};
