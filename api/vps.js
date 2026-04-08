// api/vps.js - TẤT CẢ TRONG MỘT FILE, không import
let vms = global.vms || [];

// ========== HÀM GITHUB ==========
async function validateGitHubToken(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return { valid: false, error: 'Token invalid' };
    const user = await res.json();
    return { valid: true, user: user };
  } catch(e) {
    return { valid: false, error: e.message };
  }
}

async function createRepository(token, name, description) {
  try {
    const res = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        description: description || 'Created by Singularity',
        private: false,
        auto_init: true
      })
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.message };
    return { success: true, repo: data, owner: data.owner?.login };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

async function deleteRepository(token, owner, repo) {
  try {
    await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return true;
  } catch(e) {
    return false;
  }
}

// ========== HÀM WORKFLOW ==========
function getWorkflowContent(username, password) {
  return `name: Create Windows VM
on:
  workflow_dispatch:
    inputs:
      tailscale_key:
        description: 'Tailscale Key'
        required: true
        type: string
jobs:
  create-vm:
    runs-on: windows-latest
    timeout-minutes: 480
    steps:
      - uses: actions/checkout@v4
      - name: Install Tailscale
        shell: pwsh
        run: |
          $url = "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe"
          $installer = "$env:TEMP\\tailscale.exe"
          Invoke-WebRequest -Uri $url -OutFile $installer
          Start-Process -FilePath $installer -ArgumentList "/S" -Wait -NoNewWindow
      - name: Connect Tailscale
        shell: pwsh
        run: |
          & "C:\\Program Files\\Tailscale\\Tailscale.exe" up --auth-key "${{ github.event.inputs.tailscale_key }}"
          Start-Sleep -Seconds 15
          $ip = & "C:\\Program Files\\Tailscale\\Tailscale.exe" ip -4
          echo "TAILSCALE_IP=$ip" >> $env:GITHUB_ENV
      - name: Setup Windows
        shell: pwsh
        run: |
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          net user ${username} ${password} /add
          net localgroup Administrators ${username} /add
          net localgroup "Remote Desktop Users" ${username} /add
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
      - name: Setup noVNC
        shell: pwsh
        run: |
          git clone https://github.com/novnc/noVNC.git C:\\novnc
          git clone https://github.com/novnc/websockify.git C:\\websockify
          Start-Process -NoNewWindow -FilePath python -ArgumentList "C:\\websockify\\websockify.py", "--web=C:\\novnc", "6080", "localhost:3389"
          New-NetFirewallRule -DisplayName "noVNC" -Direction Inbound -Protocol TCP -LocalPort 6080 -Action Allow
      - name: Keep Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $end) {
            Write-Host "VM running... expires in $([math]::Round(($end - (Get-Date)).TotalMinutes)) minutes"
            Start-Sleep -Seconds 300
          }`;
}

async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const content = getWorkflowContent(username, password);
    const encoded = Buffer.from(content).toString('base64');
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/.github/workflows/create-vm.yml`, {
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
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    await new Promise(r => setTimeout(r, 3000));
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
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
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function generateRepoName() {
  return 'vm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
}

// ========== MAIN HANDLER ==========
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    try {
      return res.status(200).json({ success: true, vms: vms || [] });
    } catch(e) {
      return res.status(200).json({ success: true, vms: [] });
    }
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    try {
      const { id } = req.query;
      if (id) {
        vms = (vms || []).filter(v => v.id !== id);
        global.vms = vms;
      }
      return res.status(200).json({ success: true });
    } catch(e) {
      return res.status(200).json({ success: false });
    }
  }
  
  // POST - Tạo VM
  if (req.method === 'POST') {
    try {
      const body = req.body || {};
      const { githubToken, tailscaleKey, vmUsername, vmPassword } = body;
      
      if (!githubToken) {
        return res.status(200).json({ success: false, error: 'Thiếu GitHub Token' });
      }
      if (!tailscaleKey) {
        return res.status(200).json({ success: false, error: 'Thiếu Tailscale Key' });
      }
      
      const username = vmUsername || 'user_' + Math.floor(Math.random() * 10000);
      const password = vmPassword || 'Pass@' + Math.random().toString(36).substring(2, 12);
      
      // Validate token
      const tokenValid = await validateGitHubToken(githubToken);
      if (!tokenValid.valid) {
        return res.status(200).json({ success: false, error: tokenValid.error });
      }
      
      const owner = tokenValid.user.login;
      const repoName = generateRepoName();
      
      // Tạo repository
      const repoResult = await createRepository(githubToken, repoName, `VM by ${username}`);
      if (!repoResult.success) {
        return res.status(200).json({ success: false, error: repoResult.error });
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      // Tạo workflow
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, username, password);
      if (!workflowResult.success) {
        await deleteRepository(githubToken, owner, repoName);
        return res.status(200).json({ success: false, error: workflowResult.error });
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      // Trigger workflow
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey);
      if (!triggerResult.success) {
        return res.status(200).json({ success: false, error: triggerResult.error });
      }
      
      const newVM = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 6),
        name: repoName,
        owner: owner,
        username: username,
        password: password,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: `https://github.com/${owner}/${repoName}/actions`,
        tailscaleIP: null,
        novncUrl: null
      };
      
      vms = [newVM, ...(vms || [])];
      if (vms.length > 20) vms.pop();
      global.vms = vms;
      
      return res.status(200).json({ success: true, ...newVM });
      
    } catch(error) {
      console.error('Error:', error);
      return res.status(200).json({ success: false, error: error.message });
    }
  }
  
  return res.status(200).json({ success: false, error: 'Method not allowed' });
}
