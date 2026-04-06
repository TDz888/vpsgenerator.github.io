const { Octokit } = require('@octokit/rest');

const DATA_REPO_OWNER = 'TDz888';
const DATA_REPO_NAME = 'vpsgenerator.github.io';
const VM_DATA_PATH = 'vms-data.json';

let vmsCache = [];
let fileSha = null;

function generateVMId() {
  return `vps-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function getExpiryTime() {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 6);
  return expiry.toISOString();
}

async function loadVMsFromGitHub(octokit) {
  try {
    const response = await octokit.repos.getContent({
      owner: DATA_REPO_OWNER,
      repo: DATA_REPO_NAME,
      path: VM_DATA_PATH,
    });
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    fileSha = response.data.sha;
    vmsCache = JSON.parse(content);
    return vmsCache;
  } catch (error) {
    if (error.status === 404) {
      vmsCache = [];
      fileSha = null;
      return [];
    }
    throw error;
  }
}

async function saveVMsToGitHub(octokit) {
  const content = Buffer.from(JSON.stringify(vmsCache, null, 2)).toString('base64');
  const params = {
    owner: DATA_REPO_OWNER,
    repo: DATA_REPO_NAME,
    path: VM_DATA_PATH,
    message: `Update VM data: ${new Date().toISOString()}`,
    content: content,
  };
  if (fileSha) {
    params.sha = fileSha;
  }
  const response = await octokit.repos.createOrUpdateFileContents(params);
  fileSha = response.data.content.sha;
  return response;
}

async function triggerWorkflow(octokit, vmId, tailscaleKey, githubToken) {
  try {
    await octokit.actions.createWorkflowDispatch({
      owner: DATA_REPO_OWNER,
      repo: DATA_REPO_NAME,
      workflow_id: 'create-vm.yml',
      ref: 'main',
      inputs: {
        vm_id: vmId,
        tailscale_key: tailscaleKey,
        github_token: githubToken,
      },
    });
    return { success: true };
  } catch (error) {
    console.error('Workflow trigger failed:', error.message);
    return { success: false, error: error.message };
  }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET: Lấy danh sách VM
  if (req.method === 'GET') {
    try {
      const tempOctokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      const vms = await loadVMsFromGitHub(tempOctokit);
      return res.status(200).json({ success: true, vms });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
  // DELETE: Xóa VM
  if (req.method === 'DELETE') {
    const vmId = req.query.id;
    if (!vmId) {
      return res.status(400).json({ success: false, error: 'Missing VM ID' });
    }
    
    try {
      const tempOctokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      await loadVMsFromGitHub(tempOctokit);
      
      const vmIndex = vmsCache.findIndex(vm => vm.id === vmId);
      if (vmIndex === -1) {
        return res.status(404).json({ success: false, error: 'VM not found' });
      }
      
      vmsCache.splice(vmIndex, 1);
      await saveVMsToGitHub(tempOctokit);
      
      return res.status(200).json({ success: true });
    } catch (error) {
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
  // POST: Tạo VM mới
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey } = req.body;
    
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ success: false, error: 'Missing required fields' });
    }
    
    try {
      const userOctokit = new Octokit({ auth: githubToken });
      await userOctokit.users.getAuthenticated();
      
      const adminOctokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
      await loadVMsFromGitHub(adminOctokit);
      
      const vmId = generateVMId();
      const now = new Date();
      
      const newVM = {
        id: vmId,
        name: `singularity-${vmId.slice(-8)}`,
        repoUrl: `https://github.com/${DATA_REPO_OWNER}/${DATA_REPO_NAME}/actions`,
        actionsUrl: `https://github.com/${DATA_REPO_OWNER}/${DATA_REPO_NAME}/actions/runs`,
        novncUrl: `https://novnc.example.com/vm/${vmId}`,
        username: 'runneradmin',
        password: 'VPS@123456',
        tailscaleIP: 'Đang khởi tạo...',
        createdAt: now.toISOString(),
        expiresAt: getExpiryTime(),
        status: 'creating',
      };
      
      vmsCache.unshift(newVM);
      await saveVMsToGitHub(adminOctokit);
      
      await triggerWorkflow(userOctokit, vmId, tailscaleKey, githubToken);
      
      return res.status(200).json({
        success: true,
        ...newVM,
      });
    } catch (error) {
      console.error('VM Creation Error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
};
