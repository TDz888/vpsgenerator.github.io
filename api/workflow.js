// API xử lý GitHub Actions Workflow
const GITHUB_API = 'https://api.github.com';

// Tạo workflow content với username và password tùy chỉnh
function generateWorkflowContent(duration, username, password) {
  return `name: Create Windows VM

on:
  workflow_dispatch:
    inputs:
      tailscale_key:
        description: 'Tailscale Auth Key'
        required: true
        type: string
      vm_duration:
        description: 'VM Duration (hours)'
        required: false
        default: '${duration}'
        type: string

jobs:
  create-vm:
    runs-on: windows-latest
    timeout-minutes: 480
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Tailscale
        uses: tailscale/github-action@v2
        with:
          authkey: \${{ github.event.inputs.tailscale_key }}
      
      - name: Get Tailscale IP
        id: tailscale
        run: |
          $ip = (tailscale ip -4).Trim()
          echo "ip=$ip" >> $env:GITHUB_OUTPUT
          echo "Tailscale IP: $ip"
        shell: pwsh
      
      - name: Configure Windows RDP
        run: |
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name "UserAuthentication" -Value 0
          net user ${username} ${password} /add
          net localgroup Administrators ${username} /add
          net localgroup "Remote Desktop Users" ${username} /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
          Write-Host "✅ Windows RDP configured with user: ${username}"
        shell: pwsh
      
      - name: Setup noVNC
        run: |
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:3389"
          Write-Host "✅ noVNC started on port 6080"
        shell: pwsh
      
      - name: Display Connection Info
        run: |
          Write-Host "=================================================="
          Write-Host "WINDOWS VM READY"
          Write-Host "=================================================="
          Write-Host "Tailscale IP: \${{ steps.tailscale.outputs.ip }}"
          Write-Host "Username: ${username}"
          Write-Host "Password: ${password}"
          Write-Host "noVNC URL: http://\${{ steps.tailscale.outputs.ip }}:6080/vnc.html"
          Write-Host "=================================================="
        shell: pwsh
      
      - name: Keep VM Alive
        run: |
          $hours = [int]"\${{ github.event.inputs.vm_duration }}"
          if ($hours -eq 0) { $hours = ${duration} }
          $endTime = (Get-Date).AddHours($hours)
          Write-Host "VM will run for $hours hours, expires at: $endTime"
          while ((Get-Date) -lt $endTime) {
            $remaining = [math]::Round(($endTime - (Get-Date)).TotalMinutes)
            Write-Host "VM running... Expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
        shell: pwsh
`;
}

export async function createWorkflowFile(token, owner, repo, duration, username, password) {
  try {
    console.log(`📝 Creating workflow for ${owner}/${repo} with user: ${username}`);
    
    const workflowContent = generateWorkflowContent(duration, username, password);
    const path = '.github/workflows/create-vm.yml';
    
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow for VM creation',
        content: Buffer.from(workflowContent).toString('base64'),
        branch: 'main'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Workflow creation failed: ${response.status}`);
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    console.log(`✅ Workflow file created successfully`);
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return { success: true };
  } catch (error) {
    console.error('Create workflow error:', error);
    return { success: false, error: error.message };
  }
}

export async function triggerWorkflow(token, owner, repo, tailscaleKey, duration) {
  try {
    console.log(`🚀 Triggering workflow for ${owner}/${repo}`);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const triggerUrl = `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`;
    
    const response = await fetch(triggerUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          tailscale_key: tailscaleKey,
          vm_duration: duration.toString()
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Trigger failed: ${response.status}`);
      throw new Error(`Trigger workflow thất bại: ${response.status}`);
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
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=${perPage}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.workflow_runs || [];
  } catch (error) {
    console.error('Get workflow runs error:', error);
    return [];
  }
}

export default {
  createWorkflowFile,
  triggerWorkflow,
  getWorkflowRuns
};
