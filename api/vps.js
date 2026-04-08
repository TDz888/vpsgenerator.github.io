// api/vps.js - Backend hoàn chỉnh, tạo VM thật, không pattern validation
import { createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

// In-memory storage
let vms = global.vms || [];

// Hàm tạo tên repository
function generateRepoName() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 10);
  return `vm-${timestamp}-${random}`;
}

// Hàm lấy thông tin user GitHub
async function getGitHubUser(token) {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch(e) {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS - mở hoàn toàn
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ 
      success: true, 
      vms: vms,
      stats: {
        total: vms.length,
        running: vms.filter(v => v.status === 'running').length,
        creating: vms.filter(v => v.status === 'creating').length
      }
    });
  }
  
  // DELETE - Xóa VM khỏi danh sách
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const index = vms.findIndex(v => v.id === id);
    if (index !== -1) {
      vms.splice(index, 1);
      global.vms = vms;
    }
    return res.status(200).json({ success: true });
  }
  
  // POST - Tạo VM mới (THẬT)
  if (req.method === 'POST') {
    const body = req.body;
    
    console.log('========================================');
    console.log('📥 CREATE VM REQUEST');
    console.log('========================================');
    
    // Lấy dữ liệu - KHÔNG pattern validation
    const githubToken = body?.githubToken || '';
    const tailscaleKey = body?.tailscaleKey || '';
    let vmUsername = body?.vmUsername || '';
    let vmPassword = body?.vmPassword || '';
    
    // Kiểm tra tồn tại cơ bản
    if (!githubToken) {
      return res.status(200).json({ 
        success: false, 
        error: 'Vui lòng nhập GitHub Token'
      });
    }
    
    if (!tailscaleKey) {
      return res.status(200).json({ 
        success: false, 
        error: 'Vui lòng nhập Tailscale Key'
      });
    }
    
    // Tạo username/password mặc định nếu trống
    if (!vmUsername) {
      vmUsername = 'user_' + Math.floor(Math.random() * 10000);
    }
    if (!vmPassword) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
      vmPassword = Array(12).fill().map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
    }
    
    // Lấy thông tin user GitHub
    let owner = 'unknown';
    try {
      const userInfo = await getGitHubUser(githubToken);
      if (userInfo && userInfo.login) {
        owner = userInfo.login;
        console.log(`✅ GitHub user: ${owner}`);
      }
    } catch(e) {
      console.log('⚠️ Cannot get GitHub user, continuing...');
    }
    
    const repoName = generateRepoName();
    
    try {
      // ========== BƯỚC 1: Tạo repository trên GitHub ==========
      console.log(`📁 [1/3] Creating repository: ${repoName}`);
      const repoResult = await createRepository(githubToken, repoName, `VM by ${vmUsername}`);
      
      if (!repoResult.success) {
        console.log(`❌ Create repo failed: ${repoResult.error}`);
        return res.status(200).json({ 
          success: false, 
          error: `Tạo repository thất bại: ${repoResult.error}`
        });
      }
      
      if (repoResult.owner) owner = repoResult.owner;
      console.log(`✅ Repository created: ${owner}/${repoName}`);
      
      // Đợi GitHub xử lý
      await new Promise(r => setTimeout(r, 4000));
      
      // ========== BƯỚC 2: Tạo workflow file trong repository ==========
      console.log(`📝 [2/3] Creating workflow file...`);
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmUsername, vmPassword);
      
      if (!workflowResult.success) {
        console.log(`❌ Create workflow failed: ${workflowResult.error}`);
        await deleteRepository(githubToken, owner, repoName);
        return res.status(200).json({ 
          success: false, 
          error: `Tạo workflow thất bại: ${workflowResult.error}`
        });
      }
      console.log(`✅ Workflow file created`);
      
      // Đợi GitHub index workflow
      await new Promise(r => setTimeout(r, 5000));
      
      // ========== BƯỚC 3: Trigger GitHub Actions workflow ==========
      console.log(`🚀 [3/3] Triggering GitHub Actions...`);
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey);
      
      if (!triggerResult.success) {
        console.log(`❌ Trigger failed: ${triggerResult.error}`);
        return res.status(200).json({ 
          success: false, 
          error: `Trigger workflow thất bại: ${triggerResult.error}`
        });
      }
      console.log(`✅ Workflow triggered`);
      
      // Lấy workflow run ID để hiển thị link
      let runId = null;
      try {
        await new Promise(r => setTimeout(r, 3000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName, 1);
        if (runs && runs.length > 0) {
          runId = runs[0].id;
        }
      } catch(e) {
        console.log('⚠️ Could not fetch run ID');
      }
      
      // Tạo VM record trong bộ nhớ
      const newVM = {
        id: Date.now().toString() + '_' + Math.random().toString(36).substring(2, 8),
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
      
      console.log('========================================');
      console.log(`🎉 VM CREATED SUCCESSFULLY!`);
      console.log(`🔗 Repo: https://github.com/${owner}/${repoName}`);
      console.log(`🔗 Actions: ${newVM.workflowUrl}`);
      console.log(`👤 Username: ${vmUsername}`);
      console.log(`🔑 Password: ${vmPassword}`);
      console.log('========================================');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ VM "${vmUsername}" đã được khởi tạo!`
      });
      
    } catch(error) {
      console.error('❌ UNEXPECTED ERROR:', error);
      return res.status(200).json({ 
        success: false, 
        error: error.message || 'Lỗi không xác định, vui lòng thử lại'
      });
    }
  }
  
  return res.status(200).json({ success: false, error: 'Method not supported' });
}
