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

  // Lấy token từ body - xử lý nhiều trường hợp
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
    
    // Kiểm tra token hợp lệ
    const { data: user } = await octokit.rest.users.getAuthenticated();
    const username = user.login;
    const repoName = `vps-${Date.now()}`;

    // Tạo repo (không auto_init để tránh lỗi SHA)
    await octokit.rest.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'VPS từ GitHub Actions',
      private: false,
      auto_init: false
    });

    // Nội dung workflow Windows với noVNC
    const workflowContent = `name: 🖥️ VPS Windows Server

on:
  workflow_dispatch:
  schedule:
    - cron: '*/5 * * * *'

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
          
      - name: 🖥️ Install & Configure noVNC
        run: |
          # Download noVNC
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/noVNC/zip/refs/tags/v1.4.0" -OutFile "C:\\novnc.zip"
          Expand-Archive -Path "C:\\novnc.zip" -DestinationPath "C:\\" -Force
          Move-Item "C:\\noVNC-*\\*" "C:\\noVNC" -Force
          
          # Download websockify
          Invoke-WebRequest -Uri "https://codeload.github.com/novnc/websockify/zip/refs/tags/v0.11.0" -OutFile "C:\\ws.zip"
          Expand-Archive -Path "C:\\ws.zip" -DestinationPath "C:\\" -Force
          Move-Item "C:\\websockify-*\\*" "C:\\noVNC\\websockify" -Force
          
          # Configure firewall
          netsh advfirewall firewall add rule name="noVNC" dir=in action=allow protocol=TCP localport=6080
          
          # Start noVNC
          Set-Location "C:\\noVNC"
          Start-Process -NoNewWindow python -ArgumentList "websockify\\websockify.py --web . 6080 localhost:5900"
          
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

    // Tạo README.md
    const readmeContent = `# VPS Manager - Created by Hiếu Dz

VPS đã được tạo thành công!

## 🔗 Thông tin kết nối

| Service | Địa chỉ |
|---------|---------|
| 🖥️ **noVNC** | https://${username}.github.io/${repoName}/vnc.html |
| 🔐 **Mật khẩu** | \`VPS@123456\`

## 📌 Hướng dẫn

1. Click vào link noVNC bên trên
2. Nhập mật khẩu: \`VPS@123456\`
3. Bắt đầu sử dụng Windows Server

---
*VPS Project - ${repoName}*
`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'README.md',
      message: 'Add README',
      content: Buffer.from(readmeContent).toString('base64')
    });

    // Tạo file index.html cho GitHub Pages
    const indexHtml = `<!DOCTYPE html>
<html>
<head><title>VPS Manager</title></head>
<body>
<h1>VPS Manager - Created by Hiếu Dz</h1>
<p>VNC Server: localhost:5900</p>
<p>Password: VPS@123456</p>
</body>
</html>`;

    await octokit.rest.repos.createOrUpdateFileContents({
      owner: username,
      repo: repoName,
      path: 'index.html',
      message: 'Add index page',
      content: Buffer.from(indexHtml).toString('base64')
    });

    // Kích hoạt workflow lần đầu
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

    // Tạo link noVNC
    const novncUrl = `https://${username}.github.io/${repoName}/vnc.html`;

    return res.status(200).json({
      success: true,
      message: '✅ Đã tạo VPS thành công!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      novncUrl: novncUrl,
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
