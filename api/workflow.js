// api/workflow.js - Tạo và trigger GitHub Actions workflow
const GITHUB_API = 'https://api.github.com';

// Tạo nội dung workflow file
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
      
      - name: Install Python
        shell: pwsh
        run: |
          Write-Host "Installing Python..."
          $pythonUrl = "https://www.python.org/ftp/python/3.11.0/python-3.11.0-amd64.exe"
          $installer = "$env:TEMP\\python-installer.exe"
          Invoke-WebRequest -Uri $pythonUrl -OutFile $installer
          Start-Process -FilePath $installer -ArgumentList "/quiet InstallAllUsers=1 PrependPath=1" -Wait -NoNewWindow
          Write-Host "Python installed"
      
      - name: Install Tailscale
        shell: pwsh
        run: |
          Write-Host "Installing Tailscale..."
          $url = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
          $installer = "$env:TEMP\\tailscale.exe"
          Invoke-WebRequest -Uri $url -OutFile $installer
          Start-Process -FilePath $installer -ArgumentList "/S" -Wait -NoNewWindow
          Write-Host "Tailscale installed"
      
      - name: Connect Tailscale
        shell: pwsh
        run: |
          Write-Host "Connecting to Tailscale..."
          & "C:\\Program Files\\Tailscale\\Tailscale.exe" up --auth-key "${{ github.event.inputs.tailscale_key }}"
          Start-Sleep -Seconds 15
          $ip = & "C:\\Program Files\\Tailscale\\Tailscale.exe" ip -4
          echo "TAILSCALE_IP=$ip" >> $env:GITHUB_ENV
          Write-Host "Tailscale IP: $ip"
      
      - name: Configure Windows RDP
        shell: pwsh
        run: |
          Write-Host "Configuring Windows RDP..."
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name "UserAuthentication" -Value 0
          net user ${username} ${password} /add
          net localgroup Administrators ${username} /add
          net localgroup "Remote Desktop Users" ${username} /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
          Write-Host "RDP configured with user: ${username}"
      
      - name: Setup noVNC
        shell: pwsh
        run: |
          Write-Host "Setting up noVNC..."
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          Write-Host "Starting noVNC server..."
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:3389"
          New-NetFirewallRule -DisplayName "noVNC" -Direction Inbound -Protocol TCP -LocalPort 6080 -Action Allow
          Write-Host "noVNC started on port 6080"
      
      - name: Display Connection Info
        shell: pwsh
        run: |
          Write-Host "=================================================="
          Write-Host "WINDOWS VM READY"
          Write-Host "=================================================="
          Write-Host "Tailscale IP: $env:TAILSCALE_IP"
          Write-Host "Username: ${username}"
          Write-Host "Password: ${password}"
          Write-Host "noVNC URL: http://$env:TAILSCALE_IP:6080/vnc.html"
          Write-Host "=================================================="
      
      - name: Keep VM Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          Write-Host "VM will run for 6 hours, expires at: $end"
          while ((Get-Date) -lt $end) {
            $remaining = [math]::Round(($end - (Get-Date)).TotalMinutes)
            Write-Host "VM running... expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
          Write-Host "VM expired. Shutting down..."
`;
}

// Tạo workflow file trong repository
export async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const cleanToken = token ? token.trim() : '';
    const workflowContent = generateWorkflowContent(username, password);
    const encodedContent = Buffer.from(workflowContent, 'utf-8').toString('base64');
    const path = '.github/workflows/create-vm.yml';
    
    console.log(`📝 Creating workflow: ${owner}/${repo}/${path}`);
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow for VM creation',
        content: encodedContent,
        branch: 'main'
      })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      console.log(`❌ Create workflow failed: ${res.status}`);
      return { 
        success: false, 
        error: data.message || `HTTP ${res.status}: Không thể tạo workflow`
      };
    }
    
    console.log(`✅ Workflow file created`);
    return { success: true };
    
  } catch(error) {
    console.error('Create workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Trigger workflow (chạy GitHub Actions)
export async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    const cleanToken = token ? token.trim() : '';
    const cleanTailscale = tailscaleKey ? tailscaleKey.trim() : '';
    
    console.log(`🚀 Triggering workflow: ${owner}/${repo}`);
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          tailscale_key: cleanTailscale
        }
      })
    });
    
    if (!res.ok) {
      const text = await res.text();
      console.log(`❌ Trigger failed: ${res.status}`);
      return { 
        success: false, 
        error: `HTTP ${res.status}: ${text.substring(0, 100)}`
      };
    }
    
    console.log(`✅ Workflow triggered successfully`);
    return { success: true };
    
  } catch(error) {
    console.error('Trigger workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Lấy danh sách workflow runs
export async function getWorkflowRuns(token, owner, repo, perPage = 5) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.workflow_runs || [];
  } catch(error) {
    console.error('Get workflow runs error:', error);
    return [];
  }
}
