const axios = require('axios');

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
  
  const { userToken, duration = '2h', target_os = 'windows' } = req.body;
  
  if (!userToken) {
    return res.status(400).json({ error: 'GitHub token is required' });
  }
  
  // Tạo tên repo ngẫu nhiên
  const timestamp = Date.now();
  const repoName = `vps-project-${timestamp}`;
  
  try {
    // 1. Lấy username từ token
    const userResp = await axios.get('https://api.github.com/user', {
      headers: { 'Authorization': `token ${userToken}` }
    });
    const username = userResp.data.login;
    
    // 2. Tạo repository mới
    await axios.post('https://api.github.com/user/repos', {
      name: repoName,
      description: 'VPS Project - Auto generated',
      private: false,
      auto_init: true
    }, {
      headers: {
        'Authorization': `token ${userToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    // 3. Tạo workflow file
    const workflowContent = generateWorkflowContent(repoName, duration);
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
    
    res.status(200).json({
      success: true,
      message: 'VPS creation started!',
      repoUrl: `https://github.com/${username}/${repoName}`,
      note: 'Check Actions tab for progress. VNC link will appear in remote-link.txt when ready.'
    });
    
  } catch (error) {
    console.error('Error:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data?.message || error.message
    });
  }
};

// Hàm tạo nội dung workflow file (dựa trên code người ta cung cấp)
function generateWorkflowContent(repoName, duration) {
  // Chuyển đổi duration sang phút
  let minutes = 120;
  if (duration === '30m') minutes = 30;
  else if (duration === '1h') minutes = 60;
  else if (duration === '2h') minutes = 120;
  else if (duration === '4h') minutes = 240;
  else if (duration === '6h') minutes = 360;
  
  const restartCheckpoint = minutes - 10;
  
  return `name: Create VPS (Auto Restart)

on:
  workflow_dispatch:
  repository_dispatch:
    types: [create-vps]

env:
  VPS_NAME: ${repoName}
  GITHUB_TOKEN_VPS: \${{ secrets.GITHUB_TOKEN }}

jobs:
  deploy:
    runs-on: windows-latest
    permissions:
      contents: write
      actions: write

    steps:
    - name: ⬇️ Checkout source
      uses: actions/checkout@v4
      with:
        token: \${{ secrets.GITHUB_TOKEN }}

    - name: 🖥️ Cài đặt và chạy TightVNC, noVNC, Cloudflared
      shell: pwsh
      run: |
        Write-Host "📥 Installing TightVNC, noVNC, and Cloudflared..."
        
        try {
          Write-Host "📥 Installing TightVNC..."
          Invoke-WebRequest -Uri "https://www.tightvnc.com/download/2.8.63/tightvnc-2.8.63-gpl-setup-64bit.msi" -OutFile "tightvnc-setup.msi" -TimeoutSec 60
          Start-Process msiexec.exe -Wait -ArgumentList '/i tightvnc-setup.msi /quiet /norestart ADDLOCAL="Server" SERVER_REGISTER_AS_SERVICE=1 SERVER_ADD_FIREWALL_EXCEPTION=1 SET_USEVNCAUTHENTICATION=1 VALUE_OF_USEVNCAUTHENTICATION=1 SET_PASSWORD=1 VALUE_OF_PASSWORD=vps123 SET_ACCEPTHTTPCONNECTIONS=1 VALUE_OF_ACCEPTHTTPCONNECTIONS=1 SET_ALLOWLOOPBACK=1 VALUE_OF_ALLOWLOOPBACK=1'
          Write-Host "✅ TightVNC installed"
          
          Set-ItemProperty -Path "HKLM:\\SOFTWARE\\TightVNC\\Server" -Name "AllowLoopback" -Value 1 -ErrorAction SilentlyContinue
          Stop-Process -Name "tvnserver" -Force -ErrorAction SilentlyContinue
          Stop-Service -Name "tvnserver" -Force -ErrorAction SilentlyContinue
          Start-Sleep -Seconds 5
          
          Write-Host "🚀 Starting TightVNC server..."
          Start-Process -FilePath "C:\\Program Files\\TightVNC\\tvnserver.exe" -ArgumentList "-run -localhost no" -WindowStyle Hidden
          Start-Sleep -Seconds 15
          
          netsh advfirewall firewall add rule name="Allow VNC 5900" dir=in action=allow protocol=TCP localport=5900
          netsh advfirewall firewall add rule name="Allow noVNC 6080" dir=in action=allow protocol=TCP localport=6080
          
          Write-Host "📥 Installing Python dependencies..."
          python -m pip install --upgrade pip --quiet
          pip install numpy novnc websockify==0.13.0 --quiet
          
          Write-Host "📥 Installing Cloudflared..."
          Invoke-WebRequest -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" -OutFile "cloudflared.exe" -TimeoutSec 60
          
          Write-Host "🚀 Starting websockify..."
          Start-Process -FilePath "python" -ArgumentList "-m", "websockify", "6080", "127.0.0.1:5900", "--web", "C:\\Python*\\Lib\\site-packages\\novnc" -NoNewWindow
          Start-Sleep -Seconds 10
          
          Write-Host "🌐 Starting Cloudflared tunnel..."
          Start-Process -FilePath "cloudflared.exe" -ArgumentList "tunnel", "--url", "http://localhost:6080", "--no-autoupdate", "--logfile", "cloudflared.log" -WindowStyle Hidden
          Start-Sleep -Seconds 30
          
          Write-Host "🌐 Retrieving Cloudflared URL..."
          $maxAttempts = 60
          $attempt = 0
          $cloudflaredUrl = ""
          
          do {
            $attempt++
            Start-Sleep -Seconds 2
            if (Test-Path "cloudflared.log") {
              $logContent = Get-Content "cloudflared.log" -Raw -ErrorAction SilentlyContinue
              if ($logContent -match 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com') {
                $cloudflaredUrl = $matches[0]
                break
              }
            }
          } while ($attempt -lt $maxAttempts)
          
          if ($cloudflaredUrl) {
            $remoteLink = "$cloudflaredUrl/vnc.html"
            Write-Host "🌌 Remote VNC URL: $remoteLink"
            $remoteLink | Out-File -FilePath "remote-link.txt" -Encoding UTF8 -NoNewline
            
            git config --global user.email "github-actions[bot]@users.noreply.github.com"
            git config --global user.name "github-actions[bot]"
            git add remote-link.txt
            git commit -m "🔗 Updated remote-link.txt" --allow-empty
            git push origin main
          } else {
            Write-Host "❌ Failed to retrieve Cloudflared URL"
            "TUNNEL_FAILED" | Out-File -FilePath "remote-link.txt" -Encoding UTF8
            git add remote-link.txt
            git commit -m "❌ Tunnel failed" --allow-empty
            git push origin main
          }
        } catch {
          Write-Host "⚠️ Setup failed: $_"
          exit 1
        }
        
        Write-Host "🚀 VPS Session Started"
        Write-Host "🔐 VNC Password: vps123"
        
        $totalMinutes = ${minutes}
        for ($i = 1; $i -le $totalMinutes; $i++) {
          Write-Host "🟢 VPS Running - Minute \$i/\$totalMinutes"
          Start-Sleep -Seconds 60
        }
        
        Write-Host "⏰ VPS session completed."

    - name: 🔄 Auto Restart Workflow
      if: always()
      run: |
        Write-Host "🔁 Workflow completed"
        # Không auto restart để tránh loop
`;
}
