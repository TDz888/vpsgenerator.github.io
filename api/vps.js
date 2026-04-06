// api/vps.js - Hoàn chỉnh, đã fix toàn bộ lỗi pattern và validation
import { validateGitHubToken, createRepository, deleteRepository } from './github.js';
import { createWorkflowFile, triggerWorkflow, getWorkflowRuns } from './workflow.js';

let vms = global.vms || [];

/**
 * Tạo tên repository hợp lệ theo quy tắc GitHub
 * QUAN TRỌNG: Chỉ được phép: a-z, 0-9, dấu gạch ngang (-), dấu chấm (.)
 * KHÔNG được: chữ hoa, dấu gạch dưới (_), ký tự đặc biệt, bắt đầu/kết thúc bằng dấu gạch ngang
 */
function generateValidRepoName() {
  // Bộ ký tự an toàn: chỉ chữ thường và số
  const safeChars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  
  // Prefix an toàn (chỉ a-z)
  const prefixes = ['vm', 'cloud', 'vps', 'win', 'srv', 'node', 'instance'];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  
  // Tạo phần giữa (8 ký tự ngẫu nhiên)
  let center = '';
  for (let i = 0; i < 8; i++) {
    center += safeChars[Math.floor(Math.random() * safeChars.length)];
  }
  
  // Tạo phần cuối (6 ký tự ngẫu nhiên)
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += safeChars[Math.floor(Math.random() * safeChars.length)];
  }
  
  // Ghép nối: prefix + '-' + center + '-' + suffix
  let repoName = `${prefix}-${center}-${suffix}`;
  
  // Đảm bảo không có dấu gạch ngang ở đầu hoặc cuối
  repoName = repoName.replace(/^-+|-+$/g, '');
  
  // Đảm bảo không có dấu gạch ngang liên tiếp
  repoName = repoName.replace(/--+/g, '-');
  
  // Đảm bảo không có dấu chấm ở đầu hoặc cuối
  repoName = repoName.replace(/^\.+|\.+$/g, '');
  
  // Chuyển sang chữ thường (đề phòng)
  repoName = repoName.toLowerCase();
  
  // Kiểm tra độ dài (tối đa 100 ký tự)
  if (repoName.length > 100) {
    repoName = repoName.substring(0, 100);
    repoName = repoName.replace(/-+$|\.+$/, '');
  }
  
  // Phòng trường hợp rỗng
  if (!repoName || repoName.length === 0) {
    const fallback = `vm-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    repoName = fallback.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '');
  }
  
  console.log(`📁 Generated repo name: ${repoName}`);
  return repoName;
}

/**
 * Theo dõi trạng thái workflow GitHub Actions
 * Cập nhật status của VM (creating -> running/failed)
 */
async function monitorWorkflowStatus(token, owner, repo, vmId, runId) {
  let attempts = 0;
  const maxAttempts = 36; // 6 phút (mỗi 10 giây)
  
  const interval = setInterval(async () => {
    attempts++;
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const run = await response.json();
        const vmIndex = vms.findIndex(v => v.id === vmId);
        
        if (vmIndex !== -1) {
          // Workflow đã hoàn thành
          if (run.status === 'completed') {
            if (run.conclusion === 'success') {
              vms[vmIndex].status = 'running';
              console.log(`✅ VM ${vmId} is now RUNNING`);
              
              // Thử lấy IP từ logs nếu có
              try {
                const logsRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}/logs`, {
                  headers: { 'Authorization': `Bearer ${token}` }
                });
                if (logsRes.ok) {
                  const logs = await logsRes.text();
                  const ipMatch = logs.match(/Tailscale IP: (\d+\.\d+\.\d+\.\d+)/);
                  if (ipMatch) {
                    vms[vmIndex].tailscaleIP = ipMatch[1];
                    vms[vmIndex].novncUrl = `http://${ipMatch[1]}:6080/vnc.html`;
                    console.log(`📍 Got Tailscale IP: ${ipMatch[1]}`);
                  }
                }
              } catch (e) {
                console.log('Could not extract IP from logs:', e.message);
              }
            } else {
              vms[vmIndex].status = 'failed';
              vms[vmIndex].error = `Workflow thất bại: ${run.conclusion}. Vui lòng kiểm tra GitHub Actions logs.`;
              console.log(`❌ VM ${vmId} FAILED: ${run.conclusion}`);
            }
            global.vms = vms;
            clearInterval(interval);
          } 
          // Workflow đang chạy
          else if (run.status === 'in_progress' || run.status === 'queued') {
            if (vms[vmIndex].status !== 'creating') {
              vms[vmIndex].status = 'creating';
              global.vms = vms;
            }
            console.log(`⏳ VM ${vmId} is ${run.status}... (attempt ${attempts}/${maxAttempts})`);
          }
        }
      }
    } catch (error) {
      console.error('Monitor workflow error:', error);
    }
    
    // Timeout sau 6 phút
    if (attempts >= maxAttempts) {
      const vmIndex = vms.findIndex(v => v.id === vmId);
      if (vmIndex !== -1 && vms[vmIndex].status === 'creating') {
        vms[vmIndex].status = 'failed';
        vms[vmIndex].error = 'Quá thời gian chờ (6 phút). Vui lòng kiểm tra GitHub Actions workflow.';
        global.vms = vms;
        console.log(`⏰ VM ${vmId} TIMEOUT after 6 minutes`);
      }
      clearInterval(interval);
    }
  }, 10000);
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  // Preflight request
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // GET: Lấy danh sách VM
  if (req.method === 'GET') {
    return res.status(200).json({ 
      success: true, 
      vms: vms,
      count: vms.length,
      timestamp: new Date().toISOString()
    });
  }
  
  // POST: Tạo VM mới
  if (req.method === 'POST') {
    const { githubToken, tailscaleKey, vmUsername, vmPassword } = req.body;
    
    console.log('========================================');
    console.log('📥 NEW VM CREATION REQUEST');
    console.log(`👤 Username: ${vmUsername}`);
    console.log(`🔐 Password: ${vmPassword ? '***' : 'missing'}`);
    console.log(`🔑 GitHub Token: ${githubToken ? githubToken.substring(0, 15) + '...' : 'missing'}`);
    console.log(`🌀 Tailscale Key: ${tailscaleKey ? tailscaleKey.substring(0, 15) + '...' : 'missing'}`);
    console.log('========================================');
    
    // Validate input
    if (!githubToken || !tailscaleKey) {
      console.error('❌ Missing GitHub Token or Tailscale Key');
      return res.status(400).json({ 
        success: false, 
        error: 'Vui lòng nhập GitHub Token và Tailscale Key' 
      });
    }
    
    if (!vmUsername || vmUsername.length < 5) {
      console.error('❌ Invalid username (min 5 chars)');
      return res.status(400).json({ 
        success: false, 
        error: 'Tên đăng nhập phải có ít nhất 5 ký tự' 
      });
    }
    
    if (!vmPassword || vmPassword.length < 5) {
      console.error('❌ Invalid password (min 5 chars)');
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
        error: tokenValidation.error 
      });
    }
    
    const owner = tokenValidation.user.login;
    const repoName = generateValidRepoName();
    
    console.log(`✅ Token valid for user: ${owner}`);
    console.log(`📁 Repository name: ${repoName}`);
    
    try {
      // Step 1: Tạo repository
      console.log('📁 Step 1/3: Creating repository...');
      const repoResult = await createRepository(githubToken, repoName, `Virtual Machine created by ${vmUsername}`);
      
      if (!repoResult.success) {
        console.error('❌ Create repository failed:', repoResult.error);
        return res.status(500).json({ 
          success: false, 
          error: `Tạo repository thất bại: ${repoResult.error}` 
        });
      }
      console.log('✅ Repository created successfully');
      
      // Step 2: Tạo workflow file
      console.log('📝 Step 2/3: Creating workflow file...');
      const workflowResult = await createWorkflowFile(githubToken, owner, repoName, vmUsername, vmPassword);
      
      if (!workflowResult.success) {
        console.error('❌ Create workflow failed:', workflowResult.error);
        await deleteRepository(githubToken, owner, repoName);
        return res.status(500).json({ 
          success: false, 
          error: `Tạo workflow thất bại: ${workflowResult.error}` 
        });
      }
      console.log('✅ Workflow file created');
      
      // Step 3: Trigger workflow
      console.log('🚀 Step 3/3: Triggering GitHub Actions workflow...');
      const triggerResult = await triggerWorkflow(githubToken, owner, repoName, tailscaleKey);
      
      if (!triggerResult.success) {
        console.error('❌ Trigger workflow failed:', triggerResult.error);
        return res.status(500).json({ 
          success: false, 
          error: `Trigger workflow thất bại: ${triggerResult.error}` 
        });
      }
      console.log('✅ Workflow triggered successfully');
      
      // Lấy workflow run ID để theo dõi
      let workflowRunId = null;
      console.log('⏳ Waiting for workflow run ID...');
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const runs = await getWorkflowRuns(githubToken, owner, repoName, 1);
        if (runs.length > 0) {
          workflowRunId = runs[0].id;
          console.log(`📋 Workflow Run ID: ${workflowRunId}`);
          break;
        }
        console.log(`   Attempt ${i + 1}/15...`);
      }
      
      // Tạo VM record
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
        workflowUrl: workflowRunId 
          ? `https://github.com/${owner}/${repoName}/actions/runs/${workflowRunId}` 
          : `https://github.com/${owner}/${repoName}/actions`,
        workflowRunId: workflowRunId,
        error: null
      };
      
      vms.unshift(newVM);
      global.vms = vms;
      
      // Giới hạn chỉ giữ 20 VM gần nhất
      if (vms.length > 20) vms.pop();
      
      // Bắt đầu theo dõi workflow nếu có run ID
      if (workflowRunId) {
        monitorWorkflowStatus(githubToken, owner, repoName, newVM.id, workflowRunId);
      }
      
      console.log('🎉 VM CREATION INITIATED SUCCESSFULLY!');
      console.log(`🔗 Repository: https://github.com/${owner}/${repoName}`);
      console.log(`🔗 Workflow: ${newVM.workflowUrl}`);
      console.log('========================================\n');
      
      return res.status(200).json({ 
        success: true, 
        ...newVM,
        message: `✅ Đã khởi tạo VM "${vmUsername}" thành công. VM sẽ sẵn sàng trong 2-3 phút.`
      });
      
    } catch (error) {
      console.error('❌ UNEXPECTED ERROR:', error);
      console.error('========================================\n');
      return res.status(500).json({ 
        success: false, 
        error: error.message || 'Lỗi không xác định khi tạo VM' 
      });
    }
  }
  
  // DELETE: Xóa VM
  if (req.method === 'DELETE') {
    const { id } = req.query;
    const vmIndex = vms.findIndex(vm => vm.id === id);
    
    if (vmIndex === -1) {
      return res.status(404).json({ 
        success: false, 
        error: 'Không tìm thấy Virtual Machine' 
      });
    }
    
    const deletedVM = vms[vmIndex];
    vms.splice(vmIndex, 1);
    global.vms = vms;
    
    console.log(`🗑️ Deleted VM: ${deletedVM.name} (${deletedVM.id})`);
    
    return res.status(200).json({ 
      success: true, 
      message: 'Đã xóa Virtual Machine thành công',
      deleted: deletedVM.id
    });
  }
  
  // Method không được hỗ trợ
  return res.status(405).json({ 
    success: false, 
    error: `Method ${req.method} not allowed` 
  });
}
