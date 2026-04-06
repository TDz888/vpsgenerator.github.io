// ==================== FILE: api/vpsuser.js ====================
// Dành cho repository: https://github.com/TDz888/vpsgenerator.github.io
// Tương thích với Vercel Serverless Function hoặc Node.js backend

const { Octokit } = require('@octokit/rest');

// Cấu hình repository lưu trữ dữ liệu VM
// Bạn có thể tạo repo riêng hoặc dùng chính repo này
const DATA_REPO_OWNER = 'TDz888';
const DATA_REPO_NAME = 'vpsgenerator.github.io';
const VM_DATA_PATH = 'vms-data.json'; // File lưu danh sách VM

// Helper: Tạo ID duy nhất cho VM
function generateVMId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `vps-${timestamp}-${random}`;
}

// Helper: Tạo thời gian hết hạn (6 giờ)
function getExpiryTime() {
  const expiry = new Date();
  expiry.setHours(expiry.getHours() + 6);
  return expiry.toISOString();
}

// Helper: Lấy nội dung file từ GitHub (kèm SHA)
async function getFileContent(octokit, owner, repo, path) {
  try {
    const response = await octokit.repos.getContent({
      owner: owner,
      repo: repo,
      path: path,
    });
    
    const content = Buffer.from(response.data.content, 'base64').toString('utf-8');
    return {
      content: JSON.parse(content),
      sha: response.data.sha,
    };
  } catch (error) {
    // File chưa tồn tại (404)
    if (error.status === 404) {
      return { content: [], sha: null };
    }
    throw error;
  }
}

// Helper: Ghi nội dung file lên GitHub (xử lý SHA đúng cách - QUAN TRỌNG)
async function saveFileContent(octokit, owner, repo, path, data, sha = null) {
  const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
  
  const params = {
    owner: owner,
    repo: repo,
    path: path,
    message: `Update VM data: ${new Date().toISOString()}`,
    content: content,
  };
  
  // 🔥 FIX LỖI "sha" wasn't supplied
  // CHỈ thêm sha khi file đã tồn tại (cập nhật), KHÔNG thêm khi tạo mới
  if (sha) {
    params.sha = sha;
  }
  
  const response = await octokit.repos.createOrUpdateFileContents(params);
  return response.data;
}

// Hàm trigger GitHub Actions workflow (tạo VM thực tế)
async function triggerWorkflow(octokit, owner, repo, vmId, tailscaleKey, githubToken) {
  try {
    await octokit.actions.createWorkflowDispatch({
      owner: owner,
      repo: repo,
      workflow_id: 'vps.yml', // Tên file workflow trong .github/workflows/
      ref: 'main',
      inputs: {
        vm_id: vmId,
        tailscale_key: tailscaleKey,
        github_token: githubToken,
      },
    });
    return { success: true };
  } catch (error) {
    console.error('Workflow trigger failed:', error.message);
    return { success: false, error: error.message };
  }
}

// ==================== MAIN HANDLER ====================
module.exports = async (req, res) => {
  // CORS headers - cho phép frontend gọi
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed. Use POST.' 
    });
  }
  
  const { githubToken, tailscaleKey } = req.body;
  
  // Validate inputs
  if (!githubToken || !tailscaleKey) {
    return res.status(400).json({ 
      success: false, 
      error: 'Missing required fields: githubToken and tailscaleKey' 
    });
  }
  
  try {
    // Khởi tạo Octokit với token của user
    const octokit = new Octokit({ 
      auth: githubToken,
      userAgent: 'VPSGenerator v1.0'
    });
    
    // 1. Kiểm tra token GitHub có hợp lệ và có đủ quyền không
    try {
      const { data: user } = await octokit.users.getAuthenticated();
      console.log(`Authenticated as: ${user.login}`);
      
      // Kiểm tra token có quyền repo không (thử tạo một file test)
      await octokit.repos.listForAuthenticatedUser({ per_page: 1 });
    } catch (authError) {
      console.error('Auth error:', authError);
      return res.status(401).json({ 
        success: false, 
        error: 'Invalid or insufficient GitHub Token. Required scopes: repo, workflow' 
      });
    }
    
    // 2. Đọc dữ liệu VM hiện tại (xử lý SHA)
    let existingVMs = [];
    let fileSha = null;
    
    try {
      const fileData = await getFileContent(octokit, DATA_REPO_OWNER, DATA_REPO_NAME, VM_DATA_PATH);
      existingVMs = fileData.content;
      fileSha = fileData.sha;
    } catch (readError) {
      console.log('No existing VM data file, will create new one');
      existingVMs = [];
      fileSha = null;
    }
    
    // 3. Tạo VM mới
    const vmId = generateVMId();
    const now = new Date();
    
    const newVM = {
      id: vmId,
      name: `singularity-${vmId.slice(-8)}`,
      repoUrl: `https://github.com/${DATA_REPO_OWNER}/${DATA_REPO_NAME}/actions`,
      actionsUrl: `https://github.com/${DATA_REPO_OWNER}/${DATA_REPO_NAME}/actions/runs`,
      novncUrl: `https://novnc.example.com/vm/${vmId}`, // Có thể thay bằng URL thực tế
      username: 'runneradmin',
      password: 'VPS@123456',
      tailscaleKey: tailscaleKey,
      createdAt: now.toISOString(),
      expiresAt: getExpiryTime(),
      status: 'creating',
    };
    
    // 4. Thêm vào danh sách và lưu lên GitHub
    const updatedVMs = [newVM, ...existingVMs];
    
    // 🔥 Lưu ý: hàm saveFileContent đã xử lý SHA đúng cách
    await saveFileContent(
      octokit, 
      DATA_REPO_OWNER, 
      DATA_REPO_NAME, 
      VM_DATA_PATH, 
      updatedVMs, 
      fileSha
    );
    
    // 5. Trigger GitHub Actions workflow để khởi tạo VM thực tế
    const workflowResult = await triggerWorkflow(
      octokit, 
      DATA_REPO_OWNER, 
      DATA_REPO_NAME, 
      vmId, 
      tailscaleKey, 
      githubToken
    );
    
    if (!workflowResult.success) {
      console.warn('Workflow trigger warning:', workflowResult.error);
      // Không fail request, vẫn trả về VM đã tạo
    }
    
    // 6. Trả về kết quả thành công cho frontend
    return res.status(200).json({
      success: true,
      id: newVM.id,
      name: newVM.name,
      repoUrl: newVM.repoUrl,
      actionsUrl: newVM.actionsUrl,
      novncUrl: newVM.novncUrl,
      username: newVM.username,
      password: newVM.password,
      createdAt: newVM.createdAt,
      expiresAt: newVM.expiresAt,
      status: newVM.status,
      message: 'VM is being created. Check GitHub Actions for progress.'
    });
    
  } catch (error) {
    console.error('VM Creation Error:', error);
    
    // Phân loại lỗi để gửi thông báo phù hợp
    let errorMessage = error.message;
    let statusCode = 500;
    
    if (error.status === 401) {
      errorMessage = 'Authentication failed. Your GitHub token may be invalid or expired.';
      statusCode = 401;
    } else if (error.status === 403) {
      errorMessage = 'Permission denied. Make sure your token has "repo" and "workflow" scopes.';
      statusCode = 403;
    } else if (error.status === 422) {
      errorMessage = 'GitHub API error: Invalid request. Please check your token permissions.';
      statusCode = 422;
    } else if (error.message.includes('sha')) {
      errorMessage = 'GitHub API error related to file SHA. This has been fixed. Please try again.';
    }
    
    return res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
};
