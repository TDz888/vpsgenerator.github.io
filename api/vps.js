// API xử lý VPS - Tích hợp GitHub Actions & Tailscale
const GITHUB_API = 'https://api.github.com';
let vms = global.vms || [];

// Helper: Validate GitHub Token
async function validateGitHubToken(token) {
  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Helper: Trigger GitHub Workflow
async function triggerGitHubWorkflow(githubToken, tailscaleKey) {
  const [owner, repo] = process.env.VERCEL_GIT_REPO_OWNER 
    ? [process.env.VERCEL_GIT_REPO_OWNER, process.env.VERCEL_GIT_REPO_SLUG]
    : ['TDz888', 'vpsgenerator.github.io'];
  
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/create-vm.yml/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ref: 'main',
        inputs: {
          tailscale_key: tailscaleKey
        }
      })
    });
    
    return response.ok;
  } catch (error) {
    console.error('Workflow trigger error:', error);
    return false;
  }
}

// Helper: Lấy workflow run ID mới nhất
async function getLatestWorkflowRun(githubToken) {
  const [owner, repo] = process.env.VERCEL_GIT_REPO_OWNER 
    ? [process.env.VERCEL_GIT_REPO_OWNER, process.env.VERCEL_GIT_REPO_SLUG]
    : ['TDz888', 'vpsgenerator.github.io'];
  
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/runs?per_page=1`, {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    const data = await response.json();
    return data.workflow_runs?.[0] || null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
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
    const { githubToken, tailscaleKey } = req.body;
    
    // Validate input
    if (!githubToken || !tailscaleKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Thiếu GitHub Token hoặc Tailscale Key' 
      });
    }
    
    // Validate GitHub Token
    const isValidToken = await validateGitHubToken(githubToken);
    if (!isValidToken) {
      return res.status(401).json({ 
        success: false, 
        error: 'GitHub Token không hợp lệ hoặc hết hạn' 
      });
    }
    
    // Trigger GitHub Workflow
    const workflowTriggered = await triggerGitHubWorkflow(githubToken, tailscaleKey);
    if (!workflowTriggered) {
      return res.status(500).json({ 
        success: false, 
        error: 'Không thể kích hoạt GitHub Workflow. Kiểm tra quyền token.' 
      });
    }
    
    // Chờ workflow chạy và lấy thông tin
    await new Promise(resolve => setTimeout(resolve, 3000));
    const workflowRun = await getLatestWorkflowRun(githubToken);
    
    // Tạo VM record mới
    const newVM = {
      id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      name: `singularity_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}`,
      status: 'creating',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
      username: 'runneradmin',
      password: 'VPS@123456',
      tailscaleIP: null,
      novncUrl: null,
      repoUrl: `https://github.com/${process.env.VERCEL_GIT_REPO_OWNER || 'TDz888'}/${process.env.VERCEL_GIT_REPO_SLUG || 'vpsgenerator.github.io'}`,
      workflowRunId: workflowRun?.id || null,
      githubTokenMasked: githubToken.slice(0, 8) + '...'
    };
    
    vms.unshift(newVM);
    global.vms = vms;
    
    // Giới hạn chỉ lưu 10 VM gần nhất
    if (vms.length > 10) vms.pop();
    
    return res.status(200).json({ 
      success: true, 
      ...newVM,
      message: 'VM đang được khởi tạo. Quá trình này mất 2-3 phút.'
    });
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
    
    return res.status(200).json({ success: true, message: 'Đã xóa VM thành công' });
  }
  
  return res.status(405).json({ success: false, error: 'Method not allowed' });
}
