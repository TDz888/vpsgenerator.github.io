// API xử lý GitHub - Tạo repository, commit file, quản lý workflow
const GITHUB_API = 'https://api.github.com';

// Lấy thông tin user từ token
async function getGitHubUser(token) {
  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
}

// Kiểm tra token có hợp lệ và đủ quyền không
export async function validateGitHubToken(token) {
  try {
    const user = await getGitHubUser(token);
    if (!user) return { valid: false, error: 'Token không hợp lệ' };
    
    // Kiểm tra quyền bằng cách thử tạo repo test
    const testResponse = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `test-${Date.now()}`,
        private: true,
        auto_init: false
      })
    });
    
    if (!testResponse.ok) {
      return { 
        valid: true, 
        warning: 'Token có thể thiếu quyền tạo repo. Cần quyền: repo, workflow' 
      };
    }
    
    // Xóa repo test
    const repoName = `test-${Date.now()}`;
    await fetch(`${GITHUB_API}/repos/${user.login}/${repoName}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    return { valid: true, user: user };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Tạo repository mới
export async function createRepository(token, repoName, description = 'VM created by Singularity Cloud') {
  try {
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không thể xác thực user');
    
    const response = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: repoName,
        description: description,
        private: false,
        auto_init: true,
        has_wiki: false,
        has_issues: false,
        has_projects: false
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Không thể tạo repository');
    }
    
    const repo = await response.json();
    return { success: true, repo: repo, owner: user.login };
  } catch (error) {
    console.error('Create repo error:', error);
    return { success: false, error: error.message };
  }
}

// Tạo hoặc cập nhật file trong repository
export async function createFile(token, owner, repo, path, content, commitMessage) {
  try {
    // Kiểm tra file đã tồn tại chưa
    let sha = null;
    const getResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (getResponse.ok) {
      const existing = await getResponse.json();
      sha = existing.sha;
    }
    
    // Tạo hoặc cập nhật file
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: Buffer.from(content).toString('base64'),
        sha: sha,
        branch: 'main'
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || 'Không thể tạo file');
    }
    
    return { success: true };
  } catch (error) {
    console.error('Create file error:', error);
    return { success: false, error: error.message };
  }
}

// Lấy nội dung file từ repository
export async function getFileContent(token, owner, repo, path) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return Buffer.from(data.content, 'base64').toString('utf-8');
  } catch (error) {
    console.error('Get file error:', error);
    return null;
  }
}

// Xóa repository
export async function deleteRepository(token, owner, repo) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  } catch (error) {
    console.error('Delete repo error:', error);
    return false;
  }
}

// Lấy danh sách repositories của user
export async function listRepositories(token, perPage = 30) {
  try {
    const response = await fetch(`${GITHUB_API}/user/repos?per_page=${perPage}&sort=updated`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('List repos error:', error);
    return [];
  }
}

// Kiểm tra workflow có tồn tại không
export async function workflowExists(token, owner, repo, workflowPath) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${workflowPath}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return response.ok;
  } catch {
    return false;
  }
}

export default {
  validateGitHubToken,
  createRepository,
  createFile,
  getFileContent,
  deleteRepository,
  listRepositories,
  workflowExists,
  getGitHubUser
};
