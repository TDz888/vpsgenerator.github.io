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

  // ========== CÁCH ĐỌC BODY CHUẨN CHO VERCEL ==========
  let githubToken = null;
  
  try {
    // Vercel gửi body dưới dạng string, cần parse JSON
    if (req.body) {
      if (typeof req.body === 'string') {
        const parsed = JSON.parse(req.body);
        githubToken = parsed.githubToken;
      } else if (typeof req.body === 'object') {
        githubToken = req.body.githubToken;
      }
    }
    
    // Nếu vẫn không có, thử đọc từ rawBody (Vercel)
    if (!githubToken && req.rawBody) {
      const parsed = JSON.parse(req.rawBody);
      githubToken = parsed.githubToken;
    }
    
    // Nếu vẫn không có, thử đọc từ event (Vercel)
    if (!githubToken && req.event && req.event.body) {
      const parsed = JSON.parse(req.event.body);
      githubToken = parsed.githubToken;
    }
  } catch (e) {
    console.error('Parse error:', e);
    return res.status(400).json({ error: 'Invalid JSON format: ' + e.message });
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

    // Nội dung workflow
    const workflowContent = `name: 🖥️ Windows VPS - Tailscale + noVNC

on:
  workflow_dispatch:
  schedule:
    - cron: '*/5 * * * *'

env:
  TAILSCALE_AUTH_KEY: \${{ secrets.TAILSCALE_AUTH_KEY }}

jobs:
  build:
    runs-on: windows-latest
    timeout-minutes: 360
    
    steps:
      - name: 📡 Enable RDP
        run: |
          Set-ItemProperty -Path 'HKLM:\\System\\CurrentControlSet\\Control\\Terminal Server' -Name "fDenyTSConnections" -Value 0
          netsh advfirewall firewall add rule name="RDP" dir=in action=allow protocol=TCP localport=3389
          
      - name: 🔐 Set Password
        run: |
          \$password = ConvertTo-SecureString "VPS@123456" -AsPlainText -Force
          Set-LocalUser -Name "runneradmin" -Password \$password
          
      - name: 🔗 Install Tailscale
        run: |
          \$msi = "\$env:TEMP\\tailscale.msi"
          Invoke-WebRequest -Uri "https://pkgs.tailscale.com/stable/tailscale-setup-latest-amd64.msi" -OutFile \$msi -UseBasicParsing
          Start-Process msiexec -ArgumentList "/i \$msi /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          & "\$env:ProgramFiles\\Tailscale\\tailscale.exe" up --authkey="\$env:TAILSCALE_AUTH_KEY" --hostname="vps-windows" --accept-routes
          Start-Sleep -Seconds 5
          \$tailscaleIp = & "\$env:ProgramFiles\\Tailscale\\tailscale.exe" ip -4
          Write-Host "TAILSCALE_IP=\$tailscaleIp" >> \$env:GITHUB_ENV
          Write-Host "Tailscale IP: \$tailscaleIp" -ForegroundColor Green
          
      - name: 🖥️ Install TightVNC
        run: |
          \$vncInstaller = "\$env:TEMP\\tightvnc.msi"
          Invoke-WebRequest -Uri "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi" -OutFile \$vncInstaller -UseBasicParsing
          Start-Process msiexec -ArgumentList "/i \$vncInstaller /quiet /norestart" -Wait
          Start-Sleep -Seconds 5
          \$regPath = "HKLM:\\SOFTWARE\\TightVNC\\Server"
          New-Item -Path \$regPath -Force | Out-Null
          Set-ItemProperty -Path \$regPath -Name "ControlPassword" -Value "VPS@123456"
          Set-ItemProperty -Path \$regPath -Name "UseVncAuthentication" -Value 1
          Set-ItemProperty -Path \$regPath -Name "AcceptRfbConnections" -Value 1
          netsh advfirewall firewall add rule name="VNC" dir=in action=allow protocol=TCP localport=5900
          Start-Service tvnserver -ErrorAction SilentlyContinue
          
      - name: 🌐 Install noVNC
        run: |
          Remove-Item C:\\novnc -Recurse -Force -ErrorAction SilentlyContinue
          New-Item C:\\novnc -ItemType Directory -Force | Out-Null
          Set-Location C:\\novnc
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/noVNC/zip/refs/tags/v1.4.0" -OutFile "novnc.zip" -UseBasicParsing
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/websockify/zip/refs/tags/v0.11.0" -OutFile "ws.zip" -UseBasicParsing
          Expand-Archive -Path "novnc.zip" -DestinationPath "." -Force
          Expand-Archive -Path "ws.zip" -DestinationPath "." -Force
          \$novncFolder = Get-ChildItem -Directory | Where-Object { \$_.Name -like "noVNC-*" } | Select-Object -First 1
          \$wsFolder = Get-ChildItem -Directory | Where-Object { \$_.Name -like "websockify-*" } | Select-Object -First 1
          Get-ChildItem "\$(\$novncFolder.FullName)" | Copy-Item -Destination "C:\\novnc\\" -Recurse -Force
          New-Item "C:\\novnc\\websockify" -ItemType Directory -Force | Out-Null
          Get-ChildItem "\$(\$wsFolder.FullName)" | Copy-Item -Destination "C:\\novnc\\websockify\\" -Recurse -Force
          netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=TCP localport=6080
          
      - name: 🚀 Start noVNC
        run: |
          \$psCode = "Set-Location 'C:\\novnc'; python websockify\\websockify.py --web . 6080 localhost:5900"
          \$scriptPath = "C:\\novnc\\start.ps1"
          \$psCode | Out-File -FilePath \$scriptPath -Encoding UTF8
          Start-Process powershell.exe -ArgumentList "-ExecutionPolicy Bypass -File `"\$scriptPath`"" -WindowStyle Hidden
          
      - name: ⏳ Keep Alive
        run: |
          \$endTime = (Get-Date).AddHours(6)
          while ((Get-Date) -lt \$endTime) {
            \$remaining = [math]::Round((\$endTime - (Get-Date)).TotalMinutes)
            Write-Host "✅ VPS Running - \$remaining minutes remaining" -ForegroundColor Green
            Start-Sleep -Seconds 60
          }
`;

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
      console.log('Workflow dispatch error:', e.message);
    }

    const pagesUrl = `https://${username}.github.io/${repoName}`;

    return res.status(200).json({
      success: true,
      message: '✅ Đã tạo VPS thành công!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: pagesUrl,
      username: 'runneradmin',
      password: 'VPS@123456'
    });

  } catch (error) {
    console.error('Error:', error);
    
    let errorMessage = error.message;
    if (error.status === 401) {
      errorMessage = 'Token không hợp lệ hoặc đã hết hạn!';
    } else if (error.status === 403) {
      errorMessage = 'Token không có đủ quyền! Cần cấp quyền repo và workflow.';
    }
    
    return res.status(500).json({
      error: errorMessage,
      success: false
    });
  }
};
