// API xử lý GitHub - Tạo repository
const GITHUB_API = 'https://api.github.com';

// Kiểm tra định dạng GitHub Token
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

export async function validateGitHubToken(token) {
  if (!isValidGitHubTokenFormat(token)) {
    return { 
      valid: false, 
      error: 'Token GitHub không đúng định dạng. Token phải bắt đầu bằng "github_pat_" hoặc "ghp_". Vui lòng tạo token mới.'
    };
  }
  
  try {
    const user = await getGitHubUser(token);
    if (!user) {
      return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn' };
    }
    return { valid: true, user: user };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Kiểm tra tên repository hợp lệ
function isValidRepoName(name) {
  if (!name || name.length < 1 || name.length > 100) return false;
  // Chỉ cho phép a-z, 0-9, dấu gạch ngang, dấu chấm
  const validPattern = /^[a-z0-9.-]+$/;
  return validPattern.test(name);
}

export async function createRepository(token, repoName, description) {
  try {
    // Kiểm tra tên repository
    if (!isValidRepoName(repoName)) {
      throw new Error(`Tên repository "${repoName}" không hợp lệ. Chỉ được dùng chữ thường, số, dấu gạch ngang và dấu chấm.`);
    }
    
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không thể xác thực user');
    
    console.log(`📁 Creating repository: ${repoName}`);
    
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
      console.error(`Create repo failed: ${response.status}`, error);
      
      if (response.status === 422) {
        throw new Error('Tên repository không hợp lệ hoặc đã tồn tại. Chỉ được dùng chữ thường, số, dấu gạch ngang và dấu chấm.');
      } else if (response.status === 401) {
        throw new Error('Token không có quyền tạo repository. Cần quyền "repo".');
      }
      throw new Error(error.message || 'Không thể tạo repository');
    }
    
    const repo = await response.json();
    console.log(`✅ Repository created: ${repo.full_name}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
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
  getGitHubUser,
  isValidRepoName
};
