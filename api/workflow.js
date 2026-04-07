// api/workflow.js
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
      
      - name: Setup Tailscale
        shell: pwsh
        run: |
          Write-Host "Installing Tailscale..."
          $url = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
          $installer = "$env:TEMP\\tailscale.exe"
          Invoke-WebRequest -Uri $url -OutFile $installer
          Start-Process -FilePath $installer -ArgumentList "/S" -Wait
          & "C:\\Program Files\\Tailscale\\Tailscale.exe" up --auth-key "${{ github.event.inputs.tailscale_key }}"
          Start-Sleep -Seconds 10
          $ip = & "C:\\Program Files\\Tailscale\\Tailscale.exe" ip -4
          echo "TAILSCALE_IP=$ip" >> $env:GITHUB_ENV
          Write-Host "Tailscale IP: $ip"
      
      - name: Configure Windows
        shell: pwsh
        run: |
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          net user runneradmin VPS@123456 /add
          net localgroup Administrators runneradmin /add
          net localgroup "Remote Desktop Users" runneradmin /add
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
          Write-Host "Username: runneradmin"
          Write-Host "Password: VPS@123456"
          Write-Host "noVNC URL: http://$env:TAILSCALE_IP:6080/vnc.html"
          Write-Host "=================================================="
      
      - name: Keep Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $end) {
            $remaining = [math]::Round(($end - (Get-Date)).TotalMinutes)
            Write-Host "VM running... expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
`;

async function waitForRepo(token, owner, repo, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) return true;
    } catch(e) {}
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

export async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const ready = await waitForRepo(token, owner, repo);
    if (!ready) throw new Error('Repository chưa sẵn sàng sau 20 giây');
    
    const path = '.github/workflows/create-vm.yml';
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow',
        content: Buffer.from(WORKFLOW_CONTENT).toString('base64'),
        branch: 'main'
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`HTTP ${res.status}: ${err}`);
    }
    
    await new Promise(r => setTimeout(r, 5000));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Trigger workflow với JSON đúng format
 * Lưu ý: Token PHẢI là Personal Access Token (PAT) có quyền workflow [citation:3]
 * Không dùng GITHUB_TOKEN mặc định vì không hoạt động với workflow_dispatch [citation:3]
 */
export async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    // Đợi GitHub nhận diện workflow file
    await new Promise(r => setTimeout(r, 8000));
    
    // Tạo payload đúng format - tránh lỗi JSON parsing [citation:7]
    const payload = {
      ref: 'main',
      inputs: {
        tailscale_key: tailscaleKey
      }
    };
    
    console.log(`🚀 Triggering workflow with payload:`, JSON.stringify(payload));
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
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
      console.error(`❌ Trigger failed: ${res.status} - ${err}`);
      
      if (res.status === 404) {
        throw new Error('Workflow file không tồn tại. Vui lòng thử lại sau vài giây.');
      }
      if (res.status === 422) {
        throw new Error(`Lỗi 422: ${err}. Kiểm tra lại payload JSON hoặc quyền token.`);
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
