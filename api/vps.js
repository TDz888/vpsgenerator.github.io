// api/vps.js - Bản đã hoạt động, tạo workflow thật trên GitHub
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

function generateValidRepoName() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `vm-${timestamp}-${randomPart}`;
}

export default async function handler(req, res) {
  // CORS - Mở rộng hoàn toàn
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET: Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  // POST: Tạo VM mới (TẠO WORKFLOW THẬT)
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    console.log('========================================');
    console.log('📥 NEW VM CREATION REQUEST');
    console.log(`👤 Username: ${vmUsername}`);
    console.log('========================================');
    
    // Validate cơ bản - KHÔNG check pattern
    if (!githubToken || githubToken.length < 10) {
      return res.status(400).json({ 
        success: false, 
        error: 'GitHub Token không hợp lệ hoặc quá ngắn'
      });
    }
    
    if (!tailscaleKey || tailscaleKey.length < 10) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tailscale Key không hợp lệ'
      });
    }
    
    if (!vmUsername || vmUsername.length < 3) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tên đăng nhập phải có ít nhất 3 ký tự'
      });
    }
    
    const cleanToken = githubToken.trim();
    const cleanTailscale = tailscaleKey.trim();
    
    // Validate với GitHub API
    const tokenValid = await validateGitHubToken(cleanToken);
    if (!tokenValid.valid) {
      return res.status(401).json({ 
        success: false, 
        error: tokenValid.error
      });
    }
    
    const repoName = generateValidRepoName();
    const owner = tokenValid.user.login;
    
    try {
      // Step 1: Tạo repository trên GitHub
      console.log('📁 Step 1/3: Creating repository...');
      const repoResult = await createRepository(cleanToken, repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ 
          success: false, 
          error: `Tạo repo thất bại: ${repoResult.error}`
        });
      }
      console.log('✅ Repository created');
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Step 2: Tạo workflow file trong repository
      console.log('📝 Step 2/3: Creating workflow file...');
      const workflowResult = await createWorkflowFile(cleanToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(cleanToken, owner, repoName);
        return res.status(500).json({ 
          success: false, 
          error: `Tạo workflow thất bại: ${workflowResult.error}`
        });
      }
      console.log('✅ Workflow file created');
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Step 3: Trigger workflow (chạy GitHub Actions)
      console.log('🚀 Step 3/3: Triggering workflow...');
      const triggerResult = await triggerWorkflow(cleanToken, owner, repoName, cleanTailscale);
      if (!triggerResult.success) {
        return res.status(500).json({ 
          success: false, 
          error: `Trigger workflow thất bại: ${triggerResult.error}`
        });
      }
      console.log('✅ Workflow triggered');
      
      // Lấy workflow run ID (để hiển thị link)
      let runId = null;
      try {
        await new Promise(r => setTimeout(r, 3000));
        const runs = await getWorkflowRuns(cleanToken, owner, repoName, 1);
        if (runs && runs.length > 0) {
          runId = runs[0].id;
        }
      } catch(e) {
        console.log('⚠️ Could not fetch run ID:', e.message);
      }
      
      // Tạo VM record trong bộ nhớ
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
        workflowUrl: runId ? `https://github.com/${owner}/${repoName}/actions/runs/${runId}` : `https://github.com/${owner}/${repoName}/actions`,
        tailscaleIP: null,
        novncUrl: null,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      console.log('🎉 VM CREATION SUCCESS!');
      console.log(`🔗 Repo: https://github.com/${owner}/${repoName}`);
      console.log('========================================\n');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã khởi tạo VM với tên "${vmUsername}". VM đang được tạo trong GitHub Actions.`
      });
      
    } catch (error) {
      console.error('❌ UNEXPECTED ERROR:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Lỗi không xác định'
      });
    }
  }
  
  // DELETE: Xóa VM khỏi danh sách
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
