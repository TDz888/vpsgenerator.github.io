// API xử lý VPS - Tích hợp GitHub và Workflow
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

// FIX HOÀN TOÀN: Tên repository CHỈ gồm chữ thường, số và dấu gạch ngang
function generateRepoName() {
  // Chỉ dùng các ký tự an toàn: a-z, 0-9, -
  const prefixes = ['vm', 'cloud', 'singularity', 'vps', 'win', 'server'];
  const suffix = [
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm',
    'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];
  
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  // Tạo chuỗi ngẫu nhiên 10 ký tự chỉ gồm chữ thường và số
  let randomStr = '';
  for (let i = 0; i < 10; i++) {
    randomStr += suffix[Math.floor(Math.random() * suffix.length)];
  }
  
  // Kết hợp: prefix + randomStr (đảm bảo không có ký tự đặc biệt)
  let repoName = `${prefix}-${randomStr}`;
  
  // Đảm bảo không có chữ hoa và không quá 100 ký tự
  repoName = repoName.toLowerCase();
  
  // Đảm bảo không bắt đầu hoặc kết thúc bằng dấu gạch ngang
  if (repoName.startsWith('-')) repoName = 'vm' + repoName;
  if (repoName.endsWith('-')) repoName = repoName.slice(0, -1);
  
  // Đảm bảo không có dấu gạch ngang liên tiếp
  repoName = repoName.replace(/--+/g, '-');
  
  console.log(`📁 Generated repo name: ${repoName}`);
  return repoName;
}

// Hàm theo dõi workflow và cập nhật trạng thái
async function monitorWorkflowStatus(token, owner, repo, vmId, workflowRunId) {
  let attempts = 0;
  const maxAttempts = 36;
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
              try {
                const logsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${workflowRunId}/logs`, {
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                if (logsResponse.ok) {
                  const logs = await logsResponse.text();
                  const ipMatch = logs.match(/Tailscale IP: (\d+\.\d+\.\d+\.\d+)/);
                  if (ipMatch) {
                    vms[vmIndex].tailscaleIP = ipMatch[1];
                  }
                }
              } catch(e) {}
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
        vms[vmIndex].error = 'Quá thời gian chờ (6 phút). GitHub Actions có thể bị timeout.';
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
    if (!vmUsername || vmUsername.length < 5) {
      return res.status(400).json({ success: false, error: 'Tên đăng nhập phải có ít nhất 5 ký tự' });
    }
    if (!vmPassword || vmPassword.length < 5) {
      return res.status(400).json({ success: false, error: 'Mật khẩu phải có ít nhất 5 ký tự' });
    }
    
    // Validate GitHub Token
    const tokenValidation = await validateGitHubToken(githubToken);
    if (!tokenValidation.valid) {
      return res.status(401).json({ success: false, error: tokenValidation.error });
    }
    
    const repoName = generateRepoName();
    const owner = tokenValidation.user.login;
    
    console.log(`📁 Repository name: ${repoName}`);
    console.log(`👤 Owner: ${owner}`);
    
    try {
      // Step 1: Tạo repository
      console.log('📁 Step 1: Creating repository...');
      const repoResult = await createRepository(githubToken, repoName, `VM created by ${vmUsername}`);
      if (!repoResult.success) {
        console.error('❌ Create repo failed:', repoResult.error);
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      console.log('✅ Repository created successfully');
      
      // Step 2: Tạo workflow file
      console.log('📝 Step 2: Creating workflow file...');
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        console.error('❌ Create workflow failed:', workflowResult.error);
        await deleteRepository(githubToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      console.log('✅ Workflow file created');
      
      // Step 3: Trigger workflow
      console.log('🚀 Step 3: Triggering workflow...');
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey, vmUsername, vmPassword);
      if (!triggerResult.success) {
        console.error('❌ Trigger workflow failed:', triggerResult.error);
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      console.log('✅ Workflow triggered');
      
      // Lấy workflow run ID
      let workflowRunId = null;
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName, 1);
        if (runs.length > 0) {
          workflowRunId = runs[0].id;
          console.log(`📋 Workflow Run ID: ${workflowRunId}`);
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
        workflowUrl: workflowRunId ? `https://github.com/${owner}/${repoName}/actions/runs/${workflowRunId}` : `https://github.com/${owner}/${repoName}/actions`,
        workflowRunId: workflowRunId,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      // Theo dõi workflow nếu có run ID
      if (workflowRunId) {
        monitorWorkflowStatus(githubToken, owner, repoName, newVM.id, workflowRunId);
      }
      
      console.log('🎉 VM creation initiated successfully!');
      console.log(`🔗 Repo URL: https://github.com/${owner}/${repoName}`);
      console.log('========================================\n');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã tạo VM với tên đăng nhập "${vmUsername}"`
      });
      
    } catch (error) {
      console.error('❌ Create VM error:', error);
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
