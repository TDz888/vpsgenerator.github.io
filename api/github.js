// API xử lý GitHub - Tạo repository, commit file
const GITHUB_API = 'https://api.github.com';

// Kiểm tra định dạng GitHub Token
function isValidGitHubTokenFormat(token) {
  if (!token || typeof token !== 'string') return false;
  // Các định dạng token hợp lệ của GitHub
  const validPatterns = [
    /^github_pat_[A-Za-z0-9_]+$/,     // Fine-grained token
    /^ghp_[A-Za-z0-9]+$/,              // Classic token
    /^gho_[A-Za-z0-9]+$/,              // OAuth token
    /^ghu_[A-Za-z0-9]+$/,              // User-to-server token
    /^ghs_[A-Za-z0-9]+$/               // Server-to-server token
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
    if (!response.ok) {
      const error = await response.text();
      console.error(`GitHub API error: ${response.status} - ${error}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('Get user error:', error);
    return null;
  }
}

// Kiểm tra token có hợp lệ không
export async function validateGitHubToken(token) {
  // Kiểm tra định dạng token trước
  if (!isValidGitHubTokenFormat(token)) {
    console.error('❌ Invalid token format');
    return { 
      valid: false, 
      error: 'Token GitHub không đúng định dạng. Token phải bắt đầu bằng "github_pat_", "ghp_", "gho_", "ghu_" hoặc "ghs_". Vui lòng tạo token mới tại https://github.com/settings/tokens'
    };
  }
  
  try {
    const user = await getGitHubUser(token);
    if (!user) {
      return { 
        valid: false, 
        error: 'Token không hợp lệ hoặc đã hết hạn. Vui lòng tạo token mới tại https://github.com/settings/tokens'
      };
    }
    
    console.log(`✅ Token valid for user: ${user.login}`);
    return { valid: true, user: user };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

// Tạo repository mới
export async function createRepository(token, repoName, description) {
  try {
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không thể xác thực user');
    
    console.log(`📁 Creating repository: ${repoName} for user: ${user.login}`);
    
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
      console.error(`Create repo failed: ${response.status} - ${JSON.stringify(error)}`);
      
      // Xử lý lỗi cụ thể
      if (response.status === 422) {
        throw new Error('Tên repository không hợp lệ hoặc đã tồn tại. Vui lòng thử lại.');
      } else if (response.status === 401) {
        throw new Error('Token không có quyền tạo repository. Cần quyền "repo".');
      } else if (response.status === 403) {
        throw new Error('Token không có quyền tạo repository hoặc đã hết hạn.');
      }
      
      throw new Error(error.message || 'Không thể tạo repository');
    }
    
    const repo = await response.json();
    console.log(`✅ Repository created: ${repo.full_name}`);
    
    // Đợi repository được khởi tạo hoàn tất
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return { success: true, repo: repo, owner: user.login };
  } catch (error) {
    console.error('Create repo error:', error);
    return { success: false, error: error.message };
  }
}

// Tạo file trong repository
export async function createFile(token, owner, repo, path, content, commitMessage) {
  try {
    const normalizedPath = path.replace(/\\/g, '/');
    console.log(`📝 Creating file: ${owner}/${repo}/${normalizedPath}`);
    
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
        branch: 'main'
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error(`Create file failed: ${response.status} - ${JSON.stringify(error)}`);
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
  getGitHubUser,
  isValidGitHubTokenFormat
};
