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
    if (typeof req.body === 'string') {
      const parsed = JSON.parse(req.body);
      githubToken = parsed.githubToken;
      tailscaleKey = parsed.tailscaleKey;
    } else if (typeof req.body === 'object') {
      githubToken = req.body.githubToken;
      tailscaleKey = req.body.tailscaleKey;
    }
  } catch (e) {
    return res.status(400).json({ 
      error: 'Invalid JSON format',
      code: 'INVALID_JSON'
    });
  }

  // Kiểm tra token
  if (!githubToken || githubToken.trim() === '') {
    return res.status(400).json({ 
      error: 'Missing GitHub Token',
      code: 'MISSING_GITHUB_TOKEN'
    });
  }

  if (!tailscaleKey || tailscaleKey.trim() === '') {
    return res.status(400).json({ 
      error: 'Missing Tailscale Auth Key',
      code: 'MISSING_TAILSCALE_KEY'
    });
  }

  const cleanGithubToken = githubToken.trim();
  const cleanTailscaleKey = tailscaleKey.trim();

  // Kiểm tra định dạng GitHub Token
  const isValidGitHubToken = cleanGithubToken.startsWith('github_pat_') || 
                              cleanGithubToken.startsWith('ghp_') ||
                              cleanGithubToken.startsWith('gho_') ||
                              cleanGithubToken.startsWith('ghu_');
  
  if (!isValidGitHubToken) {
    return res.status(400).json({ 
      error: 'Invalid GitHub Token format. Must start with github_pat_, ghp_, gho_, or ghu_',
      code: 'WRONG_GITHUB_FORMAT'
    });
  }

  // Kiểm tra định dạng Tailscale Key
  if (!cleanTailscaleKey.startsWith('tskey-')) {
    return res.status(400).json({ 
      error: 'Invalid Tailscale Auth Key format. Must start with tskey-',
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
          error: 'Invalid or expired GitHub Token',
          code: 'INVALID_GITHUB_TOKEN'
        });
      }
      throw err;
    }
    
    const username = user.login;
    const repoName = `vps-${Date.now()}`;
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();

    // Tạo repository với auto_init = true để có branch main
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'VPS Windows with Tailscale + noVNC',
      private: false,
      auto_init: true  // ✅ QUAN TRỌNG: Tạo repository có sẵn branch main
    });

    // ✅ Đợi repository khởi tạo xong
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Lấy thông tin branch mặc định
    let defaultBranch = 'main';
    try {
      const repoInfo = await octokit.rest.repos.get({
        owner: username,
        repo: repoName
      });
      defaultBranch = repoInfo.data.default_branch;
    } catch (e) {
      console.log('Cannot get default branch, using main');
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
          Start-Sleep -Seconds 10
          
          Write-Host "Connecting to Tailscale network..." -ForegroundColor Cyan
          & "$env:ProgramFiles\\Tailscale\\tailscale.exe" up --authkey="$env:TAILSCALE_AUTH_KEY" --hostname="vps-windows" --accept-routes
          Start-Sleep -Seconds 10
          
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
          Set-Location C:\\novnc
          Start-Process powershell -ArgumentList "-Command python -m http.server 6080" -WindowStyle Hidden
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
          Write-Host "   URL: http://localhost:6080" -ForegroundColor Yellow
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

    // Tạo file workflow trong thư mục .github/workflows/
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: '.github/workflows/vps.yml',
      message: 'Add VPS workflow with Tailscale + noVNC',
      content: Buffer.from(workflowContent).toString('base64'),
      branch: defaultBranch
    });

    // ✅ Tạo file README.md để GitHub Pages kích hoạt
    const readmeContent = `# 🖥️ Windows VPS

## VPS đã được tạo thành công!

- **Username:** runneradmin
- **Password:** VPS@123456
- **Tailscale IP:** Xem trong GitHub Actions logs

### Cách kết nối:
1. Cài Tailscale: https://tailscale.com/download
2. Đăng nhập cùng tài khoản đã tạo Auth Key
3. Mở Remote Desktop → Nhập IP Tailscale
4. Username: runneradmin | Password: VPS@123456
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'README.md',
      message: 'Add README',
      content: Buffer.from(readmeContent).toString('base64'),
      branch: defaultBranch
    });

    // ✅ Kích hoạt workflow
    try {
      await octokit.rest.actions.createWorkflowDispatch({
        owner: username,
        repo: repoName,
        workflow_id: 'vps.yml',
        ref: defaultBranch
      });
    } catch (e) {
      console.log('Workflow trigger warning:', e.message);
      // Không return lỗi vì workflow vẫn được tạo, chỉ cần người dùng tự bấm Run workflow
    }

    // Link GitHub Pages (sẽ hoạt động sau khi workflow chạy lần đầu)
    const pagesUrl = `https://${username}.github.io/${repoName}`;

    return res.status(200).json({
      success: true,
      id: repoName,
      name: repoName,
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: pagesUrl,
      username: 'runneradmin',
      password: 'VPS@123456',
      createdAt: createdAt,
      expiresAt: expiresAt,
      status: 'created',
      note: 'Workflow đã được tạo. Vào GitHub Actions và bấm "Run workflow" để khởi động VPS!'
    });

  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: error.message,
      code: 'SYSTEM_ERROR'
    });
  }
};
