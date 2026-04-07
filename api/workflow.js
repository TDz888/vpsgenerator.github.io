// api/workflow.js - Xử lý GitHub Actions Workflow
const GITHUB_API = 'https://api.github.com';

const WORKFLOW_CONTENT = `name: Create Windows VM

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
          Write-Host "🔧 Installing Tailscale..."
          $url = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
          $installer = "$env:TEMP\\tailscale.exe"
          Invoke-WebRequest -Uri $url -OutFile $installer
          Start-Process -FilePath $installer -ArgumentList "/S" -Wait -NoNewWindow
          Write-Host "✅ Tailscale installed"
      
      - name: Connect Tailscale
        shell: pwsh
        run: |
          Write-Host "🔗 Connecting to Tailscale network..."
          & "C:\\Program Files\\Tailscale\\Tailscale.exe" up --auth-key "${{ github.event.inputs.tailscale_key }}"
          Start-Sleep -Seconds 15
          $ip = & "C:\\Program Files\\Tailscale\\Tailscale.exe" ip -4
          echo "TAILSCALE_IP=$ip" >> $env:GITHUB_ENV
          Write-Host "✅ Tailscale connected! IP: $ip"
      
      - name: Configure Windows RDP
        shell: pwsh
        run: |
          Write-Host "🖥️ Configuring Windows Remote Desktop..."
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name "UserAuthentication" -Value 0
          net user runneradmin VPS@123456 /add
          net localgroup Administrators runneradmin /add
          net localgroup "Remote Desktop Users" runneradmin /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
          Write-Host "✅ RDP configured with user: runneradmin"
      
      - name: Setup noVNC
        shell: pwsh
        run: |
          Write-Host "🌐 Installing noVNC..."
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          Write-Host "🚀 Starting noVNC server..."
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:3389"
          New-NetFirewallRule -DisplayName "noVNC" -Direction Inbound -Protocol TCP -LocalPort 6080 -Action Allow
          Write-Host "✅ noVNC started on port 6080"
      
      - name: Display Connection Info
        shell: pwsh
        run: |
          Write-Host "=================================================="
          Write-Host "🖥️ WINDOWS VM READY"
          Write-Host "=================================================="
          Write-Host "🔗 Tailscale IP: $env:TAILSCALE_IP"
          Write-Host "👤 Username: runneradmin"
          Write-Host "🔐 Password: VPS@123456"
          Write-Host "🌐 noVNC URL: http://$env:TAILSCALE_IP:6080/vnc.html"
          Write-Host "=================================================="
      
      - name: Keep VM Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          Write-Host "⏰ VM will run for 6 hours, expires at: $end"
          while ((Get-Date) -lt $end) {
            $remaining = [math]::Round(($end - (Get-Date)).TotalMinutes)
            Write-Host "⏳ VM running... expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
          Write-Host "⏰ VM expired. Shutting down..."
`;

async function waitForRepo(token, owner, repo, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        console.log(`✅ Repository ${owner}/${repo} is ready`);
        return true;
      }
    } catch(e) {}
    console.log(`⏳ Waiting for repo... attempt ${i + 1}/${maxAttempts}`);
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

export async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const ready = await waitForRepo(token, owner, repo);
    if (!ready) throw new Error('Repository chưa sẵn sàng sau 30 giây');
    
    const path = '.github/workflows/create-vm.yml';
    console.log(`📝 Creating workflow file: ${owner}/${repo}/${path}`);
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow for VM creation',
        content: Buffer.from(WORKFLOW_CONTENT).toString('base64'),
        branch: 'main'
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      console.error(`Workflow creation failed: ${res.status} - ${err}`);
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    
    console.log(`✅ Workflow file created successfully`);
    await new Promise(r => setTimeout(r, 5000));
    return { success: true };
  } catch (error) {
    console.error('Create workflow error:', error);
    return { success: false, error: error.message };
  }
}

export async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    console.log(`⏳ Waiting for workflow to be recognized...`);
    await new Promise(r => setTimeout(r, 8000));
    
    const url = `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`;
    console.log(`🚀 Triggering workflow: ${url}`);
    
    const payload = {
      ref: 'main',
      inputs: { tailscale_key: tailscaleKey }
    };
    
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!res.ok) {
      const err = await res.text();
      console.error(`Trigger failed: ${res.status} - ${err}`);
      
      if (res.status === 404) {
        throw new Error('Workflow file không tồn tại. Vui lòng thử lại sau vài giây.');
      }
      if (res.status === 422) {
        throw new Error(`Lỗi 422: ${err}. Kiểm tra lại payload hoặc quyền token.`);
      }
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    
    console.log(`✅ Workflow triggered successfully`);
    return { success: true };
  } catch (error) {
    console.error('Trigger workflow error:', error);
    return { success: false, error: error.message };
  }
}

export async function getWorkflowRuns(token, owner, repo, perPage = 5) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.workflow_runs || [];
  } catch { return []; }
}

export default { createWorkflowFile, triggerWorkflow, getWorkflowRuns };
