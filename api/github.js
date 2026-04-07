// api/github.js - Xử lý GitHub API với token validation LINH HOẠT
const GITHUB_API = 'https://api.github.com';

/**
 * Kiểm tra token GitHub với API - KHÔNG kiểm tra format cứng
 * Để GitHub tự xác thực
 */
async function getGitHubUser(token) {
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    if (!res.ok) {
      const error = await res.text();
      console.error(`GitHub API error: ${res.status} - ${error}`);
      return null;
    }
    return await res.json();
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
}

/**
 * Kiểm tra tên repository theo chuẩn GitHub NGHIÊM NGẶT
 * Cho phép: a-z, A-Z, 0-9, dấu gạch ngang, dấu gạch dưới, dấu chấm
 * KHÔNG bắt đầu hoặc kết thúc bằng dấu chấm
 * KHÔNG chứa hai dấu chấm liên tiếp
 */
function isValidRepoName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 100) return false;
  // Regex chuẩn GitHub - NGHIÊM NGẶT
  const repoRegex = /^[a-zA-Z0-9][a-zA-Z0-9._-]*[a-zA-Z0-9]$/;
  // Không chứa hai dấu chấm liên tiếp
  if (name.includes('..')) return false;
  return repoRegex.test(name);
}

export async function validateGitHubToken(token) {
  // KHÔNG kiểm tra format - để GitHub API tự xác thực
  
  // Kiểm tra với API
  const user = await getGitHubUser(token);
  if (!user) {
    return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại token.' };
  }
  
  console.log(`✅ Token valid for user: ${user.login}`);
  return { valid: true, user: user };
}

export async function createRepository(token, name, description) {
  try {
    // Kiểm tra tên repository theo chuẩn GitHub NGHIÊM NGẶT
    if (!isValidRepoName(name)) {
      throw new Error(`Tên "${name}" không hợp lệ theo chuẩn GitHub. Chỉ được dùng: a-z, A-Z, 0-9, dấu gạch ngang, dấu gạch dưới, dấu chấm. Không bắt đầu/kết thúc bằng dấu chấm.`);
    }
    
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không xác thực được user');
    
    console.log(`📁 Creating repository: ${name}`);
    console.log(`📁 Owner: ${user.login}`);
    console.log(`📁 Name validation: ${isValidRepoName(name) ? 'PASSED' : 'FAILED'}`);
    
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
      console.error(`Create repo failed: ${response.status}`, error);
      
      if (response.status === 422) {
        throw new Error(`Tên repository không hợp lệ hoặc đã tồn tại. Chi tiết: ${error.message || 'Validation failed'}`);
      }
      if (response.status === 401) {
        throw new Error('Token không có quyền tạo repository. Cần quyền "repo".');
      }
      if (response.status === 403) {
        throw new Error('Token không có quyền tạo repository hoặc đã hết hạn.');
      }
      throw new Error(error.message || `HTTP ${response.status}: Không thể tạo repository`);
    }
    
    const repo = await response.json();
    console.log(`✅ Repository created: ${repo.full_name}`);
    
    return { success: true, repo: repo, owner: user.login };
  } catch (error) {
    console.error('Create repo error:', error);
    return { success: false, error: error.message };
  }
}

export async function deleteRepository(token, owner, repo) {
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok) {
      console.log(`✅ Repository deleted: ${owner}/${repo}`);
    } else {
      console.log(`❌ Failed to delete repo: ${owner}/${repo} - ${response.status}`);
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
  deleteRepository,
  isValidRepoName
};
