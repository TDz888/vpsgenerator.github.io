// api/github.js - No regex validation
const GITHUB_API = 'https://api.github.com';

export async function validateGitHubToken(token) {
  try {
    const res = await fetch(`${GITHUB_API}/user`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!res.ok) {
      return { valid: false, error: 'Token invalid or expired' };
    }
    
    const user = await res.json();
    return { valid: true, user: user };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

export async function createRepository(token, name, description) {
  try {
    const res = await fetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        description: description,
        private: false,
        auto_init: true
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      return { success: false, error: err.message || `HTTP ${res.status}` };
    }
    
    const repo = await res.json();
    return { success: true, repo: repo };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function deleteRepository(token, owner, repo) {
  try {
    await fetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return true;
  } catch (err) {
    return false;
  }
}
