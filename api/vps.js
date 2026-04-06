// API xử lý VPS - Tích hợp GitHub và Workflow
import { validateGitHubToken, createRepository, createFile, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

// Cấu hình VM theo loại
const VM_CONFIGS = {
  basic: { cpu: '2 vCPU', ram: '7 GB', storage: '14 GB SSD', label: 'Cơ bản' },
  standard: { cpu: '4 vCPU', ram: '14 GB', storage: '28 GB SSD', label: 'Tiêu chuẩn' },
  premium: { cpu: '8 vCPU', ram: '16 GB', storage: '56 GB SSD', label: 'Cao cấp' }
};

// Tạo tên repository ngẫu nhiên
function generateRepoName() {
  const prefixes = ['vm', 'cloud', 'singularity', 'vps', 'windows'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 6);
  return `${prefix}-${timestamp}-${random}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET - Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ 
      success: true, 
      vms: vms,
      count: vms.length,
      timestamp: new Date().toISOString()
    });
  }
  
  // POST - Tạo VM mới
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, config, duration } = req.body;
    
    // Validate input
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vui lòng nhập GitHub Token và Tailscale Key' 
      });
    }
    
    // Validate GitHub Token
    const tokenValidation = await validateGitHubToken(githubToken);
    if (!tokenValidation.valid) {
      return res.status(401).json({ 
        success: false, 
        error: tokenValidation.error || 'GitHub Token không hợp lệ' 
      });
    }
    
    const vmConfig = VM_CONFIGS[config] || VM_CONFIGS.basic;
    const vmDuration = parseInt(duration) || 6;
    const repoName = generateRepoName();
    const owner = tokenValidation.user?.login;
    
    if (!owner) {
      return res.status(401).json({ success: false, error: 'Không thể xác định username GitHub' });
    }
    
    try {
      // Step 1: Tạo repository
      const repoResult = await createRepository(githubToken, repoName, `VM created by Singularity Cloud - ${vmConfig.label}`);
      if (!repoResult.success) {
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      
      // Step 2: Tạo workflow file
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmDuration);
      if (!workflowResult.success) {
        await deleteRepository(githubToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      
      // Step 3: Trigger workflow
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey, vmDuration);
      if (!triggerResult.success) {
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      
      // Step 4: Lấy workflow run ID
      let workflowRunId = null;
      let attempts = 0;
      while (attempts < 10 && !workflowRunId) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName, 1);
        if (runs.length > 0) {
          workflowRunId = runs[0].id;
        }
        attempts++;
      }
      
      // Tạo VM record
      const newVM = {
        id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        name: repoName,
        owner: owner,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + vmDuration * 60 * 60 * 1000).toISOString(),
        username: 'runneradmin',
        password: 'VPS@123456',
        tailscaleIP: null,
        novncUrl: null,
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: `https://github.com/${owner}/${repoName}/actions/runs/${workflowRunId}`,
        cpu: vmConfig.cpu,
        ram: vmConfig.ram,
        storage: vmConfig.storage,
        duration: vmDuration,
        config: config,
        workflowRunId: workflowRunId
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      
      // Giới hạn chỉ giữ 20 VM gần nhất
      if (vms.length > 20) vms.pop();
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã tạo repository và trigger workflow. VM sẽ sẵn sàng trong 2-3 phút.`
      });
      
    } catch (error) {
      console.error('Create VM error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Lỗi không xác định khi tạo VM' 
      });
    }
  }
  
  // DELETE - Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const vmIndex = vms.findIndex(vm => vm.id === id);
    
    if (vmIndex === -1) {
      return res.status(404).json({ success: false, error: 'Không tìm thấy VM' });
    }
    
    const vm = vms[vmIndex];
    
    // Cố gắng xóa repository trên GitHub (nếu có token lưu)
    // Note: Token không được lưu nên chỉ xóa record
    vms.splice(vmIndex, 1);
    global.vms = vms;
    
    return res.status(200).json({ 
      success: true, 
      message: 'Đã xóa VM thành công',
      note: 'Repository GitHub cần được xóa thủ công nếu muốn'
    });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
