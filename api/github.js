// api/github.js - Thêm debug chi tiết
const GITHUB_API = 'https://api.github.com';

function isValidGitHubTokenFormat(token) {
  if (!token || typeof token !== 'string') return false;
  const validPatterns = [
    /^github_pat_[A-Za-z0-9_]+$/,
    /^ghp_[A-Za-z0-9]+$/,
    /^gho_[A-Za-z0-9]+$/,
    /^ghu_[A-Za-z0-9]+$/,
    /^ghs_[A-Za-z0-9]+$/
  ];
  return validPatterns.some(pattern => pattern.test(token));
}

function isValidRepoName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 100) return false;
  const repoRegex = /^[a-z0-9][a-z0-9.-]*[a-z0-9]$/;
  if (!repoRegex.test(name)) return false;
  if (/[-.]{2,}/.test(name)) return false;
  return true;
}

async function getGitHubUser(token) {
  try {
    console.log(`🔍 Fetching user from GitHub API...`);
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`❌ GitHub API error: ${res.status} - ${errorText}`);
      return null;
    }
    
    const user = await res.json();
    console.log(`✅ GitHub user: ${user.login}`);
    return user;
  } catch (error) {
    console.error('❌ Get user error:', error);
    return null;
  }
}

export async function validateGitHubToken(token) {
  // Kiểm tra định dạng
  if (!isValidGitHubTokenFormat(token)) {
    return { 
      valid: false, 
      error: 'Token GitHub không đúng định dạng. Token phải bắt đầu bằng "github_pat_", "ghp_", "gho_", "ghu_" hoặc "ghs_".' 
    };
  }
  
  // Kiểm tra với API
  const user = await getGitHubUser(token);
  if (!user) {
    return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn. Vui lòng tạo token mới tại https://github.com/settings/tokens' };
  }
  
  return { valid: true, user: user };
}

export async function createRepository(token, name, description) {
  try {
    // Kiểm tra tên repository
    if (!isValidRepoName(name)) {
      throw new Error(`Tên repository "${name}" không hợp lệ. Chỉ được dùng chữ thường, số, dấu gạch ngang (-) hoặc dấu chấm (.).`);
    }
    
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không thể xác thực user');
    
    console.log(`📁 Creating repository: ${name}`);
    
    const response = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        description: description || 'Created by Singularity Cloud',
        private: false,
        auto_init: true,
        has_wiki: false,
        has_issues: false,
        has_projects: false
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error(`❌ Create repo failed: ${response.status}`, error);
      
      if (response.status === 422) {
        throw new Error(`Lỗi 422: ${error.message || 'Tên repository không hợp lệ hoặc đã tồn tại'}`);
      }
      if (response.status === 401) {
        throw new Error('Token không có quyền tạo repository. Cần quyền "repo".');
      }
      if (response.status === 403) {
        throw new Error('Token không có quyền tạo repository hoặc đã hết hạn.');
      }
      throw new Error(error.message || `HTTP ${response.status}`);
    }
    
    const repo = await response.json();
    console.log(`✅ Repository created: ${repo.full_name}`);
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    return { success: true, repo: repo, owner: user.login };
  } catch (error) {
    console.error('❌ Create repo error:', error);
    return { success: false, error: error.message };
  }
}

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

export default {
  validateGitHubToken,
  createRepository,
  deleteRepository,
  isValidRepoName,
  isValidGitHubTokenFormat
};
