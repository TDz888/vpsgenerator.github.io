// api/vps.js - Bỏ validate GitHub token, tạo VM luôn
import { createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow } from './workflow.js';

let vms = global.vms || [];

function generateRepoName() {
  return 'vm-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);
}

// Hàm lấy user từ token đơn giản, không throw error
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
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // GET
  if (req.method === 'GET') {
    return res.status(200).json({ success: true, vms: vms });
  }
  
  // DELETE
  if (req.method === 'DELETE') {
    const { id } = req.query;
    vms = vms.filter(v => v.id !== id);
    global.vms = vms;
    return res.status(200).json({ success: true });
  }
  
  // POST
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    console.log('📥 CREATE VM REQUEST');
    
    // Kiểm tra đơn giản - không pattern
    if (!githubToken) {
      return res.status(400).json({ success: false, error: 'Thiếu GitHub Token' });
    }
    if (!tailscaleKey) {
      return res.status(400).json({ success: false, error: 'Thiếu Tailscale Key' });
    }
    if (!vmUsername) {
      return res.status(400).json({ success: false, error: 'Thiếu tên đăng nhập' });
    }
    
    const cleanToken = githubToken.trim();
    
    // Lấy user từ token (nếu lỗi thì vẫn tạo VM)
    let owner = 'unknown';
    try {
      const user = await getGitHubUser(cleanToken);
      if (user && user.login) {
        owner = user.login;
        console.log(`✅ Token valid for: ${owner}`);
      } else {
        console.log(`⚠️ Cannot verify token, but continuing...`);
      }
    } catch(e) {
      console.log(`⚠️ Token check error: ${e.message}`);
    }
    
    const repoName = generateRepoName();
    
    try {
      // Tạo repository
      console.log(`📁 Creating repo: ${repoName}`);
      const repoResult = await createRepository(cleanToken, repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ success: false, error: repoResult.error });
      }
      
      // Nếu lấy được owner từ API thì cập nhật
      if (repoResult.owner) owner = repoResult.owner;
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Tạo workflow file
      console.log(`📝 Creating workflow file...`);
      const workflowResult = await createWorkflowFile(cleanToken, owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(cleanToken, owner, repoName);
        return res.status(500).json({ success: false, error: workflowResult.error });
      }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Trigger workflow
      console.log(`🚀 Triggering workflow...`);
      const triggerResult = await triggerWorkflow(cleanToken, owner, repoName, tailscaleKey.trim());
      if (!triggerResult.success) {
        return res.status(500).json({ success: false, error: triggerResult.error });
      }
      
      // Lưu VM
      const newVM = {
        id: Date.now().toString(),
        name: repoName,
        owner: owner,
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: `https://github.com/${owner}/${repoName}/actions`
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      
      console.log(`🎉 VM created: ${repoName}`);
      
      return res.status(200).json({ success: true, ...newVM });
      
    } catch (error) {
      console.error('❌ Error:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
