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

  // ========== ĐỌC BODY CHUẨN ==========
  let githubToken = null;
  let tailscaleKey = null;
  
  try {
    if (req.body && typeof req.body === 'object') {
      githubToken = req.body.githubToken;
      tailscaleKey = req.body.tailscaleKey;
    }
    
    if (!githubToken && req.body && typeof req.body === 'string') {
      try {
        const parsed = JSON.parse(req.body);
        githubToken = parsed.githubToken;
        tailscaleKey = parsed.tailscaleKey;
      } catch (e) {}
    }
  } catch (e) {
    console.error('Parse error:', e);
  }

  // Kiểm tra token không được rỗng
  if (!githubToken || githubToken.trim() === '') {
    return res.status(400).json({ 
      error: '❌ Vui lòng nhập GitHub Token',
      code: 'MISSING_GITHUB_TOKEN'
    });
  }

  if (!tailscaleKey || tailscaleKey.trim() === '') {
    return res.status(400).json({ 
      error: '❌ Vui lòng nhập Tailscale Auth Key',
      code: 'MISSING_TAILSCALE_KEY'
    });
  }

  const cleanGithubToken = githubToken.trim();
  const cleanTailscaleKey = tailscaleKey.trim();

  // ✅ FIX: Chấp nhận nhiều định dạng token GitHub hơn
  const isValidGitHubToken = cleanGithubToken.startsWith('github_pat_') || 
                              cleanGithubToken.startsWith('ghp_') ||
                              cleanGithubToken.startsWith('gho_') ||
                              cleanGithubToken.startsWith('ghu_') ||
                              cleanGithubToken.length > 30; // fallback cho token không theo prefix
  
  if (!isValidGitHubToken) {
    return res.status(400).json({ 
      error: '❌ GitHub Token không hợp lệ',
      hint: 'Token phải bắt đầu bằng: github_pat_, ghp_, gho_, hoặc ghu_',
      code: 'WRONG_GITHUB_FORMAT'
    });
  }

  if (!cleanTailscaleKey.startsWith('tskey-')) {
    return res.status(400).json({ 
      error: '❌ Tailscale Auth Key không đúng định dạng',
      hint: 'Key phải bắt đầu bằng "tskey-"',
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
      if (err.status === 403 || err.status === 422) {
        return res.status(403).json({ 
          error: '❌ Token thiếu quyền hoặc không hợp lệ',
          hint: 'Vui lòng tạo token mới và chọn quyền: repo, workflow',
          code: 'MISSING_REPO_PERMISSION'
        });
      }
      throw err;
    }

    // Nội dung workflow (giữ nguyên phần này)
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
          
      - name: 🔐 Set Password
        run: |
          Write-Host "Setting password..." -ForegroundColor Cyan
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
          Write-Host "Connecting to Tailscale..." -ForegroundColor Cyan
          & "$env:ProgramFiles\\Tailscale\\tailscale.exe" up --authkey="$env:TAILSCALE_AUTH_KEY" --hostname="vps-windows" --accept-routes
          Start-Sleep -Seconds 5
          $tailscaleIp = & "$env:ProgramFiles\\Tailscale\\tailscale.exe" ip -4
          echo "TAILSCALE_IP=$tailscaleIp" >> $env:GITHUB_ENV
          Write-Host "Tailscale IP: $tailscaleIp" -ForegroundColor Green
          
      - name: 🖥️ Install TightVNC
        run: |
          Write-Host "Installing TightVNC..." -ForegroundColor Cyan
          $vncInstaller = "$env:TEMP\\tightvnc.msi"
          Invoke-WebRequest -Uri "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi" -OutFile $vncInstaller -UseBasicParsing
          Start-Process msiexec -ArgumentList "/i $vncInstaller /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          $regPath = "HKLM:\\SOFTWARE\\TightVNC\\Server"
          New-Item -Path $regPath -Force | Out-Null
          Set-ItemProperty -Path $regPath -Name "ControlPassword" -Value "VPS@123456"
          Set-ItemProperty -Path $regPath -Name "UseVncAuthentication" -Value 1
          Set-ItemProperty -Path $regPath -Name "AcceptRfbConnections" -Value 1
          netsh advfirewall firewall add rule name="VNC" dir=in action=allow protocol=TCP localport=5900
          Start-Service tvnserver -ErrorAction SilentlyContinue
          Write-Host "TightVNC ready" -ForegroundColor Green
          
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
          netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=TCP localport=6080
          Write-Host "noVNC installed" -ForegroundColor Green
          
      - name: 🚀 Start noVNC
        run: |
          Write-Host "Starting noVNC..." -ForegroundColor Cyan
          $psCode = "Set-Location 'C:\\novnc'; python websockify\\websockify.py --web . 6080 localhost:5900"
          $scriptPath = "C:\\novnc\\start.ps1"
          $psCode | Out-File -FilePath $scriptPath -Encoding UTF8
          Start-Process powershell.exe -ArgumentList "-ExecutionPolicy Bypass -File `"$scriptPath`"" -WindowStyle Hidden
          Write-Host "noVNC started on port 6080" -ForegroundColor Green
          
      - name: ⏳ Keep Alive
        run: |
          $endTime = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $endTime) {
            $remaining = [math]::Round(($endTime - (Get-Date)).TotalMinutes)
            Write-Host "✅ VPS Running - $remaining minutes remaining" -ForegroundColor Green
            Start-Sleep -Seconds 60
          }
`;

    // Tạo file workflow
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow',
      content: Buffer.from(workflowContent).toString('base64')
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
      console.log('Workflow trigger error:', e.message);
    }

    const pagesUrl = `https://${username}.github.io/${repoName}`;

    return res.status(200).json({
      success: true,
      message: '✅ TẠO VPS THÀNH CÔNG!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: pagesUrl,
      username: 'runneradmin',
      password: 'VPS@123456'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: `❌ LỖI HỆ THỐNG: ${error.message}`,
      code: 'SYSTEM_ERROR',
      hint: 'Thử lại sau 1 phút hoặc kiểm tra GitHub Token'
    });
  }
};
