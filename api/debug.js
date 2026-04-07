// api/debug.js - Hệ thống phân tích lỗi đơn giản hóa
// Bỏ các pattern gây lỗi, chỉ giữ chức năng cơ bản

export const ERROR_TYPES = {
  TOKEN_INVALID: 'TOKEN_INVALID',
  NETWORK_ERROR: 'NETWORK_ERROR',
  GITHUB_API_ERROR: 'GITHUB_API_ERROR',
  WORKFLOW_ERROR: 'WORKFLOW_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

/**
 * Phân tích lỗi từ response - Đơn giản hóa
 */
export function analyzeError(error, requestBody = null, context = {}) {
  const errorStr = String(error).toLowerCase();
  const timestamp = new Date().toISOString();
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  
  // Xác định loại lỗi đơn giản
  let type = ERROR_TYPES.UNKNOWN_ERROR;
  let title = 'Lỗi không xác định';
  let icon = '❌';
  let severity = 'medium';
  let commonCauses = ['Không thể xác định nguyên nhân cụ thể'];
  let solutions = ['Thử lại sau', 'Liên hệ bộ phận hỗ trợ'];
  
  if (errorStr.includes('token') || errorStr.includes('401') || errorStr.includes('unauthorized')) {
    type = ERROR_TYPES.TOKEN_INVALID;
    title = '🔑 GitHub Token không hợp lệ';
    icon = '🔑';
    severity = 'high';
    commonCauses = [
      'Token GitHub sai hoặc đã hết hạn',
      'Token không có đủ quyền (cần repo + workflow)',
      'Token bị thu hồi'
    ];
    solutions = [
      'Tạo token mới tại https://github.com/settings/tokens',
      'Chọn quyền: repo (tất cả) và workflow',
      'Chọn thời hạn: No expiration'
    ];
  } 
  else if (errorStr.includes('network') || errorStr.includes('fetch') || errorStr.includes('connection')) {
    type = ERROR_TYPES.NETWORK_ERROR;
    title = '🌐 Lỗi kết nối mạng';
    icon = '🌐';
    severity = 'high';
    commonCauses = [
      'Mất kết nối internet',
      'Server đang bảo trì',
      'Firewall hoặc VPN chặn kết nối'
    ];
    solutions = [
      'Kiểm tra lại kết nối mạng',
      'Làm mới trang (F5)',
      'Tắt VPN tạm thời'
    ];
  }
  else if (errorStr.includes('422') || errorStr.includes('repo')) {
    type = ERROR_TYPES.GITHUB_API_ERROR;
    title = '📦 Lỗi GitHub API';
    icon = '📦';
    severity = 'medium';
    commonCauses = [
      'Tên repository không hợp lệ',
      'Repository đã tồn tại',
      'GitHub API đang bận'
    ];
    solutions = [
      'Thử lại sau vài giây',
      'Kiểm tra tên repository',
      'Hệ thống sẽ tự động tạo tên khác'
    ];
  }
  else if (errorStr.includes('workflow') || errorStr.includes('action')) {
    type = ERROR_TYPES.WORKFLOW_ERROR;
    title = '⚙️ Lỗi GitHub Workflow';
    icon = '⚙️';
    severity = 'medium';
    commonCauses = [
      'Workflow file bị lỗi',
      'GitHub Actions đang bận',
      'Token thiếu quyền workflow'
    ];
    solutions = [
      'Đợi 10-15 giây rồi thử lại',
      'Kiểm tra trạng thái tại GitHub Actions',
      'Tạo lại VM với token mới'
    ];
  }
  else if (errorStr.includes('username') || errorStr.includes('password') || errorStr.includes('validation')) {
    type = ERROR_TYPES.VALIDATION_ERROR;
    title = '📝 Lỗi dữ liệu nhập';
    icon = '📝';
    severity = 'low';
    commonCauses = [
      'Tên đăng nhập quá ngắn (<5 ký tự)',
      'Mật khẩu quá yếu',
      'Thiếu thông tin bắt buộc'
    ];
    solutions = [
      'Nhập tên có ít nhất 5 ký tự',
      'Dùng mật khẩu có ít nhất 6 ký tự',
      'Bấm nút Random để tạo tự động'
    ];
  }
  
  return {
    id: errorId,
    timestamp: timestamp,
    originalError: String(error),
    context: context,
    type: type,
    title: title,
    icon: icon,
    severity: severity,
    commonCauses: commonCauses,
    solutions: solutions,
    details: {
      tokenProvided: !!(requestBody?.githubToken),
      usernameProvided: !!(requestBody?.vmUsername)
    }
  };
}

// Log lưu trữ đơn giản
const errorLogs = [];
const MAX_ERROR_LOGS = 30;

export function logError(analysis, vmContext = null) {
  const logEntry = {
    ...analysis,
    vmContext: vmContext,
    viewed: false,
    loggedAt: new Date().toISOString()
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
 * Render HTML hiển thị lỗi - Đơn giản hóa
 */
export function renderErrorCard(analysis, isCompact = false) {
  if (isCompact) {
    return `
      <div class="error-card compact" data-error-id="${analysis.id}" style="background: rgba(239,68,68,0.1); border-radius: 10px; padding: 0.7rem; margin-bottom: 0.5rem; border-left: 3px solid #ef4444;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${analysis.icon || '⚠️'}</span>
            <span style="font-weight: 600; font-size: 0.8rem;">${analysis.title}</span>
          </div>
          <span style="font-size: 0.65rem; opacity: 0.6;">${new Date(analysis.timestamp).toLocaleTimeString()}</span>
        </div>
        <div style="font-size: 0.7rem; margin-top: 0.3rem; opacity: 0.7;">${analysis.originalError.substring(0, 80)}${analysis.originalError.length > 80 ? '...' : ''}</div>
      </div>
    `;
  }
  
  return `
    <div class="error-card expanded" data-error-id="${analysis.id}" style="background: rgba(239,68,68,0.08); border-radius: 12px; margin-bottom: 1rem; overflow: hidden; border: 1px solid rgba(239,68,68,0.3);">
      <div style="background: rgba(239,68,68,0.15); padding: 0.8rem 1rem; display: flex; justify-content: space-between; align-items: center;">
        <div style="display: flex; align-items: center; gap: 0.8rem;">
          <span style="font-size: 1.3rem;">${analysis.icon || '🔍'}</span>
          <div>
            <div style="font-weight: 700; color: #ef4444;">${analysis.title}</div>
            <div style="font-size: 0.65rem; opacity: 0.7;">${new Date(analysis.timestamp).toLocaleString()}</div>
          </div>
        </div>
        <span class="severity-badge" style="background: ${analysis.severity === 'high' ? '#ef4444' : analysis.severity === 'medium' ? '#f59e0b' : '#10b981'}; padding: 0.2rem 0.6rem; border-radius: 20px; font-size: 0.65rem; font-weight: 600;">
          ${analysis.severity === 'high' ? '⚠️ Nghiêm trọng' : analysis.severity === 'medium' ? '📌 Trung bình' : 'ℹ️ Nhẹ'}
        </span>
      </div>
      
      <div style="padding: 1rem;">
        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.5rem;">🔍 Nguyên nhân có thể:</div>
          ${analysis.commonCauses.map(cause => `<div style="padding: 0.3rem 0 0.3rem 1rem; font-size: 0.75rem; border-left: 2px solid #ef4444; margin-bottom: 0.3rem;">• ${cause}</div>`).join('')}
        </div>
        
        <div style="margin-bottom: 1rem;">
          <div style="font-weight: 600; margin-bottom: 0.5rem;">✅ Cách khắc phục:</div>
          ${analysis.solutions.map(solution => `<div style="padding: 0.3rem 0 0.3rem 1rem; font-size: 0.75rem; color: #22c55e;">✓ ${solution}</div>`).join('')}
        </div>
        
        <details style="margin-top: 0.5rem; font-size: 0.7rem;">
          <summary style="cursor: pointer; opacity: 0.6;">🔧 Chi tiết kỹ thuật</summary>
          <div style="background: rgba(0,0,0,0.3); padding: 0.5rem; border-radius: 6px; margin-top: 0.5rem; font-family: monospace; font-size: 0.65rem; word-break: break-all;">
            <div><strong>Error ID:</strong> ${analysis.id}</div>
            <div><strong>Error Type:</strong> ${analysis.type}</div>
            <div><strong>Message:</strong> ${analysis.originalError}</div>
          </div>
        </details>
      </div>
    </div>
  `;
}

export default {
  ERROR_TYPES,
  analyzeError,
  logError,
  getErrorLogs,
  markAsViewed,
  clearErrorLogs,
  renderErrorCard
};
