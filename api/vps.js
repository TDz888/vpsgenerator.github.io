// api/vps.js - Backend hoàn chỉnh, sửa lỗi module
const GITHUB_API = 'https://api.github.com';

// In-memory storage
let vms = global.vms || [];

// Hàm tạo tên repository
function generateRepoName() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `vm-${timestamp}-${random}`;
}

// Hàm lấy thông tin user GitHub
async function getGitHubUser(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) {
    return null;
  }
}

// Tạo repository
async function createRepository(token, name, description) {
  try {
    const cleanToken = token ? token.trim() : '';
    const cleanName = name ? name.trim() : '';
    
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: cleanName,
        description: description || 'Created by Singularity Cloud',
        private: false,
        auto_init: true
      })
    });
    
    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.message || `HTTP ${res.status}` };
    }
    return { success: true, repo: data, owner: data.owner?.login || 'unknown' };
  } catch(error) {
    return { success: false, error: error.message };
  }
}

// Xóa repository
async function deleteRepository(token, owner, repo) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.ok;
  } catch(error) {
    return false;
  }
}

// Tạo nội dung workflow
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

// Tạo workflow file
async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const workflowContent = generateWorkflowContent(username, password);
    const encodedContent = Buffer.from(workflowContent, 'utf-8').toString('base64');
    const path = '.github/workflows/create-vm.yml';
    
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add GitHub Actions workflow for VM creation',
        content: encodedContent,
        branch: 'main'
      })
    });
    
    if (!res.ok) {
      const err = await res.text();
      return { success: false, error: `HTTP ${res.status}: ${err.substring(0, 100)}` };
    }
    return { success: true };
  } catch(error) {
    return { success: false, error: error.message };
  }
}

// Trigger workflow
async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    await new Promise(r => setTimeout(r, 3000));
    
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
      return { success: false, error: `HTTP ${res.status}: ${err.substring(0, 100)}` };
    }
    return { success: true };
  } catch(error) {
    return { success: false, error: error.message };
  }
}

// Lấy workflow runs
async function getWorkflowRuns(token, owner, repo) {
  try {
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=1`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.workflow_runs || [];
  } catch(error) {
    return [];
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ 
      success: true, 
      vms: vms,
      stats: {
        total: vms.length,
        running: vms.filter(v => v.status === 'running').length
      }
    });
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const index = vms.findIndex(v => v.id === id);
    if (index !== -1) {
      vms.splice(index, 1);
      global.vms = vms;
    }
    return res.status(200).json({ success: true });
  }
  
  // POST - Tạo VM
  if (req.method === 'POST') {
    const body = req.body;
    const githubToken = body?.githubToken || '';
    const tailscaleKey = body?.tailscaleKey || '';
    let vmUsername = body?.vmUsername || '';
    let vmPassword = body?.vmPassword || '';
    
    if (!githubToken || githubToken.length < 5) {
      return res.status(200).json({ success: false, error: 'Vui lòng nhập GitHub Token' });
    }
    if (!tailscaleKey || tailscaleKey.length < 5) {
      return res.status(200).json({ success: false, error: 'Vui lòng nhập Tailscale Key' });
    }
    if (!vmUsername) vmUsername = 'user_' + Math.floor(Math.random() * 10000);
    if (!vmPassword) vmPassword = 'Pass@' + Math.random().toString(36).substring(2, 12);
    
    let owner = 'unknown';
    try {
      const userInfo = await getGitHubUser(githubToken);
      if (userInfo && userInfo.login) owner = userInfo.login;
    } catch(e) {}
    
    const repoName = generateRepoName();
    
    try {
      const repoResult = await createRepository(githubToken, repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(200).json({ success: false, error: repoResult.error });
      }
      if (repoResult.owner) owner = repoResult.owner;
      
      await new Promise(r => setTimeout(r, 4000));
      
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(githubToken, owner, repoName);
        return res.status(200).json({ success: false, error: workflowResult.error });
      }
      
      await new Promise(r => setTimeout(r, 4000));
      
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey);
      if (!triggerResult.success) {
        return res.status(200).json({ success: false, error: triggerResult.error });
      }
      
      let runId = null;
      try {
        await new Promise(r => setTimeout(r, 2000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName);
        if (runs && runs.length > 0) runId = runs[0].id;
      } catch(e) {}
      
      const newVM = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        name: repoName,
        owner: owner,
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: runId ? `https://github.com/${owner}/${repoName}/actions/runs/${runId}` : `https://github.com/${owner}/${repoName}/actions`,
        tailscaleIP: null,
        novncUrl: null,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      return res.status(200).json({ success: true, ...newVM });
      
    } catch(error) {
      return res.status(200).json({ success: false, error: error.message });
    }
  }
  
  return res.status(200).json({ success: false, error: 'Method not supported' });
}
