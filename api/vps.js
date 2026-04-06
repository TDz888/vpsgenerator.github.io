// API xử lý VPS - Tích hợp GitHub và Workflow
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

function generateRepoName() {
  const prefixes = ['vm', 'cloud', 'singularity', 'vps', 'windows'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 6);
  return `${prefix}-${timestamp}-${random}`;
}

// Hàm theo dõi workflow và cập nhật trạng thái
async function monitorWorkflowStatus(token, owner, repo, vmId, workflowRunId) {
  let attempts = 0;
  const maxAttempts = 36; // 3 phút
  const interval = setInterval(async () => {
    attempts++;
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${workflowRunId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const run = await response.json();
        const vmIndex = vms.findIndex(v => v.id === vmId);
        if (vmIndex !== -1) {
          if (run.status === 'completed') {
            if (run.conclusion === 'success') {
              vms[vmIndex].status = 'running';
              vms[vmIndex].tailscaleIP = 'Đang lấy IP...';
            } else {
              vms[vmIndex].status = 'failed';
              vms[vmIndex].error = `Workflow thất bại: ${run.conclusion}`;
            }
            global.vms = vms;
            clearInterval(interval);
          } else if (run.status === 'queued' || run.status === 'in_progress') {
            vms[vmIndex].status = 'creating';
            global.vms = vms;
          }
        }
      }
    } catch (error) {
      console.error('Monitor workflow error:', error);
    }
    if (attempts >= maxAttempts) {
      const vmIndex = vms.findIndex(v => v.id === vmId);
      if (vmIndex !== -1 && vms[vmIndex].status === 'creating') {
        vms[vmIndex].status = 'failed';
        vms[vmIndex].error = 'Quá thời gian chờ (12 phút). GitHub Actions có thể bị timeout hoặc thiếu tài nguyên.';
        global.vms = vms;
      }
      clearInterval(interval);
    }
  }, 10000);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    console.log('📥 NEW VM CREATION REQUEST');
    console.log(`Username: ${vmUsername}`);
    
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ success: false, error: 'Thiếu GitHub Token hoặc Tailscale Key' });
    }
    if (!vmUsername || vmUsername.length < 5) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập phải có ít nhất 5 ký tự' });
    }
    if (!vmPassword || vmPassword.length < 5) {
      return res.status(400).json({ success: false, error: 'Mật khẩu phải có ít nhất 5 ký tự' });
    }
    
    const tokenValidation = await validateGitHubToken(githubToken);
    if (!tokenValidation.valid) {
      return res.status(401).json({ success: false, error: tokenValidation.error });
    }
    
    const repoName = generateRepoName();
    const owner = tokenValidation.user.login;
    
    try {
      const repoResult = await createRepository(githubToken, repoName, `VM created by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(githubToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey, vmUsername, vmPassword);
      if (!triggerResult.success) {
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      
      // Lấy workflow run ID
      let workflowRunId = null;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName, 1);
        if (runs.length > 0) {
          workflowRunId = runs[0].id;
          break;
        }
      }
      
      const newVM = {
        id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        name: repoName,
        owner: owner,
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        tailscaleIP: null,
        novncUrl: null,
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: `https://github.com/${owner}/${repoName}/actions`,
        workflowRunId: workflowRunId,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      // Theo dõi workflow
      if (workflowRunId) {
        monitorWorkflowStatus(githubToken, owner, repoName, newVM.id, workflowRunId);
      }
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã tạo VM với tên đăng nhập "${vmUsername}"`
      });
      
    } catch (error) {
      console.error('Create VM error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
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
