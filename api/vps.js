// api/vps.js - Simplified version without strict validation
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

function generateValidRepoName() {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `vm-${timestamp}-${randomPart}`;
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
    
    console.log('📥 Received request');
    console.log('Token length:', githubToken?.length);
    console.log('Tailscale key length:', tailscaleKey?.length);
    
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
    
    // Validate với GitHub API
    const tokenValid = await validateGitHubToken(githubToken.trim());
    if (!tokenValid.valid) {
      return res.status(401).json({ 
        success: false, 
        error: tokenValid.error
      });
    }
    
    const repoName = generateValidRepoName();
    const owner = tokenValid.user.login;
    
    try {
      // Tạo repository
      const repoResult = await createRepository(githubToken.trim(), repoName, `VM by ${vmUsername}`);
      if (!repoResult.success) {
        return res.status(500).json({ 
          success: false, 
          error: `Tạo repo thất bại: ${repoResult.error}`
        });
      }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Tạo workflow file
      const workflowResult = await createWorkflowFile(githubToken.trim(), owner, repoName, vmUsername, vmPassword);
      if (!workflowResult.success) {
        await deleteRepository(githubToken.trim(), owner, repoName);
        return res.status(500).json({ 
          success: false, 
          error: `Tạo workflow thất bại: ${workflowResult.error}`
        });
      }
      
      await new Promise(r => setTimeout(r, 5000));
      
      // Trigger workflow
      const triggerResult = await triggerWorkflow(githubToken.trim(), owner, repoName, tailscaleKey.trim());
      if (!triggerResult.success) {
        return res.status(500).json({ 
          success: false, 
          error: `Trigger workflow thất bại: ${triggerResult.error}`
        });
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
        repoUrl: `https://github.com/${owner}/${repoName}`,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      if (vms.length > 20) vms.pop();
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã khởi tạo VM với tên "${vmUsername}"`
      });
      
    } catch (error) {
      console.error('❌ Error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message
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
