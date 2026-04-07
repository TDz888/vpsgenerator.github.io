// api/debug.js - Hệ thống phân tích lỗi thông minh v2.0
// Hỗ trợ 15+ loại lỗi phổ biến

export const ERROR_TYPES = {
  // Token errors
  TOKEN_INVALID_FORMAT: 'TOKEN_INVALID_FORMAT',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_MISSING_SCOPES: 'TOKEN_MISSING_SCOPES',
  TOKEN_RATE_LIMIT: 'TOKEN_RATE_LIMIT',
  
  // Network errors
  NETWORK_CONNECTION: 'NETWORK_CONNECTION',
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  CORS_ERROR: 'CORS_ERROR',
  
  // GitHub API errors
  GITHUB_REPO_EXISTS: 'GITHUB_REPO_EXISTS',
  GITHUB_REPO_NAME_INVALID: 'GITHUB_REPO_NAME_INVALID',
  GITHUB_WORKFLOW_NOT_FOUND: 'GITHUB_WORKFLOW_NOT_FOUND',
  GITHUB_API_422: 'GITHUB_API_422',
  GITHUB_API_403: 'GITHUB_API_403',
  GITHUB_API_404: 'GITHUB_API_404',
  
  // Workflow errors
  WORKFLOW_TRIGGER_FAILED: 'WORKFLOW_TRIGGER_FAILED',
  WORKFLOW_TIMEOUT: 'WORKFLOW_TIMEOUT',
  
  // Validation errors
  VALIDATION_USERNAME: 'VALIDATION_USERNAME',
  VALIDATION_PASSWORD: 'VALIDATION_PASSWORD',
  VALIDATION_TAILSCALE: 'VALIDATION_TAILSCALE',
  
  // Unknown
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Chi tiết từng loại lỗi
 */
export const ERROR_DATABASE = {
  [ERROR_TYPES.TOKEN_INVALID_FORMAT]: {
    title: '🔑 GitHub Token sai định dạng',
    icon: '🔑',
    severity: 'high',
    commonCauses: [
      'Token không bắt đầu bằng đúng prefix (ghp_, github_pat_, gho_, ghu_, ghs_)',
      'Token bị thiếu hoặc thừa ký tự',
      'Token chứa khoảng trắng hoặc ký tự đặc biệt'
    ],
    solutions: [
      'Tạo token mới tại https://github.com/settings/tokens',
      'Chọn "Generate new token (classic)"',
      'Đặt tên: Singularity Cloud',
      'Chọn thời hạn: No expiration',
      'Chọn quyền: repo (tất cả) và workflow',
      'Copy token ngay sau khi tạo (không đóng trang)'
    ],
    example: 'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ123456789'
  },
  
  [ERROR_TYPES.TOKEN_EXPIRED]: {
    title: '⏰ GitHub Token đã hết hạn',
    icon: '⏰',
    severity: 'high',
    commonCauses: [
      'Token được tạo với thời hạn cụ thể và đã hết hạn',
      'Token bị thu hồi do bảo mật'
    ],
    solutions: [
      'Tạo token mới tại https://github.com/settings/tokens',
      'Chọn thời hạn "No expiration"',
      'Xóa token cũ để tránh nhầm lẫn'
    ]
  },
  
  [ERROR_TYPES.TOKEN_MISSING_SCOPES]: {
    title: '🚫 Token thiếu quyền cần thiết',
    icon: '🚫',
    severity: 'high',
    commonCauses: [
      'Token không được cấp quyền "repo"',
      'Token không được cấp quyền "workflow"'
    ],
    solutions: [
      'Truy cập https://github.com/settings/tokens',
      'Chọn token đang dùng',
      'Kéo xuống mục "Scopes"',
      'Chọn ✅ repo (chọn tất cả)',
      'Chọn ✅ workflow',
      'Nhấn "Update token"'
    ]
  },
  
  [ERROR_TYPES.TOKEN_RATE_LIMIT]: {
    title: '📊 GitHub API Rate Limit',
    icon: '📊',
    severity: 'medium',
    commonCauses: [
      'Quá nhiều request trong 1 giờ (5000 request/giờ với token)',
      'Dùng chung token cho nhiều người'
    ],
    solutions: [
      'Đợi 15-30 phút cho rate limit reset',
      'Tạo token GitHub mới để tiếp tục',
      'Hạn chế tạo VM liên tục'
    ]
  },
  
  [ERROR_TYPES.NETWORK_CONNECTION]: {
    title: '🌐 Mất kết nối mạng',
    icon: '🌐',
    severity: 'high',
    commonCauses: [
      'Internet không ổn định',
      'Firewall hoặc VPN chặn kết nối',
      'Server đang bảo trì'
    ],
    solutions: [
      'Kiểm tra lại kết nối internet',
      'Tắt VPN hoặc firewall tạm thời',
      'Làm mới trang (F5)',
      'Thử lại sau vài phút'
    ]
  },
  
  [ERROR_TYPES.NETWORK_TIMEOUT]: {
    title: '⏱️ Timeout - Kết nối quá lâu',
    icon: '⏱️',
    severity: 'medium',
    commonCauses: [
      'Server phản hồi chậm',
      'Đường truyền mạng kém',
      'Request quá lớn'
    ],
    solutions: [
      'Thử lại sau 30 giây',
      'Kiểm tra tốc độ mạng',
      'Dùng mạng khác nếu có thể'
    ]
  },
  
  [ERROR_TYPES.GITHUB_REPO_NAME_INVALID]: {
    title: '📁 Tên repository không hợp lệ',
    icon: '📁',
    severity: 'high',
    commonCauses: [
      'Tên chứa ký tự đặc biệt không cho phép',
      'Tên bắt đầu hoặc kết thúc bằng dấu chấm',
      'Tên trùng với repository đã có'
    ],
    solutions: [
      'Hệ thống sẽ tự động tạo tên hợp lệ',
      'Nếu lỗi tiếp, hãy thử lại sau',
      'Kiểm tra repository trùng tên tại GitHub'
    ]
  },
  
  [ERROR_TYPES.GITHUB_WORKFLOW_NOT_FOUND]: {
    title: '⚙️ Không tìm thấy workflow file',
    icon: '⚙️',
    severity: 'medium',
    commonCauses: [
      'Workflow chưa được GitHub index kịp',
      'Workflow file bị lỗi cú pháp',
      'Token thiếu quyền đọc workflow'
    ],
    solutions: [
      'Đợi 10-15 giây rồi thử lại',
      'Kiểm tra repository có file .github/workflows/ không',
      'Đảm bảo token có quyền workflow'
    ]
  },
  
  [ERROR_TYPES.WORKFLOW_TRIGGER_FAILED]: {
    title: '🚀 Trigger workflow thất bại',
    icon: '🚀',
    severity: 'high',
    commonCauses: [
      'Workflow file bị lỗi cú pháp YAML',
      'Repository không có branch main',
      'Token thiếu quyền workflow'
    ],
    solutions: [
      'Kiểm tra workflow file tại repository',
      'Đảm bảo branch main tồn tại',
      'Tạo lại VM với token mới'
    ]
  },
  
  [ERROR_TYPES.WORKFLOW_TIMEOUT]: {
    title: '⏰ Workflow chạy quá thời gian',
    icon: '⏰',
    severity: 'medium',
    commonCauses: [
      'VM tạo quá lâu (>6 phút)',
      'GitHub Actions đang bận',
      'Lỗi trong quá trình cài đặt'
    ],
    solutions: [
      'Kiểm tra trạng thái tại GitHub Actions',
      'Thử tạo lại VM',
      'Xem logs chi tiết tại repository'
    ]
  },
  
  [ERROR_TYPES.VALIDATION_USERNAME]: {
    title: '👤 Tên đăng nhập không hợp lệ',
    icon: '👤',
    severity: 'low',
    commonCauses: [
      'Tên đăng nhập quá ngắn (<5 ký tự)',
      'Tên chứa ký tự đặc biệt',
      'Tên đã được sử dụng'
    ],
    solutions: [
      'Nhập tên có ít nhất 5 ký tự',
      'Chỉ dùng chữ thường và số',
      'Bấm nút Random để tạo tên tự động'
    ]
  },
  
  [ERROR_TYPES.VALIDATION_PASSWORD]: {
    title: '🔐 Mật khẩu không đủ mạnh',
    icon: '🔐',
    severity: 'low',
    commonCauses: [
      'Mật khẩu quá ngắn (<8 ký tự)',
      'Mật khẩu quá đơn giản',
      'Thiếu ký tự đặc biệt'
    ],
    solutions: [
      'Dùng mật khẩu ít nhất 8 ký tự',
      'Bấm nút Random để tạo mật khẩu mạnh',
      'Kết hợp chữ hoa, thường, số, ký tự đặc biệt'
    ]
  },
  
  [ERROR_TYPES.VALIDATION_TAILSCALE]: {
    title: '🌀 Tailscale Key không hợp lệ',
    icon: '🌀',
    severity: 'high',
    commonCauses: [
      'Key không bắt đầu bằng "tskey-"',
      'Key đã hết hạn hoặc bị thu hồi',
      'Key không có quyền reusable'
    ],
    solutions: [
      'Tạo key mới tại https://login.tailscale.com/admin/authkeys',
      'Chọn "Reusable" khi tạo key',
      'Copy toàn bộ key (bắt đầu bằng tskey-)'
    ]
  },
  
  [ERROR_TYPES.GITHUB_API_422]: {
    title: '📦 Lỗi 422 - Repository đã tồn tại',
    icon: '📦',
    severity: 'medium',
    commonCauses: [
      'Repository cùng tên đã tồn tại',
      'Tên repository không hợp lệ'
    ],
    solutions: [
      'Hệ thống sẽ tự động tạo tên khác',
      'Thử lại sau vài giây',
      'Xóa repository cũ nếu không cần'
    ]
  },
  
  [ERROR_TYPES.GITHUB_API_403]: {
    title: '🚫 Lỗi 403 - Không đủ quyền truy cập',
    icon: '🚫',
    severity: 'high',
    commonCauses: [
      'Token không có quyền tạo repository',
      'Token bị GitHub chặn do bảo mật',
      'Tài khoản GitHub bị giới hạn'
    ],
    solutions: [
      'Kiểm tra lại quyền token (cần repo + workflow)',
      'Tạo token mới với đầy đủ quyền',
      'Kiểm tra email xác thực GitHub'
    ]
  },
  
  [ERROR_TYPES.CORS_ERROR]: {
    title: '🔒 Lỗi CORS - Không thể kết nối',
    icon: '🔒',
    severity: 'high',
    commonCauses: [
      'API đang ở domain khác',
      'Browser chặn cross-origin request'
    ],
    solutions: [
      'Làm mới trang (F5)',
      'Xóa cache trình duyệt',
      'Thử dùng trình duyệt khác (Chrome/Firefox)',
      'Liên hệ support nếu vẫn lỗi'
    ]
  }
};

/**
 * Phân tích lỗi từ response
 */
export function analyzeError(error, requestBody = null, context = {}) {
  const errorStr = String(error).toLowerCase();
  const analysis = {
    id: `err_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    timestamp: new Date().toISOString(),
    originalError: error,
    context: context,
    type: ERROR_TYPES.UNKNOWN_ERROR,
    details: {},
    suggestions: []
  };

  // Pattern matching để xác định lỗi
  const patterns = [
    { type: ERROR_TYPES.TOKEN_INVALID_FORMAT, patterns: ['pattern', 'string did not match', 'invalid token format', 'token must start'], priority: 1 },
    { type: ERROR_TYPES.TOKEN_EXPIRED, patterns: ['expired', 'bad credentials', '401'], priority: 2 },
    { type: ERROR_TYPES.TOKEN_MISSING_SCOPES, patterns: ['scope', 'permission', 'insufficient', '403'], priority: 2 },
    { type: ERROR_TYPES.TOKEN_RATE_LIMIT, patterns: ['rate limit', '429', 'too many requests'], priority: 3 },
    { type: ERROR_TYPES.NETWORK_CONNECTION, patterns: ['network', 'connection', 'failed to fetch', 'econnrefused', 'enotfound'], priority: 1 },
    { type: ERROR_TYPES.NETWORK_TIMEOUT, patterns: ['timeout', 'timed out', 'etimedout'], priority: 2 },
    { type: ERROR_TYPES.CORS_ERROR, patterns: ['cors', 'cross-origin', 'blocked'], priority: 1 },
    { type: ERROR_TYPES.GITHUB_REPO_NAME_INVALID, patterns: ['repository name', 'invalid repo name', 'name already exists', '422'], priority: 2 },
    { type: ERROR_TYPES.GITHUB_WORKFLOW_NOT_FOUND, patterns: ['workflow', 'not found', '404', 'does not exist'], priority: 2 },
    { type: ERROR_TYPES.WORKFLOW_TRIGGER_FAILED, patterns: ['trigger', 'dispatch', 'failed to trigger'], priority: 2 },
    { type: ERROR_TYPES.GITHUB_API_422, patterns: ['422', 'unprocessable'], priority: 3 },
    { type: ERROR_TYPES.GITHUB_API_403, patterns: ['403', 'forbidden'], priority: 2 },
    { type: ERROR_TYPES.GITHUB_API_404, patterns: ['404', 'not found'], priority: 3 }
  ];

  // Tìm pattern khớp nhất
  let bestMatch = { type: ERROR_TYPES.UNKNOWN_ERROR, priority: 99 };
  for (const pattern of patterns) {
    for (const p of pattern.patterns) {
      if (errorStr.includes(p)) {
        if (pattern.priority < bestMatch.priority) {
          bestMatch = { type: pattern.type, priority: pattern.priority };
        }
        break;
      }
    }
  }
  analysis.type = bestMatch.type;

  // Thêm thông tin chi tiết từ request body
  if (requestBody) {
    if (requestBody.githubToken) {
      const token = requestBody.githubToken;
      analysis.details.tokenProvided = true;
      analysis.details.tokenPrefix = token.substring(0, Math.min(15, token.length));
      analysis.details.tokenLength = token.length;
      
      if (!token.startsWith('ghp_') && !token.startsWith('github_pat_') && 
          !token.startsWith('gho_') && !token.startsWith('ghu_') && !token.startsWith('ghs_')) {
        analysis.suggestions.push('Kiểm tra lại prefix của GitHub Token');
      }
      if (token.length < 20) {
        analysis.suggestions.push('Token GitHub quá ngắn (cần ít nhất 20 ký tự)');
      }
    }
    
    if (requestBody.tailscaleKey) {
      const key = requestBody.tailscaleKey;
      analysis.details.tailscaleProvided = true;
      analysis.details.tailscalePrefix = key.substring(0, Math.min(10, key.length));
      
      if (!key.startsWith('tskey-')) {
        analysis.suggestions.push('Tailscale Key phải bắt đầu bằng "tskey-"');
      }
    }
    
    if (requestBody.vmUsername) {
      analysis.details.username = requestBody.vmUsername;
      analysis.details.usernameLength = requestBody.vmUsername.length;
      if (requestBody.vmUsername.length < 5) {
        analysis.suggestions.push('Tên đăng nhập cần ít nhất 5 ký tự');
      }
    }
  }

  // Lấy thông tin từ database lỗi
  const errorInfo = ERROR_DATABASE[analysis.type] || ERROR_DATABASE[ERROR_TYPES.UNKNOWN_ERROR];
  
  return {
    ...analysis,
    title: errorInfo.title,
    icon: errorInfo.icon,
    severity: errorInfo.severity,
    commonCauses: errorInfo.commonCauses || ['Không xác định được nguyên nhân cụ thể'],
    solutions: errorInfo.solutions || ['Liên hệ bộ phận hỗ trợ với mã lỗi bên dưới'],
    example: errorInfo.example || null
  };
}

/**
 * Lưu log lỗi vào bộ nhớ
 */
const errorLogs = [];
const MAX_ERROR_LOGS = 50;

export function logError(analysis, vmContext = null) {
  const logEntry = {
    ...analysis,
    vmContext: vmContext,
    viewed: false
  };
  errorLogs.unshift(logEntry);
  if (errorLogs.length > MAX_ERROR_LOGS) errorLogs.pop();
  return logEntry;
}

export function getErrorLogs(limit = 20) {
  return errorLogs.slice(0, limit);
}

export function markAsViewed(errorId) {
  const log = errorLogs.find(l => l.id === errorId);
  if (log) log.viewed = true;
}

export function clearErrorLogs() {
  errorLogs.length = 0;
}

/**
 * Render HTML hiển thị lỗi chi tiết
 */
export function renderErrorCard(analysis, isCompact = false) {
  if (isCompact) {
    return `
      <div class="error-card compact" data-error-id="${analysis.id}" style="background: rgba(239,68,68,0.08); border-radius: 12px; padding: 0.8rem; margin-bottom: 0.5rem; border-left: 3px solid #ef4444;">
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${analysis.icon || '❌'}</span>
            <span style="font-weight: 600; font-size: 0.8rem;">${analysis.title}</span>
          </div>
          <span style="font-size: 0.65rem; opacity: 0.6;">${new Date(analysis.timestamp).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 0.7rem; margin-top: 0.3rem; opacity: 0.7;">${analysis.originalError.substring(0, 100)}...</div>
      </div>
    `;
  }
  
  return `
    <div class="error-card expanded" data-error-id="${analysis.id}" style="background: rgba(239,68,68,0.08); border-radius: 16px; margin-bottom: 1rem; overflow: hidden; border: 1px solid rgba(239,68,68,0.3);">
      <!-- Header -->
      <div style="background: rgba(239,68,68,0.15); padding: 1rem; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 0.5rem;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <span style="font-size: 1.5rem;">${analysis.icon || '🔍'}</span>
          <div>
            <div style="font-weight: 700; color: #ef4444;">${analysis.title}</div>
            <div style="font-size: 0.7rem; opacity: 0.7;">Mã lỗi: ${analysis.type} • ${new Date(analysis.timestamp).toLocaleString()}</div>
          </div>
        </div>
        <div style="display: flex; gap: 0.5rem;">
          <span class="severity-badge" style="background: ${analysis.severity === 'high' ? '#ef4444' : analysis.severity === 'medium' ? '#f59e0b' : '#10b981'}; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.65rem; font-weight: 600;">
            ${analysis.severity === 'high' ? '⚠️ Nghiêm trọng' : analysis.severity === 'medium' ? '📌 Trung bình' : 'ℹ️ Nhẹ'}
          </span>
        </div>
      </div>
      
      <div style="padding: 1rem;">
        <!-- Nguyên nhân -->
        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>🔍</span> Nguyên nhân có thể:
          </div>
          ${analysis.commonCauses.map(cause => `
            <div style="padding: 0.4rem 0 0.4rem 1rem; font-size: 0.75rem; border-left: 2px solid #ef4444; margin-bottom: 0.3rem;">
              • ${cause}
            </div>
          `).join('')}
        </div>
        
        <!-- Cách khắc phục -->
        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
            <span>✅</span> Cách khắc phục:
          </div>
          ${analysis.solutions.map(solution => `
            <div style="padding: 0.4rem 0 0.4rem 1rem; font-size: 0.75rem; color: #22c55e;">
              ✓ ${solution}
            </div>
          `).join('')}
        </div>
        
        <!-- Chi tiết kỹ thuật -->
        <details style="margin-top: 0.5rem; font-size: 0.7rem;">
          <summary style="cursor: pointer; opacity: 0.6; padding: 0.3rem;">🔧 Chi tiết kỹ thuật</summary>
          <div style="background: rgba(0,0,0,0.2); padding: 0.6rem; border-radius: 8px; margin-top: 0.5rem; font-family: monospace; font-size: 0.65rem; word-break: break-all;">
            <div><strong>Error ID:</strong> ${analysis.id}</div>
            <div><strong>Original Error:</strong> ${analysis.originalError}</div>
            ${analysis.details ? `<div><strong>Details:</strong> ${JSON.stringify(analysis.details, null, 2)}</div>` : ''}
            ${analysis.example ? `<div><strong>Example valid format:</strong> <span style="color: #facc15;">${analysis.example}</span></div>` : ''}
          </div>
        </details>
      </div>
    </div>
  `;
}

export default {
  ERROR_TYPES,
  ERROR_DATABASE,
  analyzeError,
  logError,
  getErrorLogs,
  markAsViewed,
  clearErrorLogs,
  renderErrorCard
};
