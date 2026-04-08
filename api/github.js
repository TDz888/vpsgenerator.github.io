// api/github.js - Safe API calls
const GITHUB_API = 'https://api.github.com';

async function safeFetch(url, options) {
  try {
    const res = await fetch(url, options);
    const text = await res.text();
    try {
      return { ok: res.ok, data: JSON.parse(text), status: res.status };
    } catch(e) {
      return { ok: res.ok, data: { message: text }, status: res.status };
    }
  } catch(e) {
    return { ok: false, data: { message: e.message }, status: 0 };
  }
}

export async function validateGitHubToken(token) {
  if (!token || token.length < 10) {
    return { valid: false, error: 'Token too short' };
  }
  
  const result = await safeFetch(`${GITHUB_API}/user`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (result.ok && result.data && result.data.login) {
    return { valid: true, user: result.data };
  }
  return { valid: false, error: result.data?.message || 'Invalid token' };
}

export async function createRepository(token, name, description) {
  try {
    const result = await safeFetch(`${GITHUB_API}/user/repos`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: name,
        description: description || 'Created by Singularity Cloud',
        private: false,
        auto_init: true
      })
    });
    
    if (result.ok && result.data) {
      return { 
        success: true, 
        repo: result.data, 
        owner: result.data.owner?.login || 'unknown' 
      };
    }
    return { success: false, error: result.data?.message || 'Create failed' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

export async function deleteRepository(token, owner, repo) {
  try {
    await safeFetch(`${GITHUB_API}/repos/${owner}/${repo}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    return true;
  } catch(e) {
    return false;
  }
}
