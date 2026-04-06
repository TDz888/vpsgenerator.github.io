// API xử lý GitHub Actions Workflow
const GITHUB_API = 'https://api.github.com';

// Template workflow YAML cho Windows VM
const WORKFLOW_TEMPLATE = `name: Create Windows Virtual Machine

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
        default: '6'
        type: string

jobs:
  create-vm:
    runs-on: windows-latest
    timeout-minutes: 480
    
    steps:
      - name: 📥 Checkout Repository
        uses: actions/checkout@v4
      
      - name: 🔗 Setup Tailscale VPN
        uses: tailscale/github-action@v2
        with:
          authkey: \${{ github.event.inputs.tailscale_key }}
          version: 1.58.0
      
      - name: 🌐 Get Tailscale IP
        id: tailscale
        run: |
          $ip = (tailscale ip -4).Trim()
          echo "ip=$ip" >> $env:GITHUB_OUTPUT
          echo "Tailscale IP: $ip"
        shell: pwsh
      
      - name: 🖥️ Configure Windows RDP
        run: |
          # Enable Remote Desktop
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp" -Name "UserAuthentication" -Value 0
          
          # Create user account
          net user runneradmin VPS@123456 /add
          net localgroup Administrators runneradmin /add
          net localgroup "Remote Desktop Users" runneradmin /add
          
          # Configure firewall
          New-NetFirewallRule -DisplayName "RDP Port" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
          New-NetFirewallRule -DisplayName "HTTP noVNC" -Direction Inbound -Protocol TCP -LocalPort 6080 -Action Allow
          
          Write-Host "✅ Windows RDP configured successfully"
        shell: pwsh
      
      - name: 🌐 Setup noVNC Web Access
        run: |
          # Install noVNC
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          
          # Start noVNC in background
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:3389"
          
          Write-Host "✅ noVNC started on port 6080"
        shell: pwsh
      
      - name: 📢 Display Connection Information
        run: |
          Write-Host "=================================================="
          Write-Host "🖥️ WINDOWS VIRTUAL MACHINE READY"
          Write-Host "=================================================="
          Write-Host "🔗 Tailscale IP: \${{ steps.tailscale.outputs.ip }}"
          Write-Host "👤 Username: runneradmin"
          Write-Host "🔐 Password: VPS@123456"
          Write-Host ""
          Write-Host "🌐 noVNC URL: http://\${{ steps.tailscale.outputs.ip }}:6080/vnc.html"
          Write-Host "=================================================="
        shell: pwsh
      
      - name: ⏱️ Keep VM Alive
        run: |
          $hours = [int]"\${{ github.event.inputs.vm_duration }}"
          if ($hours -eq 0) { $hours = 6 }
          $endTime = (Get-Date).AddHours($hours)
          Write-Host "VM will run for $hours hours"
          Write-Host "Will expire at: $endTime"
          
          while ((Get-Date) -lt $endTime) {
            $remaining = [math]::Round(($endTime - (Get-Date)).TotalMinutes)
            Write-Host "⏰ VM running... Expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
          
          Write-Host "⏰ VM time expired. Shutting down..."
        shell: pwsh
      
      - name: 🧹 Cleanup
        if: always()
        run: |
          Write-Host "Cleaning up resources..."
        shell: pwsh
`;

// Tạo workflow file trong repository
export async function createWorkflowFile(token, owner, repo, duration = 6) {
  try {
    const workflowContent = WORKFLOW_TEMPLATE;
    const path = '.github/workflows/create-vm.yml';
    
    // Tạo thư mục .github/workflows trước
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
      const error = await response.json();
      throw new Error(error.message || 'Không thể tạo workflow file');
    }
    
    return { success: true };
  } catch (error) {
    console.error('Create workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Trigger workflow chạy
export async function triggerWorkflow(token, owner, repo, tailscaleKey, duration = 6) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
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
      const error = await response.json();
      throw new Error(error.message || 'Không thể trigger workflow');
    }
    
    return { success: true };
  } catch (error) {
    console.error('Trigger workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Lấy trạng thái workflow run
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

// Lấy chi tiết một workflow run
export async function getWorkflowRunDetails(token, owner, repo, runId) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${runId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Get workflow details error:', error);
    return null;
  }
}

// Lấy logs của workflow run
export async function getWorkflowLogs(token, owner, repo, runId) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${runId}/logs`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    return await response.text();
  } catch (error) {
    console.error('Get workflow logs error:', error);
    return null;
  }
}

// Hủy workflow run đang chạy
export async function cancelWorkflowRun(token, owner, repo, runId) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs/${runId}/cancel`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  } catch (error) {
    console.error('Cancel workflow error:', error);
    return false;
  }
}

// Kiểm tra workflow có đang chạy không
export async function isWorkflowRunning(token, owner, repo) {
  try {
    const runs = await getWorkflowRuns(token, owner, repo, 1);
    if (runs.length === 0) return false;
    const latestRun = runs[0];
    return ['queued', 'in_progress', 'waiting'].includes(latestRun.status);
  } catch {
    return false;
  }
}

export default {
  createWorkflowFile,
  triggerWorkflow,
  getWorkflowRuns,
  getWorkflowRunDetails,
  getWorkflowLogs,
  cancelWorkflowRun,
  isWorkflowRunning,
  WORKFLOW_TEMPLATE
};
