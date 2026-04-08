// api/vps.js - Backend đơn giản, không lỗi 500
let vms = global.vms || [];

function generateRepoName() {
  return 'vm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
}

function generateWorkflowContent(username, password) {
  return `name: Create Windows VM
on:
  workflow_dispatch:
    inputs:
      tailscale_key:
        description: 'Tailscale Auth Key'
        required: true
        type: string
jobs:
  create-vm:
    runs-on: windows-latest
    timeout-minutes: 480
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Install Tailscale
        shell: pwsh
        run: |
          Write-Host "Installing Tailscale..."
          $url = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
          $installer = "$env:TEMP\\tailscale.exe"
          Invoke-WebRequest -Uri $url -OutFile $installer
          Start-Process -FilePath $installer -ArgumentList "/S" -Wait -NoNewWindow
      - name: Connect Tailscale
        shell: pwsh
        run: |
          & "C:\\Program Files\\Tailscale\\Tailscale.exe" up --auth-key "${{ github.event.inputs.tailscale_key }}"
          Start-Sleep -Seconds 15
          $ip = & "C:\\Program Files\\Tailscale\\Tailscale.exe" ip -4
          echo "TAILSCALE_IP=$ip" >> $env:GITHUB_ENV
          Write-Host "Tailscale IP: $ip"
      - name: Configure Windows
        shell: pwsh
        run: |
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          net user ${username} ${password} /add
          net localgroup Administrators ${username} /add
          net localgroup "Remote Desktop Users" ${username} /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
      - name: Setup noVNC
        shell: pwsh
        run: |
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:3389"
          New-NetFirewallRule -DisplayName "noVNC" -Direction Inbound -Protocol TCP -LocalPort 6080 -Action Allow
      - name: Display Info
        shell: pwsh
        run: |
          Write-Host "=================================================="
          Write-Host "WINDOWS VM READY"
          Write-Host "Tailscale IP: $env:TAILSCALE_IP"
          Write-Host "Username: ${username}"
          Write-Host "Password: ${password}"
          Write-Host "noVNC URL: http://$env:TAILSCALE_IP:6080/vnc.html"
      - name: Keep Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $end) {
            $remaining = [math]::Round(($end - (Get-Date)).TotalMinutes)
            Write-Host "VM running... expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }`;
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    try {
      return res.status(200).json({ 
        success: true, 
        vms: vms || [],
        timestamp: Date.now()
      });
    } catch (err) {
      return res.status(200).json({ success: true, vms: [] });
    }
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (id) {
        vms = (vms || []).filter(v => v.id !== id);
        global.vms = vms;
      }
      return res.status(200).json({ success: true });
    } catch (err) {
      return res.status(200).json({ success: false, error: err.message });
    }
  }
  
  // POST - Tạo VM (DEMO MODE - để test API)
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const vmUsername = body.vmUsername || 'user_' + Math.floor(Math.random() * 10000);
      const vmPassword = body.vmPassword || 'Pass@' + Math.random().toString(36).substring(2, 12);
      
      // Tạo VM giả lập để test API
      const newVM = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        name: 'vm-demo-' + Date.now(),
        owner: 'demo',
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        repoUrl: 'https://github.com/demo/repo',
        workflowUrl: 'https://github.com/demo/repo/actions',
        message: 'DEMO MODE: API đang hoạt động! Để tạo VM thật, cần cấu hình GitHub token.'
      };
      
      vms = [newVM, ...(vms || [])];
      if (vms.length > 20) vms.pop();
      global.vms = vms;
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        note: 'DEMO MODE - API hoạt động bình thường'
      });
      
    } catch (err) {
      return res.status(200).json({ 
        success: false, 
        error: err.message 
      });
    }
  }
  
  return res.status(200).json({ success: false, error: 'Method not allowed' });
}
