const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Xử lý preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Chỉ cho phép POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  // Lấy token từ body request
  const { userToken, duration = '2h', target_os = 'windows' } = req.body;
  
  // Kiểm tra token có tồn tại không
  if (!userToken) {
    return res.status(400).json({ error: 'GitHub token is required' });
  }
  
  // Đọc file YML mẫu (nếu có)
  let workflowTemplate = '';
  try {
    const templatePath = path.join(__dirname, '../templates/workflow-template.yml');
    if (fs.existsSync(templatePath)) {
      workflowTemplate = fs.readFileSync(templatePath, 'utf8');
    } else {
      // Nếu không có file template, dùng template mặc định
      workflowTemplate = getDefaultWorkflowTemplate();
    }
  } catch (err) {
    console.log('Template path error, using default template');
    workflowTemplate = getDefaultWorkflowTemplate();
  }
  
  // Tính thời gian chạy dựa trên duration
  let minutes = 120;
  if (duration === '30m') minutes = 30;
  else if (duration === '1h') minutes = 60;
  else if (duration === '2h') minutes = 120;
  else if (duration === '4h') minutes = 240;
  else if (duration === '6h') minutes = 360;
  
  // Thay thế thời gian trong template
  const workflowContent = workflowTemplate.replace(/330/g, minutes.toString());
  
  // Tạo tên repo ngẫu nhiên
  const timestamp = Date.now();
  const repoName = `vps-${timestamp}`;
  
  try {
    // 1. Lấy username từ token
    console.log('Verifying token...');
    const userResp = await axios.get('https://api.github.com/user', {
      headers: { 'Authorization': `token ${userToken}` }
    });
    const username = userResp.data.login;
    console.log(`Authenticated as: ${username}`);
    
    // 2. Tạo repository mới
    console.log(`Creating repository: ${repoName}`);
    await axios.post('https://api.github.com/user/repos', {
      name: repoName,
      description: 'VPS Generator - Temporary Windows VM',
      private: false,
      auto_init: true
    }, {
      headers: {
        'Authorization': `token ${userToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    // 3. Tạo thư mục .github/workflows và file workflow
    console.log('Creating workflow file...');
    const encodedContent = Buffer.from(workflowContent).toString('base64');
    
    await axios.put(
      `https://api.github.com/repos/${username}/${repoName}/contents/.github/workflows/create-vps.yml`,
      {
        message: 'Add VPS workflow',
        content: encodedContent,
        branch: 'main'
      },
      {
        headers: {
          'Authorization': `token ${userToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    // 4. Trigger workflow chạy
    console.log('Triggering workflow...');
    await axios.post(
      `https://api.github.com/repos/${username}/${repoName}/actions/workflows/create-vps.yml/dispatches`,
      { ref: 'main' },
      {
        headers: {
          'Authorization': `token ${userToken}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    // 5. Trả về kết quả thành công
    res.status(200).json({
      success: true,
      message: 'VPS creation started!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      actionsUrl: `https://github.com/${username}/${repoName}/actions`,
      vncPassword: 'vps123',
      note: 'VNC link will appear in vnc-link.txt when ready (2-3 minutes)'
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
};

// Hàm template mặc định (nếu không có file template)
function getDefaultWorkflowTemplate() {
  return `name: Create VPS

on:
  workflow_dispatch:

jobs:
  deploy:
    runs-on: windows-latest
    permissions:
      contents: write

    steps:
    - name: Checkout
      uses: actions/checkout@v4

    - name: Setup VNC + noVNC + Cloudflare
      shell: pwsh
      run: |
        Write-Host "=== Installing TightVNC ==="
        Invoke-WebRequest -Uri "https://www.tightvnc.com/download/2.8.63/tightvnc-2.8.63-gpl-setup-64bit.msi" -OutFile "tightvnc.msi"
        Start-Process msiexec.exe -Wait -ArgumentList '/i tightvnc.msi /quiet /norestart ADDLOCAL="Server" SET_PASSWORD=1 VALUE_OF_PASSWORD=vps123'
        
        Write-Host "=== Starting VNC Server ==="
        Start-Process "C:\\Program Files\\TightVNC\\tvnserver.exe" -ArgumentList "-run"
        Start-Sleep 10
        
        Write-Host "=== Installing Cloudflared ==="
        Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe"
        
        Write-Host "=== Starting Tunnel ==="
        Start-Process -FilePath "cloudflared.exe" -ArgumentList "tunnel", "--url", "http://localhost:5900", "--logfile", "tunnel.log" -WindowStyle Hidden
        
        Write-Host "=== Getting URL ==="
        for ($i = 1; $i -le 60; $i++) {
          Start-Sleep 2
          if (Test-Path "tunnel.log") {
            $log = Get-Content "tunnel.log" -Raw
            if ($log -match 'https://([a-z0-9-]+\.trycloudflare\.com)') {
              $url = $matches[0]
              Write-Host "VNC URL: $url"
              $url | Out-File -FilePath "vnc-link.txt"
              break
            }
          }
        }
        
        git config user.email "actions@github.com"
        git config user.name "GitHub Actions"
        git add vnc-link.txt
        git commit -m "Add VNC link" --allow-empty
        git push origin main
        
        for ($i = 1; $i -le 330; $i++) {
          Write-Host "VPS Running - Minute $i/330"
          Start-Sleep 60
        }`;
}
