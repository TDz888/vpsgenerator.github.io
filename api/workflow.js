// API xử lý GitHub Actions Workflow
const GITHUB_API = 'https://api.github.com';

// Template workflow YAML cho Windows VM - ĐÃ ĐƯỢC TỐI ƯU
const WORKFLOW_TEMPLATE = `name: Create Windows VM

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
          net user runneradmin VPS@123456 /add
          net localgroup Administrators runneradmin /add
          net localgroup "Remote Desktop Users" runneradmin /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
          Write-Host "✅ Windows RDP configured"
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
          Write-Host "Username: runneradmin"
          Write-Host "Password: VPS@123456"
          Write-Host "noVNC URL: http://\${{ steps.tailscale.outputs.ip }}:6080/vnc.html"
          Write-Host "=================================================="
        shell: pwsh
      
      - name: Keep VM Alive
        run: |
          $hours = [int]"\${{ github.event.inputs.vm_duration }}"
          if ($hours -eq 0) { $hours = 6 }
          $endTime = (Get-Date).AddHours($hours)
          Write-Host "VM will run for $hours hours, expires at: $endTime"
          while ((Get-Date) -lt $endTime) {
            $remaining = [math]::Round(($endTime - (Get-Date)).TotalMinutes)
            Write-Host "VM running... Expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
        shell: pwsh
`;

// Tạo workflow file trong repository - FIX: Đúng đường dẫn và chờ đợi
export async function createWorkflowFile(token, owner, repo, duration = 6) {
  try {
    const workflowContent = WORKFLOW_TEMPLATE;
    // ĐƯỜNG DẪN ĐÚNG: .github/workflows/create-vm.yml
    const path = '.github/workflows/create-vm.yml';
    
    console.log(`📝 Creating workflow file: ${owner}/${repo}/${path}`);
    
    // Tạo thư mục .github/workflows và file workflow
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
      console.error(`Workflow creation failed: ${response.status} - ${errorText}`);
      let errorMsg = 'Không thể tạo workflow file';
      try {
        const error = JSON.parse(errorText);
        errorMsg = error.message || errorMsg;
      } catch(e) {}
      throw new Error(errorMsg);
    }
    
    console.log(`✅ Workflow file created successfully: ${path}`);
    
    // Đợi GitHub xử lý file (quan trọng!)
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return { success: true };
  } catch (error) {
    console.error('Create workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Trigger workflow chạy - FIX: Đúng endpoint và chờ đợi
export async function triggerWorkflow(token, owner, repo, tailscaleKey, duration = 6) {
  try {
    // Đợi thêm 1 chút để GitHub nhận diện workflow
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const workflowPath = 'create-vm.yml';
    const url = `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${workflowPath}/dispatches`;
    
    console.log(`🚀 Triggering workflow: ${url}`);
    console.log(`📦 Inputs: tailscale_key=${tailscaleKey.substring(0, 10)}..., duration=${duration}`);
    
    const response = await fetch(url, {
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
      console.error(`Trigger workflow failed: ${response.status} - ${errorText}`);
      
      let errorMsg = 'Không thể trigger workflow';
      if (response.status === 404) {
        errorMsg = 'Workflow file không tồn tại. Vui lòng thử lại.';
      } else if (response.status === 401) {
        errorMsg = 'Token không có quyền trigger workflow. Cần quyền "actions:write"';
      } else if (response.status === 403) {
        errorMsg = 'Token không có quyền actions. Vui lòng tạo token mới với quyền "workflow"';
      }
      
      try {
        const error = JSON.parse(errorText);
        errorMsg = error.message || errorMsg;
      } catch(e) {}
      
      throw new Error(errorMsg);
    }
    
    console.log(`✅ Workflow triggered successfully`);
    return { success: true };
  } catch (error) {
    console.error('Trigger workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Lấy danh sách workflow runs
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

// Lấy chi tiết workflow run
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

export default {
  createWorkflowFile,
  triggerWorkflow,
  getWorkflowRuns,
  getWorkflowRunDetails,
  WORKFLOW_TEMPLATE
};
