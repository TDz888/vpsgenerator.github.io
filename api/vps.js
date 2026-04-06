// API xử lý VPS - Tích hợp GitHub và Workflow
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

/**
 * Tạo tên repository hợp lệ theo quy tắc GitHub
 * Quy tắc: chỉ a-z, 0-9, dấu gạch ngang (-)
 * Không được: chữ hoa, dấu gạch dưới, ký tự đặc biệt, bắt đầu/kết thúc bằng dấu gạch ngang
 */
function generateValidRepoName() {
  // Chỉ dùng các ký tự an toàn: a-z, 0-9
  const safeChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  
  // Tạo prefix ngẫu nhiên (3-5 ký tự)
  const prefixes = ['vm', 'cloud', 'vps', 'win', 'srv', 'node'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  // Tạo chuỗi trung tâm (8-10 ký tự chỉ a-z0-9)
  let center = '';
  const centerLength = Math.floor(Math.random() * 3) + 8; // 8-10
  for (let i = 0; i < centerLength; i++) {
    center += safeChars[Math.floor(Math.random() * safeChars.length)];
  }
  
  // Tạo suffix (4-6 ký tự)
  let suffix = '';
  const suffixLength = Math.floor(Math.random() * 3) + 4; // 4-6
  for (let i = 0; i < suffixLength; i++) {
    suffix += safeChars[Math.floor(Math.random() * safeChars.length)];
  }
  
  // Ghép: prefix + '-' + center + '-' + suffix
  let repoName = `${prefix}-${center}-${suffix}`;
  
  // Đảm bảo không có dấu gạch ngang ở đầu/cuối
  repoName = repoName.replace(/^-+|-+$/g, '');
  
  // Đảm bảo không có dấu gạch ngang liên tiếp
  repoName = repoName.replace(/--+/g, '-');
  
  // Đảm bảo độ dài hợp lý (1-100)
  if (repoName.length > 100) {
    repoName = repoName.substring(0, 100);
    repoName = repoName.replace(/-+$/, '');
  }
  
  // Kiểm tra lần cuối: không được rỗng
  if (!repoName || repoName.length === 0) {
    repoName = `vm-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    repoName = repoName.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }
  
  console.log(`📁 Generated valid repo name: ${repoName}`);
  return repoName;
}

// Hàm theo dõi workflow status
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
            }
            global.vms = vms;
            clearInterval(interval);
          } else if (run.status === 'in_progress' || run.status === 'queued') {
            vms[idx].status = 'creating';
            global.vms = vms;
          }
        }
      }
    } catch (e) { console.error('Monitor error:', e); }
    if (attempts >= maxAttempts) {
      const idx = vms.findIndex(v => v.id === vmId);
      if (idx !== -1 && vms[idx].status === 'creating') {
        vms[idx].status = 'failed';
        vms[idx].error = 'Quá thời gian chờ. Vui lòng kiểm tra GitHub Actions.';
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
    
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ success: false, error: 'Thiếu GitHub Token hoặc Tailscale Key' });
    }
    if (!vmUsername || vmUsername.length < 5) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập phải có ít nhất 5 ký tự' });
    }
    if (!vmPassword || vmPassword.length < 5) {
      return res.status(400).json({ success: false, error: 'Mật khẩu phải có ít nhất 5 ký tự' });
    }
    
    const tokenValid = await validateGitHubToken(githubToken);
    if (!tokenValid.valid) {
      return res.status(401).json({ success: false, error: tokenValid.error });
    }
    
    const repoName = generateValidRepoName();
    const owner = tokenValid.user.login;
    
    console.log(`📁 Repository name: ${repoName}`);
    console.log(`👤 Owner: ${owner}`);
    
    try {
      const repoResult = await createRepository(githubToken, repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(githubToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey);
      if (!triggerResult.success) {
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      
      let runId = null;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName, 1);
        if (runs.length > 0) { runId = runs[0].id; break; }
      }
      
      const newVM = {
        id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
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
      
      if (runId) monitorWorkflowStatus(githubToken, owner, repoName, newVM.id, runId);
      
      console.log('✅ VM created successfully');
      return res.status(200).json({ success: true, ...newVM });
      
    } catch (error) {
      console.error('❌ Error:', error);
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
