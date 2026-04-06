// api/github.js
const GITHUB_API = 'https://api.github.com';

// [FIX] Cập nhật danh sách đầy đủ các prefix Token hợp lệ của GitHub
function isValidGitHubTokenFormat(token) {
    if (!token || typeof token !== 'string') return false;
    // List đầy đủ các prefix chính thức
    const validPatterns = [
        /^github_pat_[A-Za-z0-9_]+$/,   // Fine-grained personal access token
        /^ghp_[A-Za-z0-9]+$/,           // Classic personal access token
        /^gho_[A-Za-z0-9]+$/,           // OAuth App token
        /^ghu_[A-Za-z0-9]+$/,           // GitHub App User-to-Server token
        /^ghs_[A-Za-z0-9]+$/            // GitHub App Server-to-Server token
    ];
    return validPatterns.some(pattern => pattern.test(token));
}

// [FIX] Chuẩn hóa regex kiểm tra tên repo theo đúng docs.github.com [citation:3][citation:6]
function isValidRepoName(name) {
    if (!name || typeof name !== 'string') return false;
    if (name.length < 1 || name.length > 100) return false;
    
    // Quy tắc: Chỉ a-z, 0-9, dấu gạch ngang (-), dấu chấm (.)
    // Không bắt đầu hoặc kết thúc bằng dấu gạch ngang hoặc dấu chấm
    // Không có dấu gạch ngang hoặc dấu chấm liên tiếp
    const repoRegex = /^[a-z0-9]+[a-z0-9.-]*[a-z0-9]+$/;
    return repoRegex.test(name);
}

// ... (các hàm khác giữ nguyên, chỉ thay đổi validation)
