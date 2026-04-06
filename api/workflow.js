// API xử lý GitHub Actions Workflow
const GITHUB_API = 'https://api.github.com';

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
      - name: 📥 Checkout
        uses: actions/checkout@v4
      
      - name: 🔗 Install and Connect Tailscale
        shell: pwsh
        run: |
          Write-Host "📥 Downloading Tailscale..."
          $tailscaleUrl = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
          $installerPath = "$env:TEMP\\tailscale-installer.exe"
          Invoke-WebRequest -Uri $tailscaleUrl -OutFile $installerPath
          Start-Process -FilePath $installerPath -ArgumentList "/S" -Wait -NoNewWindow
          & "C:\\Program Files\\Tailscale\\Tailscale.exe" up --auth-key "${{ github.event.inputs.tailscale_key }}"
          Start-Sleep -Seconds 15
          $tailscaleIp = & "C:\\Program Files\\Tailscale\\Tailscale.exe" ip -4
          echo "TAILSCALE_IP=$tailscaleIp" >> $env:GITHUB_ENV
      
      - name: 🖥️ Configure Windows
        shell: pwsh
        run: |
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name "UserAuthentication" -Value 0
          net user ${username} ${password} /add
          net localgroup Administrators ${username} /add
          net localgroup "Remote Desktop Users" ${username} /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
      
      - name: 🖥️ Setup TightVNC
        shell: pwsh
        run: |
          $tightVncUrl = "https://www.tightvnc.com/download/2.8.81/tightvnc-2.8.81-gpl-setup-64bit.msi"
          $installerPath = "$env:TEMP\\tightvnc-installer.msi"
          Invoke-WebRequest -Uri $tightVncUrl -OutFile $installerPath
          Start-Process -FilePath "msiexec.exe" -ArgumentList "/i \`"$installerPath\`" /quiet /norestart" -Wait -NoNewWindow
          & "C:\\Program Files\\TightVNC\\tvnserver.exe" -controlservice -setpasswd ${password}
          & "C:\\Program Files\\TightVNC\\tvnserver.exe" -controlservice -start
          New-NetFirewallRule -DisplayName "VNC" -Direction Inbound -Protocol TCP -LocalPort 5900 -Action Allow
      
      - name: 🌐 Setup noVNC
        shell: pwsh
        run: |
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:5900"
          New-NetFirewallRule -DisplayName "noVNC" -Direction Inbound -Protocol TCP -LocalPort 6080 -Action Allow
      
      - name: 📢 Display Info
        shell: pwsh
        run: |
          Write-Host "=================================================="
          Write-Host "WINDOWS VM READY"
          Write-Host "Tailscale IP: $env:TAILSCALE_IP"
          Write-Host "Username: ${username}"
          Write-Host "Password: ${password}"
          Write-Host "noVNC URL: http://$env:TAILSCALE_IP:6080/vnc.html"
          Write-Host "=================================================="
      
      - name: ⏱️ Keep Alive
        shell: pwsh
        run: |
          \$endTime = (Get-Date).AddHours(6)
          while ((Get-Date) -lt \$endTime) {
            \$remaining = [math]::Round((\$endTime - (Get-Date)).TotalMinutes)
            Write-Host "VM running... Expires in \$remaining minutes"
            Start-Sleep -Seconds 300
          }
  `;
}

async function waitForRepoReady(token, owner, repo, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) return true;
    } catch(e) {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

export async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const isReady = await waitForRepoReady(token, owner, repo);
    if (!isReady) throw new Error('Repository chưa sẵn sàng');
    
    const content = generateWorkflowContent(username, password);
    const path = '.github/workflows/create-vm.yml';
    
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow',
        content: Buffer.from(content).toString('base64'),
        branch: 'main'
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    await new Promise(r => setTimeout(r, 5000));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function triggerWorkflow(token, owner, repo, tailscaleKey, username, password) {
  try {
    await new Promise(r => setTimeout(r, 8000));
    
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { tailscale_key: tailscaleKey }
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`HTTP ${response.status}: ${error}`);
    }
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getWorkflowRuns(token, owner, repo, perPage = 5) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.workflow_runs || [];
  } catch {
    return [];
  }
}

export default { createWorkflowFile, triggerWorkflow, getWorkflowRuns };
