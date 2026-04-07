// api/workflow.js - Simplified
const GITHUB_API = 'https://api.github.com';

function getWorkflowContent(username, password) {
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
          Start-Sleep -Seconds 10
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
          Write-Host "User ${username} created"
      
      - name: Keep Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $end) {
            Write-Host "VM running... expires in $([math]::Round(($end - (Get-Date)).TotalMinutes)) minutes"
            Start-Sleep -Seconds 300
          }
`;
}

export async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const content = getWorkflowContent(username, password);
    const encoded = Buffer.from(content).toString('base64');
    const path = '.github/workflows/create-vm.yml';
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add workflow',
        content: encoded,
        branch: 'main'
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${err}` };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    // Wait for GitHub to index
    await new Promise(r => setTimeout(r, 5000));
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: { tailscale_key: tailscaleKey }
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${err}` };
    }
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function getWorkflowRuns(token, owner, repo) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.workflow_runs || [];
  } catch {
    return [];
  }
}
