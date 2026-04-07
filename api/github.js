// api/github.js - Xử lý GitHub API đơn giản hóa
const GITHUB_API = 'https://api.github.com';

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

// Đơn giản hóa - không check regex
function isValidRepoName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 100) return false;
  if (name.includes(' ')) return false;
  if (name.includes('..')) return false;
  // Cho phép hầu hết các ký tự, GitHub sẽ tự validate
  return true;
}

export async function validateGitHubToken(token) {
  // Trim token trước
  const cleanToken = token ? token.trim() : '';
  
  if (!cleanToken || cleanToken.length < 10) {
    return { valid: false, error: 'Token GitHub quá ngắn hoặc không hợp lệ' };
  }
  
  const user = await getGitHubUser(cleanToken);
  if (!user) {
    return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn. Vui lòng kiểm tra lại token.' };
  }
  
  console.log(`✅ Token valid for user: ${user.login}`);
  return { valid: true, user: user };
}

export async function createRepository(token, name, description) {
  try {
    const cleanToken = token ? token.trim() : '';
    const cleanName = name ? name.trim() : '';
    
    if (!isValidRepoName(cleanName)) {
      throw new Error(`Tên "${cleanName}" không hợp lệ. Chỉ dùng chữ cái, số, dấu gạch ngang, gạch dưới, chấm.`);
    }
    
    const user = await getGitHubUser(cleanToken);
    if (!user) throw new Error('Không xác thực được user');
    
    console.log(`📁 Creating repository: ${cleanName}`);
    
    const response = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: cleanName,
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
    const cleanToken = token ? token.trim() : '';
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${cleanToken}` }
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
