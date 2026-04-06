// API xử lý GitHub Actions Workflow - ĐÃ FIX LỖI 404
const GITHUB_API = 'https://api.github.com';

// Template workflow YAML
const WORKFLOW_TEMPLATE = `name: Create Windows VM

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
          $hours = 6
          $endTime = (Get-Date).AddHours($hours)
          Write-Host "VM will run for $hours hours, expires at: $endTime"
          while ((Get-Date) -lt $endTime) {
            $remaining = [math]::Round(($endTime - (Get-Date)).TotalMinutes)
            Write-Host "VM running... Expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }
        shell: pwsh
`;

// Hàm kiểm tra repository đã sẵn sàng chưa
async function waitForRepoReady(token, owner, repo, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        console.log(`✅ Repository ${owner}/${repo} is ready`);
        return true;
      }
    } catch (error) {
      console.log(`⏳ Waiting for repo... attempt ${i + 1}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  return false;
}

// Tạo workflow file - FIX: Đúng endpoint và có retry
export async function createWorkflowFile(token, owner, repo, duration = 6, username = 'runneradmin', password = 'VPS@123456') {
  try {
    console.log(`📝 Creating workflow for ${owner}/${repo}`);
    
    // Đợi repository sẵn sàng
    const isReady = await waitForRepoReady(token, owner, repo);
    if (!isReady) {
      throw new Error('Repository chưa sẵn sàng sau 20 giây');
    }
    
    // Thay thế username và password trong template
    let finalTemplate = WORKFLOW_TEMPLATE;
    finalTemplate = finalTemplate.replace(/runneradmin/g, username);
    finalTemplate = finalTemplate.replace(/VPS@123456/g, password);
    
    const path = '.github/workflows/create-vm.yml';
    const encodedContent = Buffer.from(finalTemplate).toString('base64');
    
    // Endpoint đúng theo GitHub API docs
    const url = `${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`;
    console.log(`🔗 PUT ${url}`);
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow for VM creation',
        content: encodedContent,
        branch: 'main'
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Workflow creation failed: ${response.status}`);
      console.error(`Error details: ${errorText}`);
      
      if (response.status === 404) {
        throw new Error('Repository không tồn tại hoặc token thiếu quyền "workflow". Vui lòng tạo token mới với quyền repo và workflow.');
      } else if (response.status === 403) {
        throw new Error('Token không có quyền ghi file. Cần quyền "contents:write" và "workflow".');
      } else if (response.status === 422) {
        throw new Error('Validation failed. Kiểm tra lại path và content.');
      }
      
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    console.log(`✅ Workflow file created: ${result.content?.path}`);
    
    // Đợi GitHub xử lý workflow
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    return { success: true, path: result.content?.path };
  } catch (error) {
    console.error('Create workflow error:', error);
    return { success: false, error: error.message };
  }
}

// Trigger workflow - FIX: Đúng endpoint và headers
export async function triggerWorkflow(token, owner, repo, tailscaleKey, duration = 6) {
  try {
    console.log(`🚀 Triggering workflow for ${owner}/${repo}`);
    
    // Đợi workflow file được GitHub nhận diện
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    const url = `${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`;
    console.log(`🔗 POST ${url}`);
    
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
          tailscale_key: tailscaleKey
        }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Trigger failed: ${response.status}`);
      console.error(`Error details: ${errorText}`);
      
      if (response.status === 404) {
        throw new Error('Workflow file không tồn tại. Vui lòng thử lại sau 10 giây.');
      } else if (response.status === 403) {
        throw new Error('Token không có quyền trigger workflow. Cần quyền "workflow".');
      }
      
      throw new Error(`HTTP ${response.status}: ${errorText}`);
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

// Kiểm tra workflow có tồn tại không
export async function workflowExists(token, owner, repo) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.workflows?.some(w => w.name === 'Create Windows VM' || w.path === '.github/workflows/create-vm.yml');
  } catch {
    return false;
  }
}

export default {
  createWorkflowFile,
  triggerWorkflow,
  getWorkflowRuns,
  workflowExists,
  WORKFLOW_TEMPLATE
};
