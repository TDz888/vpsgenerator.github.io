// api/github.js - GitHub API, xử lý repository
const GITHUB_API = 'https://api.github.com';

// Tạo repository mới
export async function createRepository(token, name, description) {
  try {
    const cleanToken = token ? token.trim() : '';
    const cleanName = name ? name.trim() : '';
    
    console.log(`📁 Creating repo: ${cleanName}`);
    
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
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
    
    const data = await res.json();
    
    if (!res.ok) {
      console.log(`❌ Create repo failed: ${res.status}`);
      return { 
        success: false, 
        error: data.message || `HTTP ${res.status}: Không thể tạo repository`
      };
    }
    
    console.log(`✅ Repo created: ${data.full_name}`);
    return { 
      success: true, 
      repo: data, 
      owner: data.owner?.login || 'unknown' 
    };
    
  } catch(error) {
    console.error('Create repo error:', error);
    return { success: false, error: error.message };
  }
}

// Xóa repository
export async function deleteRepository(token, owner, repo) {
  try {
    console.log(`🗑️ Deleting repo: ${owner}/${repo}`);
    const res = await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    
    if (res.ok) {
      console.log(`✅ Repo deleted: ${owner}/${repo}`);
    } else {
      console.log(`⚠️ Failed to delete: ${owner}/${repo} - ${res.status}`);
    }
    return res.ok;
  } catch(error) {
    console.error('Delete error:', error);
    return false;
  }
}
