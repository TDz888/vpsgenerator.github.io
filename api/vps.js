// api/vps.js - Backend chính - REFACTOR PRODUCTION READY
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

/**
 * Tạo tên repository theo chuẩn GitHub (a-z, 0-9, dấu gạch ngang)
 * KHÔNG ép về a-z đơn thuần
 */
function generateValidRepoName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  const timestamp = Date.now().toString(36);
  // Dùng dấu gạch ngang để dễ đọc
  const repoName = `vm-${timestamp}-${result}`;
  console.log(`📁 Generated repo name: ${repoName}`);
  console.log(`✅ Pattern valid: ${/^[a-z0-9-]+$/.test(repoName)}`);
  return repoName;
}

/**
 * Theo dõi trạng thái workflow với retry logic
 */
async function monitorWorkflowStatus(token, owner, repo, vmId, runId) {
  let attempts = 0;
  const maxAttempts = 36; // 6 phút
  const interval = setInterval(async () => {
    attempts++;
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const run = await res.json();
        const idx = vms.findIndex(v => v.id === vmId);
        if (idx !== -1) {
          if (run.status === 'completed') {
            vms[idx].status = run.conclusion === 'success' ? 'running' : 'failed';
            if (run.conclusion !== 'success') {
              vms[idx].error = `Workflow thất bại: ${run.conclusion}`;
            } else {
              // Thử lấy IP từ logs
              try {
                const logsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`, {
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                if (logsRes.ok) {
                  const logs = await logsRes.text();
                  const ipMatch = logs.match(/Tailscale IP: (\d+\.\d+\.\d+\.\d+)/);
                  if (ipMatch) {
                    vms[idx].tailscaleIP = ipMatch[1];
                    vms[idx].novncUrl = `http://${ipMatch[1]}:6080/vnc.html`;
                  }
                }
              } catch(e) {}
            }
            global.vms = vms;
            clearInterval(interval);
          } else if (run.status === 'in_progress' || run.status === 'queued') {
            if (vms[idx].status !== 'creating') {
              vms[idx].status = 'creating';
              global.vms = vms;
            }
          }
        }
      }
    } catch (error) { console.error('Monitor error:', error); }
    if (attempts >= maxAttempts) {
      const idx = vms.findIndex(v => v.id === vmId);
      if (idx !== -1 && vms[idx].status === 'creating') {
        vms[idx].status = 'failed';
        vms[idx].error = 'Quá thời gian chờ (6 phút). Vui lòng kiểm tra GitHub Actions.';
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
    
    console.log('========================================');
    console.log('📥 NEW VM CREATION REQUEST');
    console.log(`👤 Username: ${vmUsername}`);
    console.log('========================================');
    
    // Validate input
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ success: false, error: 'Thiếu GitHub Token hoặc Tailscale Key' });
    }
    
    const cleanToken = githubToken.trim();
    
    // FIX: Nhận đầy đủ các loại token GitHub
    const validTokenPattern = /^gh[pousr]_|^github_pat_/;
    if (!validTokenPattern.test(cleanToken)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Token GitHub không đúng định dạng. Phải bắt đầu bằng "ghp_", "github_pat_", "gho_", "ghu_" hoặc "ghs_".' 
      });
    }
    
    if (!vmUsername || vmUsername.length < 5) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập phải có ít nhất 5 ký tự' });
    }
    if (!vmPassword || vmPassword.length < 5) {
      return res.status(400).json({ success: false, error: 'Mật khẩu phải có ít nhất 5 ký tự' });
    }
    
    // Validate GitHub Token với API
    const tokenValid = await validateGitHubToken(cleanToken);
    if (!tokenValid.valid) {
      return res.status(401).json({ success: false, error: tokenValid.error });
    }
    
    const repoName = generateValidRepoName();
    const owner = tokenValid.user.login;
    
    console.log(`✅ Owner: ${owner}`);
    console.log(`📁 Repo name: ${repoName}`);
    
    try {
      // Step 1: Tạo repository
      console.log('📁 Step 1/3: Creating repository...');
      const repoResult = await createRepository(cleanToken, repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      console.log('✅ Repository created');
      
      // FIX: Đợi GitHub eventual consistency (QUAN TRỌNG)
      console.log('⏳ Waiting for GitHub to finalize repository...');
      await new Promise(r => setTimeout(r, 5000));
      
      // Step 2: Tạo workflow file với username và password thực tế
      console.log('📝 Step 2/3: Creating workflow file...');
      const workflowResult = await createWorkflowFile(cleanToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(cleanToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      console.log('✅ Workflow file created');
      
      // FIX: Đợi GitHub index workflow file (QUAN TRỌNG)
      console.log('⏳ Waiting for GitHub to index workflow file...');
      await new Promise(r => setTimeout(r, 5000));
      
      // Step 3: Trigger workflow
      console.log('🚀 Step 3/3: Triggering workflow...');
      const triggerResult = await triggerWorkflow(cleanToken, owner, repoName, tailscaleKey);
      if (!triggerResult.success) {
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      console.log('✅ Workflow triggered');
      
      // Lấy workflow run ID
      let runId = null;
      console.log('⏳ Waiting for workflow run ID...');
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const runs = await getWorkflowRuns(cleanToken, owner, repoName, 1);
        if (runs.length > 0) {
          runId = runs[0].id;
          console.log(`📋 Workflow Run ID: ${runId}`);
          break;
        }
        console.log(`   Attempt ${i + 1}/15...`);
      }
      
      const newVM = {
        id: `vm_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`,
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
        workflowUrl: runId ? `https://github.com/${owner}/${repoName}/actions/runs/${runId}` : `https://github.com/${owner}/${repoName}/actions`,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      if (runId) monitorWorkflowStatus(cleanToken, owner, repoName, newVM.id, runId);
      
      console.log('🎉 VM CREATION INITIATED SUCCESSFULLY!');
      console.log(`🔗 Repository: https://github.com/${owner}/${repoName}`);
      console.log('========================================\n');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã khởi tạo VM với tên đăng nhập "${vmUsername}"`
      });
      
    } catch (error) {
      console.error('❌ UNEXPECTED ERROR:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const idx = vms.findIndex(vm => vm.id === id);
    if (idx === -1) return res.status(404).json({ success: false, error: 'Không tìm thấy VM' });
    vms.splice(idx, 1);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
