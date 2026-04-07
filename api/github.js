// api/github.js - Xử lý GitHub API với validation mạnh mẽ
const GITHUB_API = 'https://api.github.com';

// Danh sách đầy đủ các prefix token hợp lệ của GitHub
function isValidGitHubTokenFormat(token) {
  if (!token || typeof token !== 'string') return false;
  const validPatterns = [
    /^github_pat_[A-Za-z0-9_]+$/,   // Fine-grained personal access token
    /^ghp_[A-Za-z0-9]+$/,           // Classic personal access token
    /^gho_[A-Za-z0-9]+$/,           // OAuth App token
    /^ghu_[A-Za-z0-9]+$/,           // GitHub App User-to-Server token
    /^ghs_[A-Za-z0-9]+$/            // GitHub App Server-to-Server token
  ];
  return validPatterns.some(pattern => pattern.test(token));
}

/**
 * Kiểm tra tên repository CHÍNH XÁC theo quy tắc GitHub
 * Nguồn: https://docs.github.com/en/rest/repos/repos#create-a-repository-for-the-authenticated-user
 * Quy tắc:
 * - Chỉ được phép: a-z, 0-9, dấu gạch ngang (-), dấu chấm (.)
 * - Không được bắt đầu hoặc kết thúc bằng dấu gạch ngang hoặc dấu chấm
 * - Không được có dấu gạch ngang hoặc dấu chấm liên tiếp
 * - Độ dài: 1-100 ký tự
 */
function isValidRepoName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length < 1 || name.length > 100) return false;
  
  // Regex chính xác theo yêu cầu của GitHub API
  // Bắt đầu bằng chữ hoặc số, kết thúc bằng chữ hoặc số
  // Ở giữa có thể có chữ, số, dấu gạch ngang, dấu chấm
  const repoRegex = /^[a-z0-9]+[a-z0-9.-]*[a-z0-9]$/;
  
  if (!repoRegex.test(name)) return false;
  
  // Không được có dấu gạch ngang hoặc dấu chấm liên tiếp
  if (/[-.]{2,}/.test(name)) return false;
  
  return true;
}

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

export async function validateGitHubToken(token) {
  // Kiểm tra định dạng token trước
  if (!isValidGitHubTokenFormat(token)) {
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

export async function createRepository(token, name, description) {
  try {
    // Kiểm tra tên repository trước khi gửi request
    if (!isValidRepoName(name)) {
      throw new Error(`Tên repository "${name}" không hợp lệ. Chỉ được dùng chữ thường, số, dấu gạch ngang (-) hoặc dấu chấm (.). Không được bắt đầu hoặc kết thúc bằng dấu gạch ngang/dấu chấm.`);
    }
    
    const user = await getGitHubUser(token);
    if (!user) throw new Error('Không thể xác thực user');
    
    console.log(`📁 Creating repository: ${name}`);
    console.log(`📁 Owner: ${user.login}`);
    
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
      } else if (response.status === 401) {
        throw new Error('Token không có quyền tạo repository. Cần quyền "repo".');
      } else if (response.status === 403) {
        throw new Error('Token không có quyền tạo repository hoặc đã hết hạn.');
      }
      throw new Error(error.message || `HTTP ${response.status}: Không thể tạo repository`);
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
  isValidRepoName,
  isValidGitHubTokenFormat
};
