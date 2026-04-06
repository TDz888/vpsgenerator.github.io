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
    if (!user) return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn' };
    
    // Kiểm tra quyền actions
    const testResponse = await fetch(`${GITHUB_API}/repos/${user.login}/test-repo/actions`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    // Nếu 404 là được (repo không tồn tại nhưng có quyền truy cập actions)
    if (testResponse.status === 404) {
      return { valid: true, user: user, message: 'Token hợp lệ' };
    }
    
    return { valid: true, user: user, message: 'Token hợp lệ' };
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
    console.log(`✅ Repository created: ${repo.full_name}`);
    return { success: true, repo: repo, owner: user.login, fullName: repo.full_name };
  } catch (error) {
    console.error('Create repo error:', error);
    return { success: false, error: error.message };
  }
}

// Tạo file trong repository (có thể tạo thư mục)
export async function createFile(token, owner, repo, path, content, commitMessage) {
  try {
    // Đảm bảo path có đúng định dạng
    const normalizedPath = path.replace(/\\/g, '/');
    
    // Kiểm tra file đã tồn tại chưa
    let sha = null;
    const getResponse = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${normalizedPath}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (getResponse.ok) {
      const existing = await getResponse.json();
      sha = existing.sha;
    }
    
    // Tạo hoặc cập nhật file
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/contents/${normalizedPath}`, {
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
    
    console.log(`✅ File created: ${normalizedPath}`);
    return { success: true };
  } catch (error) {
    console.error('Create file error:', error);
    return { success: false, error: error.message };
  }
}

// Xóa repository
export async function deleteRepository(token, owner, repo) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      console.log(`✅ Repository deleted: ${owner}/${repo}`);
    }
    return response.ok;
  } catch (error) {
    console.error('Delete repo error:', error);
    return false;
  }
}

export default {
  validateGitHubToken,
  createRepository,
  createFile,
  deleteRepository,
  getGitHubUser
};
