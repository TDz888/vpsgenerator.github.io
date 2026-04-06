// API xử lý VPS - Tự động tạo repo, workflow và trigger
const GITHUB_API = 'https://api.github.com';
let vms = global.vms || [];

// Workflow template YAML
const WORKFLOW_TEMPLATE = `name: Create Windows VPS

on:
  workflow_dispatch:
    inputs:
      tailscale_key:
        description: 'Tailscale Auth Key'
        required: true
        type: string

jobs:
  setup-vm:
    runs-on: windows-latest
    timeout-minutes: 360
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      
      - name: Setup Tailscale
        uses: tailscale/github-action@v2
        with:
          authkey: \${{ inputs.tailscale_key }}
      
      - name: Get Tailscale IP
        id: tailscale
        run: |
          \$ip = (tailscale ip -4).Trim()
          echo "ip=\$ip" >> \$env:GITHUB_OUTPUT
        shell: pwsh
      
      - name: Setup Windows
        run: |
          # Enable RDP
          Set-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server" -Name "fDenyTSConnections" -Value 0
          # Create user
          net user runneradmin VPS@123456 /add
          net localgroup Administrators runneradmin /add
          net localgroup "Remote Desktop Users" runneradmin /add
          # Firewall
          New-NetFirewallRule -DisplayName "RDP" -Direction Inbound -Protocol TCP -LocalPort 3389 -Action Allow
        shell: pwsh
      
      - name: Keep VM Alive
        run: |
          \$hours = {DURATION}
          \$endTime = (Get-Date).AddHours(\$hours)
          while ((Get-Date) -lt \$endTime) {
            Write-Host "VM running... Uptime remaining: \$([math]::Round((\$endTime - (Get-Date)).TotalMinutes)) minutes"
            Start-Sleep -Seconds 300
          }
        shell: pwsh
`;

// Tạo repository mới
async function createRepo(githubToken, repoName) {
  try {
    const response = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        description: 'VM created by Singularity Cloud',
        private: false,
        auto_init: true
      })
    });
    return response.ok;
  } catch (error) {
    console.error('Create repo error:', error);
    return false;
  }
}

// Tạo file workflow trong repository
async function createWorkflowFile(githubToken, repoName, tailscaleKey, duration) {
  const workflowContent = WORKFLOW_TEMPLATE.replace('{DURATION}', duration);
  
  try {
    // Tạo thư mục .github/workflows
    const response = await fetch(`${GITHUB_API}/repos/${repoName}/${repoName}/contents/.github/workflows/create-vm.yml`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'Add VM workflow',
        content: Buffer.from(workflowContent).toString('base64')
      })
    });
    return response.ok;
  } catch (error) {
    console.error('Create workflow error:', error);
    return false;
  }
}

// Trigger workflow
async function triggerWorkflow(githubToken, repoName, tailscaleKey) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${repoName}/${repoName}/actions/workflows/create-vm.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
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
    return response.ok;
  } catch (error) {
    console.error('Trigger workflow error:', error);
    return false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  // POST - Tạo VM mới (tự động tạo repo + workflow)
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, config, duration } = req.body;
    
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ success: false, error: 'Thiếu token hoặc key' });
    }
    
    const repoName = `vm-${Date.now()}`;
    const vmConfigs = {
      basic: { cpu: '2 cores', ram: '7 GB', storage: '14 GB' },
      standard: { cpu: '4 cores', ram: '14 GB', storage: '28 GB' },
      premium: { cpu: '8 cores', ram: '16 GB', storage: '56 GB' }
    };
    const selectedConfig = vmConfigs[config] || vmConfigs.basic;
    
    // Step 1: Tạo repository
    const repoCreated = await createRepo(githubToken, repoName);
    if (!repoCreated) {
      return res.status(500).json({ success: false, error: 'Không thể tạo repository' });
    }
    
    // Step 2: Tạo file workflow
    const workflowCreated = await createWorkflowFile(githubToken, repoName, tailscaleKey, duration);
    if (!workflowCreated) {
      return res.status(500).json({ success: false, error: 'Không thể tạo workflow file' });
    }
    
    // Step 3: Trigger workflow
    const workflowTriggered = await triggerWorkflow(githubToken, repoName, tailscaleKey);
    if (!workflowTriggered) {
      return res.status(500).json({ success: false, error: 'Không thể trigger workflow' });
    }
    
    // Tạo VM record
    const newVM = {
      id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: repoName,
      status: 'creating',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + duration * 60 * 60 * 1000).toISOString(),
      username: 'runneradmin',
      password: 'VPS@123456',
      tailscaleIP: null,
      novncUrl: null,
      repoUrl: `https://github.com/${repoName}/${repoName}`,
      cpu: selectedConfig.cpu,
      ram: selectedConfig.ram,
      storage: selectedConfig.storage,
      duration: duration,
      config: config
    };
    
    vms.unshift(newVM);
    global.vms = vms;
    if (vms.length > 20) vms.pop();
    
    return res.status(200).json({ 
      success: true, 
      ...newVM,
      message: 'Repository và workflow đã được tạo. VM đang được khởi tạo trong GitHub Actions.'
    });
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const index = vms.findIndex(vm => vm.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy VM' });
    }
    vms.splice(index, 1);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
