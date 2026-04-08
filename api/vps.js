// api/vps.js - Backend hoàn chỉnh, KHÔNG pattern validation
const GITHUB_API = 'https://api.github.com';
let vms = global.vms || [];

function generateRepoName() {
  return 'vm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 10);
}

async function getGitHubUser(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) { return null; }
}

async function createRepository(token, name, description) {
  try {
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description: description || 'Created by Singularity Cloud', private: false, auto_init: true })
    });
    const data = await res.json();
    if (!res.ok) return { success: false, error: data.message || `HTTP ${res.status}` };
    return { success: true, repo: data, owner: data.owner?.login || 'unknown' };
  } catch(e) { return { success: false, error: e.message }; }
}

async function deleteRepository(token, owner, repo) {
  try {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
    return true;
  } catch(e) { return false; }
}

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
          Start-Sleep -Seconds 15
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
          Write-Host "Username: ${username}"
          Write-Host "Password: ${password}"
          Write-Host "noVNC URL: http://$env:TAILSCALE_IP:6080/vnc.html"
      - name: Keep Alive
        shell: pwsh
        run: |
          $end = (Get-Date).AddHours(6)
          while ((Get-Date) -lt $end) {
            $remaining = [math]::Round(($end - (Get-Date)).TotalMinutes)
            Write-Host "VM running... expires in $remaining minutes"
            Start-Sleep -Seconds 300
          }`;
}

async function createWorkflowFile(token, owner, repo, username, password) {
  try {
    const content = generateWorkflowContent(username, password);
    const encoded = Buffer.from(content, 'utf-8').toString('base64');
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/.github/workflows/create-vm.yml`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Add workflow', content: encoded, branch: 'main' })
    });
    if (!res.ok) { const err = await res.text(); return { success: false, error: `HTTP ${res.status}` }; }
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

async function triggerWorkflow(token, owner, repo, tailscaleKey) {
  try {
    await new Promise(r => setTimeout(r, 4000));
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main', inputs: { tailscale_key: tailscaleKey } })
    });
    if (!res.ok) { const err = await res.text(); return { success: false, error: `HTTP ${res.status}` }; }
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  if (req.method === 'DELETE') {
    const { id } = req.query;
    vms = vms.filter(v => v.id !== id);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    if (!githubToken) return res.status(200).json({ success: false, error: 'Thiếu GitHub Token' });
    if (!tailscaleKey) return res.status(200).json({ success: false, error: 'Thiếu Tailscale Key' });
    
    let username = vmUsername || 'user_' + Math.floor(Math.random() * 10000);
    let password = vmPassword || 'P@ssw0rd!' + Math.random().toString(36).substring(2, 10);
    
    let owner = 'unknown';
    try {
      const user = await getGitHubUser(githubToken);
      if (user && user.login) owner = user.login;
    } catch(e) {}
    
    const repoName = generateRepoName();
    
    try {
      const repoResult = await createRepository(githubToken, repoName, `VM by ${username}`);
      if (!repoResult.success) return res.status(200).json({ success: false, error: repoResult.error });
      if (repoResult.owner) owner = repoResult.owner;
      
      await new Promise(r => setTimeout(r, 3000));
      
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, username, password);
      if (!workflowResult.success) {
        await deleteRepository(githubToken, owner, repoName);
        return res.status(200).json({ success: false, error: workflowResult.error });
      }
      
      await new Promise(r => setTimeout(r, 3000));
      
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey);
      if (!triggerResult.success) return res.status(200).json({ success: false, error: triggerResult.error });
      
      const newVM = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8),
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
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      return res.status(200).json({ success: true, ...newVM });
    } catch(e) {
      return res.status(200).json({ success: false, error: e.message });
    }
  }
  
  return res.status(200).json({ success: false, error: 'Method not supported' });
}
