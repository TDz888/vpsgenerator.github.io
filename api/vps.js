// api/vps.js - Phiên bản đã hoạt động + monitor workflow
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns, getWorkflowLogs } from './workflow.js';

let vms = global.vms || [];
let activeMonitors = global.activeMonitors || {};

function generateValidRepoName() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `vm-${timestamp}-${randomPart}`;
}

// Hàm monitor workflow và cập nhật thông tin VM
async function monitorWorkflow(vmId, token, owner, repo) {
  console.log(`🔍 Starting monitor for VM: ${vmId}`);
  
  let attempts = 0;
  const maxAttempts = 36; // 6 phút (10s * 36)
  
  const interval = setInterval(async () => {
    attempts++;
    const vmIndex = vms.findIndex(v => v.id === vmId);
    if (vmIndex === -1) {
      clearInterval(interval);
      return;
    }
    
    try {
      // Lấy workflow runs
      const runs = await getWorkflowRuns(token, owner, repo, 1);
      if (runs.length === 0) {
        if (attempts % 6 === 0) {
          console.log(`⏳ VM ${vmId}: Waiting for workflow to start... (${attempts}/${maxAttempts})`);
        }
        return;
      }
      
      const run = runs[0];
      
      // Cập nhật workflow URL
      vms[vmIndex].workflowUrl = run.html_url;
      
      if (run.status === 'completed') {
        if (run.conclusion === 'success') {
          // Lấy logs để tìm IP và noVNC URL
          const logs = await getWorkflowLogs(token, owner, repo, run.id);
          
          // Tìm Tailscale IP từ logs
          const ipMatch = logs.match(/Tailscale IP:? (\d+\.\d+\.\d+\.\d+)/i);
          const novncMatch = logs.match(/noVNC URL:? (http:\/\/\d+\.\d+\.\d+\.\d+:6080\/vnc\.html)/i);
          
          vms[vmIndex].status = 'running';
          vms[vmIndex].tailscaleIP = ipMatch ? ipMatch[1] : null;
          vms[vmIndex].novncUrl = novncMatch ? novncMatch[1] : (ipMatch ? `http://${ipMatch[1]}:6080/vnc.html` : null);
          vms[vmIndex].completedAt = new Date().toISOString();
          
          console.log(`✅ VM ${vmId} is RUNNING!`);
          console.log(`   IP: ${vms[vmIndex].tailscaleIP}`);
          console.log(`   noVNC: ${vms[vmIndex].novncUrl}`);
        } else {
          vms[vmIndex].status = 'failed';
          vms[vmIndex].error = `Workflow ${run.conclusion}`;
          console.log(`❌ VM ${vmId} failed: ${run.conclusion}`);
        }
        
        vms[vmIndex].lastChecked = new Date().toISOString();
        global.vms = vms;
        clearInterval(interval);
        delete activeMonitors[vmId];
        
      } else if (run.status === 'in_progress' || run.status === 'queued') {
        if (vms[vmIndex].status !== 'creating') {
          vms[vmIndex].status = 'creating';
          global.vms = vms;
        }
        
        if (attempts % 6 === 0) {
          console.log(`🔄 VM ${vmId}: Workflow ${run.status}... (${attempts}/${maxAttempts})`);
        }
      }
      
    } catch (error) {
      console.error(`Monitor error for ${vmId}:`, error);
    }
    
    if (attempts >= maxAttempts) {
      const vmIndex = vms.findIndex(v => v.id === vmId);
      if (vmIndex !== -1 && vms[vmIndex].status === 'creating') {
        vms[vmIndex].status = 'timeout';
        vms[vmIndex].error = 'Quá thời gian chờ (6 phút)';
        global.vms = vms;
      }
      clearInterval(interval);
      delete activeMonitors[vmId];
    }
  }, 10000);
  
  activeMonitors[vmId] = interval;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // GET: Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  // POST: Tạo VM mới
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    console.log('========================================');
    console.log('📥 NEW VM CREATION REQUEST');
    console.log(`👤 Username: ${vmUsername}`);
    console.log('========================================');
    
    // Validate cơ bản
    if (!githubToken || githubToken.length < 10) {
      return res.status(400).json({ success: false, error: 'GitHub Token không hợp lệ' });
    }
    if (!tailscaleKey || tailscaleKey.length < 10) {
      return res.status(400).json({ success: false, error: 'Tailscale Key không hợp lệ' });
    }
    if (!vmUsername || vmUsername.length < 3) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập phải có ít nhất 3 ký tự' });
    }
    
    const cleanToken = githubToken.trim();
    const cleanTailscale = tailscaleKey.trim();
    
    // Validate GitHub token
    const tokenValid = await validateGitHubToken(cleanToken);
    if (!tokenValid.valid) {
      return res.status(401).json({ success: false, error: tokenValid.error });
    }
    
    const repoName = generateValidRepoName();
    const owner = tokenValid.user.login;
    
    try {
      // Tạo repository
      const repoResult = await createRepository(cleanToken, repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Tạo workflow file
      const workflowResult = await createWorkflowFile(cleanToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(cleanToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Trigger workflow
      const triggerResult = await triggerWorkflow(cleanToken, owner, repoName, cleanTailscale);
      if (!triggerResult.success) {
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      
      // Tạo VM record
      const newVM = {
        id: `vm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        name: repoName,
        owner: owner,
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: `https://github.com/${owner}/${repoName}/actions`,
        tailscaleIP: null,
        novncUrl: null,
        error: null,
        lastChecked: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      // Bắt đầu monitor workflow
      monitorWorkflow(newVM.id, cleanToken, owner, repoName);
      
      console.log('🎉 VM CREATION INITIATED!');
      console.log(`🔗 Repo: https://github.com/${owner}/${repoName}`);
      console.log('========================================\n');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã khởi tạo VM. Đang tạo trong GitHub Actions...`
      });
      
    } catch (error) {
      console.error('❌ ERROR:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
  // DELETE: Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const index = vms.findIndex(vm => vm.id === id);
    if (index === -1) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy VM' });
    }
    
    // Dừng monitor nếu đang chạy
    if (activeMonitors[id]) {
      clearInterval(activeMonitors[id]);
      delete activeMonitors[id];
    }
    
    vms.splice(index, 1);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
