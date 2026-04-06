// API xử lý GitHub - Tạo repository, commit file
const GITHUB_API = 'https://api.github.com';

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
  try {
    const user = await getGitHubUser(token);
    if (!user) {
      return { valid: false, error: 'Token không hợp lệ hoặc đã hết hạn' };
    }
    console.log(`✅ Token valid for user: ${user.login}`);
    return { valid: true, user: user };
  } catch (error) {
    return { valid: false, error: error.message };
  }
}

export async function createRepository(token, repoName, description) {
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
    return { success: true, repo: repo, owner: user.login };
  } catch (error) {
    console.error('Create repo error:', error);
    return { success: false, error: error.message };
  }
}

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
      throw new Error(error.message || 'Không thể tạo file');
    }
    
    console.log(`✅ File created: ${normalizedPath}`);
    return { success: true };
  } catch (error) {
    console.error('Create file error:', error);
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
  createFile,
  deleteRepository,
  getGitHubUser
};
