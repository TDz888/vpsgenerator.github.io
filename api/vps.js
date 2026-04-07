// api/vps.js - Backend chính với debug logger tích hợp
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';
import { analyzeError, logError, ERROR_TYPES } from './debug.js';

let vms = global.vms || [];
let debugLogs = global.debugLogs || [];

/**
 * Tạo tên repository theo chuẩn GitHub
 */
function generateValidRepoName() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  const repoName = `vm-${timestamp}-${randomPart}`;
  console.log(`📁 Generated repo name: ${repoName}`);
  return repoName;
}

/**
 * Kiểm tra token cơ bản (nới lỏng)
 */
function isTokenFormatValid(token) {
  if (!token || typeof token !== 'string') return false;
  const trimmed = token.trim();
  if (trimmed.length < 20) return false;
  if (trimmed.includes(' ')) return false;
  return true;
}

/**
 * Theo dõi trạng thái workflow
 */
async function monitorWorkflowStatus(token, owner, repo, vmId, runId) {
  let attempts = 0;
  const maxAttempts = 36;
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
  
  // GET: Lấy danh sách VM và debug logs
  if (req.method === 'GET') {
    const { debug } = req.query;
    if (debug === 'logs') {
      return res.status(200).json({ success: true, debugLogs: debugLogs });
    }
    return res.status(200).json({ success: true, vms: vms, debugLogs: debugLogs.slice(0, 20) });
  }
  
  // POST: Tạo VM mới
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    console.log('========================================');
    console.log('📥 NEW VM CREATION REQUEST');
    console.log(`👤 Username: ${vmUsername}`);
    console.log('========================================');
    
    // Validate cơ bản
    if (!githubToken || !tailscaleKey) {
      const analysis = analyzeError('Missing GitHub Token or Tailscale Key', req.body);
      logError(analysis, { step: 'validation' });
      return res.status(400).json({ 
        success: false, 
        error: 'Thiếu GitHub Token hoặc Tailscale Key',
        debug: analysis
      });
    }
    
    const cleanToken = githubToken.trim();
    
    if (!isTokenFormatValid(cleanToken)) {
      const analysis = analyzeError('Token format invalid - token too short or contains spaces', req.body);
      logError(analysis, { step: 'validation' });
      return res.status(400).json({ 
        success: false, 
        error: 'Token GitHub không hợp lệ. Token phải dài ít nhất 20 ký tự và không chứa khoảng trắng.',
        debug: analysis
      });
    }
    
    if (!vmUsername || vmUsername.length < 5) {
      const analysis = analyzeError('Username too short', req.body);
      logError(analysis, { step: 'validation' });
      return res.status(400).json({ 
        success: false, 
        error: 'Tên đăng nhập phải có ít nhất 5 ký tự',
        debug: analysis
      });
    }
    
    if (!vmPassword || vmPassword.length < 5) {
      const analysis = analyzeError('Password too short', req.body);
      logError(analysis, { step: 'validation' });
      return res.status(400).json({ 
        success: false, 
        error: 'Mật khẩu phải có ít nhất 5 ký tự',
        debug: analysis
      });
    }
    
    // Validate với GitHub API
    const tokenValid = await validateGitHubToken(cleanToken);
    if (!tokenValid.valid) {
      const analysis = analyzeError(tokenValid.error, req.body);
      logError(analysis, { step: 'github_auth', user: tokenValid.user?.login });
      return res.status(401).json({ 
        success: false, 
        error: tokenValid.error,
        debug: analysis
      });
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
        const analysis = analyzeError(repoResult.error, req.body);
        logError(analysis, { step: 'create_repo', owner, repo: repoName });
        return res.status(500).json({ 
          success: false, 
          error: `Tạo repo thất bại: ${repoResult.error}`,
          debug: analysis
        });
      }
      console.log('✅ Repository created');
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Step 2: Tạo workflow file
      console.log('📝 Step 2/3: Creating workflow file...');
      const workflowResult = await createWorkflowFile(cleanToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(cleanToken, owner, repoName);
        const analysis = analyzeError(workflowResult.error, req.body);
        logError(analysis, { step: 'create_workflow', owner, repo: repoName });
        return res.status(500).json({ 
          success: false, 
          error: `Tạo workflow thất bại: ${workflowResult.error}`,
          debug: analysis
        });
      }
      console.log('✅ Workflow file created');
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Step 3: Trigger workflow
      console.log('🚀 Step 3/3: Triggering workflow...');
      const triggerResult = await triggerWorkflow(cleanToken, owner, repoName, tailscaleKey);
      if (!triggerResult.success) {
        const analysis = analyzeError(triggerResult.error, req.body);
        logError(analysis, { step: 'trigger_workflow', owner, repo: repoName });
        return res.status(500).json({ 
          success: false, 
          error: `Trigger workflow thất bại: ${triggerResult.error}`,
          debug: analysis
        });
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
      const analysis = analyzeError(error.message, req.body);
      logError(analysis, { step: 'unexpected', owner, repo: repoName });
      return res.status(500).json({ 
        success: false, 
        error: error.message,
        debug: analysis
      });
    }
  }
  
  // DELETE: Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const idx = vms.findIndex(vm => vm.id === id);
    if (idx === -1) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy VM' });
    }
    vms.splice(idx, 1);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
