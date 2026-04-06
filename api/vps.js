// API xử lý VPS - Tích hợp GitHub và Workflow
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
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
    const { githubToken, tailscaleKey, vmUsername, vmPassword, config, duration } = req.body;
    
    console.log('========================================');
    console.log('📥 NEW VM CREATION REQUEST');
    console.log('========================================');
    console.log(`Username: ${vmUsername}, Config: ${config}, Duration: ${duration}`);
    
    // Validate input
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Vui lòng nhập GitHub Token và Tailscale Key' 
      });
    }
    
    if (!vmUsername || vmUsername.length < 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Tên đăng nhập phải có ít nhất 5 ký tự' 
      });
    }
    
    if (!vmPassword || vmPassword.length < 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'Mật khẩu phải có ít nhất 5 ký tự' 
      });
    }
    
    // Validate GitHub Token
    console.log('🔑 Validating GitHub token...');
    const tokenValidation = await validateGitHubToken(githubToken);
    if (!tokenValidation.valid) {
      console.error('❌ Token validation failed:', tokenValidation.error);
      return res.status(401).json({ 
        success: false, 
        error: tokenValidation.error || 'GitHub Token không hợp lệ' 
      });
    }
    
    console.log(`✅ Token valid for user: ${tokenValidation.user.login}`);
    
    const vmConfig = VM_CONFIGS[config] || VM_CONFIGS.basic;
    const vmDuration = parseInt(duration) || 6;
    const repoName = generateRepoName();
    const owner = tokenValidation.user.login;
    
    console.log(`📁 Repository: ${repoName}`);
    console.log(`👤 VM User: ${vmUsername}`);
    
    try {
      // Step 1: Tạo repository
      console.log('\n📁 Step 1: Creating repository...');
      const repoResult = await createRepository(githubToken, repoName, `VM created by ${vmUsername} - ${vmConfig.label}`);
      if (!repoResult.success) {
        console.error('❌ Create repo failed:', repoResult.error);
        return res.status(500).json({ success: false, error: `Tạo repo thất bại: ${repoResult.error}` });
      }
      console.log('✅ Repository created');
      
      // Step 2: Tạo workflow file với username và password tùy chỉnh
      console.log('\n📝 Step 2: Creating workflow file...');
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmDuration, vmUsername, vmPassword);
      if (!workflowResult.success) {
        console.error('❌ Create workflow failed:', workflowResult.error);
        await deleteRepository(githubToken, owner, repoName);
        return res.status(500).json({ success: false, error: `Tạo workflow thất bại: ${workflowResult.error}` });
      }
      console.log('✅ Workflow file created');
      
      // Step 3: Trigger workflow
      console.log('\n🚀 Step 3: Triggering workflow...');
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey, vmDuration);
      if (!triggerResult.success) {
        console.error('❌ Trigger workflow failed:', triggerResult.error);
        return res.status(500).json({ success: false, error: `Trigger workflow thất bại: ${triggerResult.error}` });
      }
      console.log('✅ Workflow triggered');
      
      // Tạo VM record
      const newVM = {
        id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
        name: repoName,
        owner: owner,
        username: vmUsername,
        password: vmPassword,
        status: 'creating',
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + vmDuration * 60 * 60 * 1000).toISOString(),
        tailscaleIP: null,
        novncUrl: null,
        repoUrl: `https://github.com/${owner}/${repoName}`,
        workflowUrl: `https://github.com/${owner}/${repoName}/actions`,
        cpu: vmConfig.cpu,
        ram: vmConfig.ram,
        storage: vmConfig.storage,
        duration: vmDuration,
        config: config
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      
      if (vms.length > 20) vms.pop();
      
      console.log('\n🎉 VM CREATION COMPLETED!');
      console.log(`🔗 Repository: https://github.com/${owner}/${repoName}`);
      console.log('========================================\n');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã tạo VM với tên đăng nhập "${vmUsername}"`
      });
      
    } catch (error) {
      console.error('\n❌ UNEXPECTED ERROR:', error);
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
    
    vms.splice(vmIndex, 1);
    global.vms = vms;
    
    return res.status(200).json({ 
      success: true, 
      message: 'Đã xóa VM thành công'
    });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
